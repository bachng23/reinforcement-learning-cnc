"""Typed physical overrides applied only to a validated deep clone."""
from datetime import datetime

from pydantic import ValidationError

from domain.operations.contracts import FactorySnapshot
from domain.scenarios.contracts import (
    DeferMaintenance, Diagnostic, EffectiveDiff, EffectiveInput, EvaluationRequest,
    MaintenanceDuration, ScenarioInputError, TechnicianUnavailable, override_key,
)
from domain.scenarios.hashing import content_hash, normalized


def transform(request: EvaluationRequest) -> EffectiveInput:
    source = request.baseline.snapshot
    # model_dump creates independent nested containers; the pinned model remains untouched.
    raw = source.model_dump()
    overrides = sorted(request.overrides, key=override_key)
    diffs, diagnostics = [], []
    window = source.planning_window
    for override in overrides:
        if isinstance(override, TechnicianUnavailable):
            target = next((t for t in raw["technicians"] if t["technician_id"] == override.technician_id), None)
            if target is None:
                raise ScenarioInputError("UNKNOWN_TARGET", "Technician is absent from the pinned snapshot", override.technician_id)
            if override.start_at < window.start_at or override.end_at > window.end_at:
                raise ScenarioInputError("INVALID_WINDOW", "Unavailable interval must be within the planning window", override.technician_id)
            before = target["availability"]
            after = []
            for interval in before:
                start, end = interval["start_at"], interval["end_at"]
                if end <= override.start_at or start >= override.end_at:
                    after.append(dict(interval))
                else:
                    if start < override.start_at:
                        after.append({"start_at": start, "end_at": override.start_at})
                    if end > override.end_at:
                        after.append({"start_at": override.end_at, "end_at": end})
            target["availability"] = after
            diffs.append(EffectiveDiff(target_type="TECHNICIAN", target_id=override.technician_id,
                field="availability", before=normalized(before), after=normalized(after)))
        else:
            target = next((m for m in raw["maintenance_requests"] if m["maintenance_request_id"] == override.maintenance_request_id), None)
            if target is None:
                raise ScenarioInputError("UNKNOWN_TARGET", "Maintenance request is absent from the pinned snapshot", override.maintenance_request_id)
            if target["status"].value in {"COMPLETED", "CANCELLED"}:
                raise ScenarioInputError("INVALID_TARGET_STATUS", "Terminal maintenance cannot be overridden", override.maintenance_request_id)
            field = "expected_duration_minutes" if isinstance(override, MaintenanceDuration) else "earliest_start_at"
            value = getattr(override, field)
            before = target[field]
            if isinstance(override, DeferMaintenance):
                if value < window.start_at or value >= window.end_at or value < before:
                    raise ScenarioInputError("INVALID_WINDOW", "Deferred start must stay in the planning window and cannot relax its lower bound", override.maintenance_request_id)
                if target["latest_start_at"] is not None and value > target["latest_start_at"]:
                    diagnostics.append(Diagnostic(code="INPUT_CONSTRAINT_CONFLICT", message="Deferred lower bound exceeds the immutable latest-start bound",
                        target_ids=[override.maintenance_request_id], field=field))
            target[field] = value
            diffs.append(EffectiveDiff(target_type="MAINTENANCE_REQUEST", target_id=override.maintenance_request_id,
                field=field, before=normalized(before), after=normalized(value)))
    snapshot = None
    if not diagnostics:
        try:
            snapshot = FactorySnapshot.model_validate(raw)
        except ValidationError:
            diagnostics.append(Diagnostic(code="INPUT_CONSTRAINT_CONFLICT", message="Effective snapshot violates canonical constraints"))
    return EffectiveInput(source_hash=request.baseline.snapshot_hash, overrides=overrides,
        snapshot=snapshot, effective_hash=content_hash(normalized(snapshot.model_dump())) if snapshot else None,
        diff=diffs, diagnostics=diagnostics)
