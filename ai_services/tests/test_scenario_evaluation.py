import copy
import json
from pathlib import Path

import pytest

from domain.operations.simulator import DeterministicSimulator
from domain.scenarios.contracts import EvaluationRequest
from domain.scenarios.evaluation import ScenarioCancelled, ScenarioEvaluator
from domain.scenarios.hashing import content_hash
from domain.scenarios.sampling import CommonRandomDraws
from test_scenario_transform import engine_payload, duration


def canonical_request():
    raw = json.loads((Path(__file__).resolve().parents[2] / "contracts/v3/fixtures/demo-health-alert.json").read_text())
    payload = engine_payload()
    payload["identity"]["factory_id"] = raw["factory_snapshot"]["factory_id"]
    payload["baseline"] = {"snapshot": raw["factory_snapshot"], "snapshot_hash": content_hash(raw["factory_snapshot"])}
    payload["planning_config"] = raw["planning_config"]
    payload["planning_config"]["allowed_strategy_ids"] = ["production-priority", "balanced", "reliability-priority"]
    payload["sampling"] = {"base_seed": raw["planning_config"]["base_seed"], "sample_count": raw["planning_config"]["simulation_runs"]}
    return EvaluationRequest.model_validate(payload)


def test_real_canonical_baseline_same_input_and_uuid_invariance():
    request = canonical_request()
    evaluator = ScenarioEvaluator()
    before = request.model_dump_json()
    first = evaluator.evaluate(request)
    assert first.baseline.outcome == "FEASIBLE"
    assert first.scenario == first.baseline
    assert first.baseline.candidates
    assert all(candidate.validation.verdict.value == "VALID" for candidate in first.baseline.candidates)
    assert evaluator.evaluate(request).model_dump_json() == first.model_dump_json()
    changed = request.model_copy(update={"identity": request.identity.model_copy(update={"run_id": "another-uuid", "workspace_id": "other-uuid"})})
    replay = evaluator.evaluate(changed)
    assert replay.model_dump(exclude={"identity"}) == first.model_dump(exclude={"identity"})
    assert request.model_dump_json() == before


def test_common_draws_ignore_schedule_uuid_but_preserve_actual_model():
    request = canonical_request()
    result = ScenarioEvaluator().evaluate(request)
    draws = CommonRandomDraws(request.baseline.snapshot, request.sampling)
    simulator = DeterministicSimulator(draw_provider=draws)
    plan = result.baseline.candidates[0]
    kwargs = {"seed": request.sampling.base_seed, "simulation_runs": request.sampling.sample_count}
    first = simulator.calculate(request.baseline.snapshot, plan.schedule, **kwargs)
    changed = simulator.calculate(request.baseline.snapshot, plan.schedule.model_copy(update={"schedule_id": "random-schedule-uuid"}), **kwargs)
    assert changed == first
    assert changed == plan.kpis
    health = request.baseline.snapshot.health_snapshots[0]
    assert draws(health, 0) == CommonRandomDraws(request.baseline.snapshot, request.sampling)(health, 0)
    with pytest.raises(ValueError, match="outside"):
        draws(health, request.sampling.sample_count)


def protected_reservation(reservation):
    payload = engine_payload()
    evaluator = ScenarioEvaluator()
    planned = evaluator.evaluate(EvaluationRequest.model_validate(payload))
    publication = planned.baseline.candidates[0].schedule.model_dump(mode="json")
    original = publication["assignments"][0]
    original["locked"] = reservation == "locked"
    if reservation != "locked":
        original["status"] = reservation
    snapshot = payload["baseline"]["snapshot"]
    snapshot["current_schedule"] = publication
    payload["baseline"]["snapshot_hash"] = content_hash(snapshot)
    return payload, original


