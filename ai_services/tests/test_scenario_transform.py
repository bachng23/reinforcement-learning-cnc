import copy
import itertools
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from domain.operations.service import DecisionPlanningService, NoFeasiblePlan
from domain.scenarios.contracts import EvaluationRequest, ScenarioInputError
from domain.scenarios.hashing import content_hash
from domain.scenarios.transform import transform

FIXTURE = Path(__file__).parent / "fixtures/scenario-maintenance-90-minute-slot.json"


def engine_payload(overrides=()):
    fixture = json.loads(FIXTURE.read_text())
    snapshot = fixture["factory_snapshot"]
    return {"contract_version": "scenario-engine:1.0", "operation": "EVALUATE",
        "identity": {"factory_id": snapshot["factory_id"], "workspace_id": "workspace-one",
                     "run_id": "run-one", "frozen_input_hash": "a" * 64},
        "baseline": {"snapshot": snapshot, "snapshot_hash": content_hash(snapshot)},
        "planning_config": fixture["planning_config"], "overrides": list(overrides),
        "sampling": {"base_seed": 7, "sample_count": 100}, "budget": {"remaining_ms": 300000}}


def duration(value):
    return {"type": "MAINTENANCE_DURATION", "maintenance_request_id": "MR1", "expected_duration_minutes": value}


def test_availability_subtraction_splits_windows_without_mutating_source_or_permissions():
    payload = engine_payload([{"type": "TECHNICIAN_UNAVAILABLE", "technician_id": "T1",
        "start_at": "2026-10-27T00:30:00Z", "end_at": "2026-10-27T01:00:00Z"}])
    request = EvaluationRequest.model_validate(payload)
    before = request.model_dump_json()
    effective = transform(request)
    technician = effective.snapshot.technicians[0]
    assert [(w.start_at.minute, w.end_at.hour, w.end_at.minute) for w in technician.availability] == [(0, 0, 30), (0, 1, 30)]
    assert technician.skills == request.baseline.snapshot.technicians[0].skills
    assert technician.status == request.baseline.snapshot.technicians[0].status
    assert effective.snapshot.machines == request.baseline.snapshot.machines
    assert request.model_dump_json() == before
    assert effective.diff[0].field == "availability"


def test_override_order_and_timestamp_timezone_do_not_change_effective_hash():
    overrides = [duration(30), {"type": "DEFER_MAINTENANCE", "maintenance_request_id": "MR1", "earliest_start_at": "2026-10-27T00:10:00Z"}]
    results = [transform(EvaluationRequest.model_validate(engine_payload(order))) for order in itertools.permutations(overrides)]
    assert results[0] == results[1]
    overrides[1]["earliest_start_at"] = "2026-10-27T08:10:00+08:00"
    assert transform(EvaluationRequest.model_validate(engine_payload(overrides))).effective_hash == results[0].effective_hash


@pytest.mark.parametrize("value", [0, -1, 0.5, 60.0, "60", True, 43201, float("nan"), float("inf")])
def test_duration_is_bounded_integer_without_coercion(value):
    with pytest.raises(ValidationError):
        EvaluationRequest.model_validate(engine_payload([duration(value)]))


@pytest.mark.parametrize("override", [
    {"type": "ARBITRARY_ASSUMPTION", "machine_id": "M1"},
    {**duration(30), "mandatory": False},
])
def test_unknown_fields_and_overrides_are_rejected(override):
    with pytest.raises(ValidationError):
        EvaluationRequest.model_validate(engine_payload([override]))


def test_duplicate_target_and_wrong_sampling_or_scope_are_rejected():
    raw = engine_payload([duration(30), duration(60)])
    with pytest.raises(ValidationError, match="duplicate"):
        EvaluationRequest.model_validate(raw)
    raw = engine_payload()
    raw["sampling"]["base_seed"] = 8
    with pytest.raises(ValidationError, match="sampling"):
        EvaluationRequest.model_validate(raw)
    raw = engine_payload()
    raw["identity"]["factory_id"] = "other-factory"
    with pytest.raises(ValidationError, match="scope"):
        EvaluationRequest.model_validate(raw)


def test_hash_mismatch_and_silent_horizon_or_strategy_changes_are_rejected():
    raw = engine_payload()
    raw["baseline"]["snapshot_hash"] = "b" * 64
    with pytest.raises(ValidationError, match="HASH_MISMATCH"):
        EvaluationRequest.model_validate(raw)
    raw = engine_payload()
    raw["planning_config"]["horizon_minutes"] = 60
    with pytest.raises(ValidationError, match="horizon"):
        EvaluationRequest.model_validate(raw)
    raw = engine_payload()
    raw["planning_config"]["allowed_strategy_ids"] = ["BALANCED"]
    with pytest.raises(ValidationError):
        EvaluationRequest.model_validate(raw)


def test_unknown_targets_do_not_get_silently_dropped():
    raw = engine_payload([{**duration(30), "maintenance_request_id": "unknown"}])
    with pytest.raises(ScenarioInputError) as error:
        transform(EvaluationRequest.model_validate(raw))
    assert error.value.code == "UNKNOWN_TARGET"


def test_conflicting_defer_retains_attempted_diff_without_relaxing_latest_bound():
    raw = engine_payload([{"type": "DEFER_MAINTENANCE", "maintenance_request_id": "MR1", "earliest_start_at": "2026-10-27T01:00:00Z"}])
    raw["baseline"]["snapshot"]["maintenance_requests"][0]["latest_start_at"] = "2026-10-27T00:30:00Z"
    raw["baseline"]["snapshot_hash"] = content_hash(raw["baseline"]["snapshot"])
    request = EvaluationRequest.model_validate(raw)
    effective = transform(request)
    assert effective.snapshot is None and effective.effective_hash is None
    assert effective.diagnostics[0].code == "INPUT_CONSTRAINT_CONFLICT"
    assert effective.diff[0].after == "2026-10-27T01:00:00.000Z"
    assert request.baseline.snapshot.maintenance_requests[0].latest_start_at.minute == 30


@pytest.mark.parametrize("value,feasible", [(30, True), (60, True), (90, True), (91, False), (120, False)])
def test_typed_duration_changes_the_real_planning_input_and_schedule(value, feasible):
    request = EvaluationRequest.model_validate(engine_payload([duration(value)]))
    effective = transform(request)
    physical = json.loads(FIXTURE.read_text())
    physical["factory_snapshot"] = effective.snapshot.model_dump(mode="json")
    from domain.operations.contracts import RunDecisionCaseRequest
    planner_input = RunDecisionCaseRequest.model_validate(physical)
    planner = DecisionPlanningService(constraint_profile="scenario-strict:1")
    if not feasible:
        with pytest.raises(NoFeasiblePlan):
            planner.plan(planner_input)
        return
    recommendation = planner.plan(planner_input)
    for plan in recommendation.candidate_plans:
        assignment = plan.schedule.assignments[0]
        assert (assignment.end_at - assignment.start_at).total_seconds() == value * 60
        assert plan.validation.verdict.value == "VALID"
        assert plan.validation.validator_version == "operations-validator-scenario-strict:1"
    assert request.baseline.snapshot.maintenance_requests[0].expected_duration_minutes == 60


def test_no_override_preserves_the_entire_source_snapshot():
    request = EvaluationRequest.model_validate(engine_payload())
    effective = transform(request)
    assert effective.snapshot == request.baseline.snapshot
    assert effective.snapshot is not request.baseline.snapshot
    assert effective.diff == []
