import pytest

from domain.scenarios.contracts import EvaluationRequest, SensitivityRequest
from domain.scenarios.evaluation import ScenarioEvaluator
from domain.scenarios.hashing import content_hash
from domain.scenarios.sensitivity import SensitivityEvaluator
from test_scenario_transform import engine_payload, duration


def sweep_request(axis, overrides=()):
    request = EvaluationRequest.model_validate(engine_payload(overrides))
    result = ScenarioEvaluator().evaluate(request)
    return SensitivityRequest(input=request, source_result=result,
        source_result_hash=content_hash(result.model_dump(mode="json")), axis=axis)


def test_five_physical_points_replan_each_point_with_real_feasibility(monkeypatch):
    request = sweep_request({"type": "MAINTENANCE_DURATION", "maintenance_request_id": "MR1", "values": [120, 90, 30, 91, 60]})
    calls = []
    original = ScenarioEvaluator.plan
    def counted(self, request, snapshot, draws, deadline):
        calls.append(snapshot.maintenance_requests[0].expected_duration_minutes)
        return original(self, request, snapshot, draws, deadline)
    monkeypatch.setattr(ScenarioEvaluator, "plan", counted)
    result = SensitivityEvaluator().evaluate(request)
    assert calls == [30, 60, 90, 91, 120]
    assert result.outcome == "COMPLETE"  # No-feasible is a completed evaluation.
    assert [p.status for p in result.points] == ["FEASIBLE"] * 3 + ["NO_FEASIBLE_PLAN"] * 2
    assert all(p.evaluation.candidates == [] for p in result.points[3:])
    assert result.requested_order == [120, 90, 30, 91, 60]
    assert result.baseline_value == 60


def test_weight_only_keeps_kpis_schedules_reference_and_never_calls_planner_or_simulator(monkeypatch):
    request = sweep_request({"type": "OBJECTIVE_WEIGHT", "weight": "production", "values": [0, 0.5, 1, 2, 4]})
    before = request.source_result.model_dump_json()
    def forbidden(*args, **kwargs):
        pytest.fail("Weight-only sweep must not plan or simulate")
    monkeypatch.setattr("domain.operations.service.DecisionPlanningService.plan_with_diagnostics", forbidden)
    monkeypatch.setattr("domain.operations.simulator.DeterministicSimulator.calculate", forbidden)
    result = SensitivityEvaluator().evaluate(request)
    assert result.outcome == "COMPLETE"
    assert result.rank_change_intervals == []
    for point in result.points:
        assert point.evaluation.candidates == request.source_result.scenario.candidates
        assert point.evaluation.ranking.normalization_reference_id == request.source_result.scenario.ranking.normalization_reference_id
        weights = point.evaluation.ranking.raw_weights.model_dump()
        assert weights.pop("production") == point.value
        original = request.input.planning_config.objective_weights.model_dump()
        original.pop("production")
        assert weights == original
        assert sum(point.evaluation.ranking.normalized_weights.values()) == pytest.approx(1)
    assert request.source_result.model_dump_json() == before


def test_nonfeasible_source_weight_sweep_has_no_synthetic_kpis(monkeypatch):
    request = sweep_request({"type": "OBJECTIVE_WEIGHT", "weight": "production", "values": [1, 2]}, [duration(120)])
    monkeypatch.setattr(ScenarioEvaluator, "plan", lambda *a: pytest.fail("must not plan"))
    result = SensitivityEvaluator().evaluate(request)
    assert result.outcome == "COMPLETE"
    assert all(p.status == "NO_FEASIBLE_PLAN" and not p.evaluation.candidates for p in result.points)


@pytest.mark.parametrize("values", [[1] * 2, list(range(1, 9)), [float("inf")], []])
def test_sweep_bounds_and_unique_values(values):
    with pytest.raises(ValueError):
        sweep_request({"type": "OBJECTIVE_WEIGHT", "weight": "production", "values": values})


def test_one_physical_failure_is_explicit_and_does_not_fill_baseline_results(monkeypatch):
    request = sweep_request({"type": "MAINTENANCE_DURATION", "maintenance_request_id": "MR1", "values": [30, 60, 90]})
    original = ScenarioEvaluator.plan
    def interrupted(self, request, snapshot, draws, deadline):
        if snapshot.maintenance_requests[0].expected_duration_minutes == 60:
            raise RuntimeError("private implementation detail must not leak")
        return original(self, request, snapshot, draws, deadline)
    monkeypatch.setattr(ScenarioEvaluator, "plan", interrupted)
    result = SensitivityEvaluator().evaluate(request)
    assert result.outcome == "PARTIAL_FAILED"
    assert [p.status for p in result.points] == ["FEASIBLE", "FAILED", "FEASIBLE"]
    assert result.points[1].evaluation.candidates == []
    assert "private implementation" not in result.model_dump_json()
    assert result.rank_change_intervals == []  # Never bridge a failed sample.