@pytest.mark.parametrize("reservation", ["locked", "RUNNING", "COMPLETED"])
def test_replanning_retains_immutable_reservations_exactly(reservation):
    payload, original = protected_reservation(reservation)
    source_before = copy.deepcopy(payload)

    # Replanning must retain every field, including identity and timestamps.
    unchanged = ScenarioEvaluator().evaluate(EvaluationRequest.model_validate(payload))
    assert unchanged.baseline.outcome == "FEASIBLE"
    for candidate in unchanged.baseline.candidates:
        assert candidate.schedule.assignments[0].model_dump(mode="json") == original
    assert payload == source_before


@pytest.mark.parametrize("reservation", ["locked", "RUNNING"])
def test_physical_override_cannot_stretch_a_locked_or_running_reservation(reservation):
    payload, _ = protected_reservation(reservation)
    source_before = copy.deepcopy(payload)
    evaluator = ScenarioEvaluator()
    unchanged = evaluator.evaluate(EvaluationRequest.model_validate(payload))

    # The accepted 60-minute reservation cannot become a hypothetical 90-minute
    # assignment. Infeasibility is a domain outcome with no invented result KPI.
    payload["overrides"] = [duration(90)]
    result = evaluator.evaluate(EvaluationRequest.model_validate(payload))
    assert result.baseline == unchanged.baseline
    assert result.scenario.outcome == "NO_FEASIBLE_PLAN"
    assert result.scenario.candidates == []
    assert result.scenario.ranking is None
    assert all(metric.scenario is None for metric in result.comparison.metrics)
    assert all(point.outcome == "NO_FEASIBLE_PLAN" for point in result.scenario.candidate_availability)
    assert payload["baseline"] == source_before["baseline"]


@pytest.mark.parametrize("minutes,expected", [(30, "FEASIBLE"), (90, "FEASIBLE"), (91, "NO_FEASIBLE_PLAN")])
def test_evaluation_physically_changes_schedule_and_never_fills_failed_kpis(minutes, expected):
    request = EvaluationRequest.model_validate(engine_payload([duration(minutes)]))
    result = ScenarioEvaluator().evaluate(request)
    assert result.scenario.outcome == expected
    assert result.baseline.outcome == "FEASIBLE"
    assert result.effective.diff[0].after == minutes
    if expected == "FEASIBLE":
        assert result.scenario.candidates[0].schedule.assignments[0].end_at != result.baseline.candidates[0].schedule.assignments[0].end_at
        for row in result.scenario.ranking.rows:
            assert sum(row.weighted_contributions.values()) == pytest.approx(row.score, abs=1e-12)
        zero = next(m for m in result.comparison.metrics if m.metric == "expected_failure_count")
        assert zero.percent_delta is None and zero.reason == "ZERO_BASELINE"
    else:
        assert result.scenario.candidates == []
        assert result.scenario.ranking is None
        assert all(m.scenario is None for m in result.comparison.metrics)
        assert "MR1" in result.scenario.diagnostics[0].message
    assert not result.live_mapping.supported
    assert "AUTHORIZED_INGESTION_REQUIRED:MAINTENANCE_DURATION" in result.live_mapping.reasons


def test_deadline_cannot_be_reset_by_the_underlying_planner(monkeypatch):
    request = EvaluationRequest.model_validate(engine_payload())
    # Independent monotonic readings: wrapper starts at 0, planner observes time 1
    # after a one-millisecond whole-evaluation budget. No wall-clock sleeps needed.
    request = request.model_copy(update={"budget": request.budget.model_copy(update={"remaining_ms": 1})})
    ticks = iter([0, 1, 1, 1, 1, 1])
    monkeypatch.setattr("time.monotonic", lambda: next(ticks, 1))
    result = ScenarioEvaluator().evaluate(request)
    assert result.baseline.outcome == "TIMEOUT"
    assert result.scenario.outcome == "TIMEOUT"
    assert result.scenario.candidates == []


def test_cancellation_does_not_return_a_fake_completed_evaluation():
    request = EvaluationRequest.model_validate(engine_payload())
    with pytest.raises(ScenarioCancelled):
        ScenarioEvaluator(cancelled=lambda: True).evaluate(request)
