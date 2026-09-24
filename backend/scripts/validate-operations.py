"""Canonical v3 validation bridge. JSON stdin/stdout; no database or network access."""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ai_services"))
from domain.operations.contracts import FactorySnapshot, RunDecisionCaseRequest, DecisionTrigger, PlanningConfig, DecisionMode, DecisionCaseStatusResponse
from pydantic import TypeAdapter
from domain.operations.contracts import RecommendationPackage
from domain.operations.validator import validate_candidate_plan


def validate(value):
    mode = value["mode"]
    if mode == "recommendation":
        data = value["payload"]
        raw = data["recommendation"]
        if not isinstance(raw, dict) or raw.get("schema_version") != "3.0":
            raise ValueError("Explicit v3 version required")
        candidates = raw.get("candidate_plans")
        if not isinstance(candidates, list) or any(not isinstance(p, dict) or p.get("schema_version") != "3.0" for p in candidates):
            raise ValueError("Explicit v3 versions required")
        recommendation = RecommendationPackage.model_validate_json(json.dumps(raw), strict=True)
        snapshot = FactorySnapshot.model_validate(data["snapshot"])
        if recommendation.decision_case_id != data["case_id"] or recommendation.snapshot_id != snapshot.snapshot_id:
            raise ValueError("Recommendation basis mismatch")
        for candidate in recommendation.candidate_plans:
            # Do not trust AI's self-reported VALID verdict, including unselected plans.
            if validate_candidate_plan(snapshot, candidate).verdict.value != "VALID":
                raise ValueError("Candidate failed semantic validation")
        return recommendation.model_dump(mode="json")
    if mode == "case-status":
        return DecisionCaseStatusResponse.model_validate(value["payload"]).model_dump(mode="json")
    if mode == "case-request":
        request = value["payload"]
        if set(request) != {"mode", "trigger", "planning_config"}:
            raise ValueError("Unexpected request fields")
        trigger = dict(request["trigger"])
        owned = {"event_id", "occurred_at", "requested_by_user_id"}
        if owned.intersection(trigger):
            raise ValueError("Server-owned trigger fields")
        trigger.update(event_id="server-generated", occurred_at="2000-01-01T00:00:00Z")
        if trigger.get("type") in {"MANUAL_REPLAN", "WHAT_IF"}:
            trigger["requested_by_user_id"] = "server-generated"
        trigger = TypeAdapter(DecisionTrigger).validate_json(json.dumps(trigger), strict=True).model_dump(mode="json")
        for key in owned:
            trigger.pop(key, None)
        decision_mode = DecisionMode(request["mode"])
        if trigger["type"] == "WHAT_IF" and decision_mode != DecisionMode.SIMULATION_ONLY:
            raise ValueError("WHAT_IF requires simulation mode")
        return {"mode": decision_mode.value, "trigger": trigger,
                "planning_config": PlanningConfig.model_validate_json(json.dumps(request["planning_config"]), strict=True).model_dump(mode="json")}
    if mode == "snapshot":
        payload = value["payload"]
        if payload.get("schema_version") != "3.0":
            raise ValueError("Explicit schema_version 3.0 is required")
        return FactorySnapshot.model_validate(payload).model_dump(mode="json")
    if mode != "seed":
        raise ValueError("Unsupported validation mode")
    plan = value["payload"]
    if plan.get("action") != "seed" or plan.get("plan_version") != 1 or plan.get("dry_run") is not True:
        raise ValueError("Only canonical seed plan version 1 is supported; reset is not supported")
    request_payload = plan["run_request"]
    if request_payload.get("schema_version") != "3.0" or request_payload["factory_snapshot"].get("schema_version") != "3.0":
        raise ValueError("Explicit schema_version 3.0 is required")
    request = RunDecisionCaseRequest.model_validate(request_payload)
    normalized = request.model_dump(mode="json")
    # Exactly the Python canonicalization used by scripts/demo-seed-plan.py.
    canonical = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
    if hashlib.sha256(canonical.encode()).hexdigest() != plan.get("fixture_sha256"):
        raise ValueError("Canonical seed fixture_sha256 mismatch")
    snapshot = normalized["factory_snapshot"]
    if plan.get("factory_id") != snapshot["factory_id"]:
        raise ValueError("Seed factory scope mismatch")
    steps = {step["entity"]: step for step in plan["steps"]}
    if len(steps) != len(plan["steps"]):
        raise ValueError("Duplicate seed entity steps")
    expected = {
        "factory": ("factory_id", [{"factory_id": snapshot["factory_id"]}]),
        "factory_snapshots": ("snapshot_id", [snapshot]),
        "schedules": ("schedule_id", [snapshot["current_schedule"]] if snapshot["current_schedule"] else []),
        "machines": ("machine_id", snapshot["machines"]),
        "jobs": ("job_id", snapshot["jobs"]),
        "technicians": ("technician_id", snapshot["technicians"]),
        "health_snapshots": ("health_snapshot_id", snapshot["health_snapshots"]),
        "maintenance_requests": ("maintenance_request_id", snapshot["maintenance_requests"]),
    }
    if set(steps) != set(expected) | {"decision_cases"}:
        raise ValueError("Unsupported seed entities")
    for entity, (key, records) in expected.items():
        step = steps[entity]
        if step.get("key") != key or step.get("records") != records or step.get("ids") != [r[key] for r in records]:
            raise ValueError(f"Seed step disagrees with canonical request: {entity}")
    # decision_cases is intentionally not persisted in this Operations read slice.
    return snapshot


try:
    print(json.dumps({"ok": True, "payload": validate(json.load(sys.stdin))}, allow_nan=False))
except (ValueError, KeyError, TypeError) as error:
    # Do not return Pydantic input dumps (they can contain sensitive source values).
    print(json.dumps({"ok": False, "message": "Operations contract or seed integrity validation failed"}))
    sys.exit(2)
