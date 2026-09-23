from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from domain.operations.contracts import (
    AssignmentStatus,
    AssignmentType,
    ConstraintSeverity,
    ConstraintViolation,
    FactorySnapshot,
    Machine,
    MachineCapability,
    MachineOption,
    MachineStatus,
    Operation,
    PlanStrategy,
    PlanValidation,
    ProductionJob,
    RunDecisionCaseRequest,
    Schedule,
    ScheduleAssignment,
    ValidationVerdict,
)
from domain.operations.service import (
    DecisionPlanningService,
    NoFeasiblePlan,
    PlanningTimedOut,
)
from domain.operations.simulator import DeterministicSimulator


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CANONICAL_REQUEST = REPOSITORY_ROOT / "contracts" / "v3" / "fixtures" / "demo-health-alert.json"


def _request() -> RunDecisionCaseRequest:
    return RunDecisionCaseRequest.model_validate_json(
        CANONICAL_REQUEST.read_text(encoding="utf-8")
    )


def test_canonical_request_returns_three_valid_distinct_strategies() -> None:
    recommendation = DecisionPlanningService().plan(_request())

    assert len(recommendation.candidate_plans) == 3
    assert {plan.strategy for plan in recommendation.candidate_plans} == {
        PlanStrategy.PRODUCTION_PRIORITY,
        PlanStrategy.BALANCED,
        PlanStrategy.RELIABILITY_PRIORITY,
    }
    assert all(
        plan.validation and plan.validation.verdict.value == "VALID"
        for plan in recommendation.candidate_plans
    )
    schedules = {plan.schedule.model_dump_json() for plan in recommendation.candidate_plans}
    assert len(schedules) == 3
    assert recommendation.recommended_plan_id in {
        plan.candidate_plan_id for plan in recommendation.candidate_plans
    }


def test_repeated_request_has_byte_equivalent_canonical_output() -> None:
    service = DecisionPlanningService()
    first = service.plan(_request())
    second = service.plan(_request())

    assert first.model_dump_json() == second.model_dump_json()


def test_new_seed_changes_only_stochastic_metrics() -> None:
    request = _request()
    first = DecisionPlanningService().plan(request)
    changed_seed = request.model_copy(
        update={
            "planning_config": request.planning_config.model_copy(
                update={"base_seed": 1}
            )
        }
    )
    second = DecisionPlanningService().plan(changed_seed)
    first_by_strategy = {plan.strategy: plan for plan in first.candidate_plans}
    second_by_strategy = {plan.strategy: plan for plan in second.candidate_plans}

    assert set(first_by_strategy) == set(second_by_strategy)
    assert all(
        first_by_strategy[strategy].schedule == second_by_strategy[strategy].schedule
        for strategy in first_by_strategy
    )
    assert any(
        first_by_strategy[strategy].kpis.expected_failure_count
        != second_by_strategy[strategy].kpis.expected_failure_count
        for strategy in first_by_strategy
    )


def test_allowed_strategies_and_candidate_limit_are_honored() -> None:
    request = _request()
    limited = request.model_copy(
        update={
            "planning_config": request.planning_config.model_copy(
                update={
                    "allowed_strategy_ids": ["reliability-priority", "balanced"],
                    "candidate_limit": 1,
                }
            )
        }
    )

    recommendation = DecisionPlanningService().plan(limited)

    assert len(recommendation.candidate_plans) == 1
    assert recommendation.candidate_plans[0].strategy is PlanStrategy.RELIABILITY_PRIORITY


def test_no_qualified_technician_is_a_clear_no_feasible_plan() -> None:
    request = _request()
    snapshot = request.factory_snapshot.model_copy(update={"technicians": []})
    no_technician_request = request.model_copy(update={"factory_snapshot": snapshot})

    with pytest.raises(NoFeasiblePlan, match="qualified technician"):
        DecisionPlanningService().plan(no_technician_request)


def test_timeout_without_completed_candidate_is_structured_service_failure(monkeypatch) -> None:
    from domain.operations import service as service_module

    class TimedOutScheduler:
        def __init__(self, *args, **kwargs):
            pass

        def build(self, *args, **kwargs):
            from domain.operations.scheduler import PlanningTimeoutError

            raise PlanningTimeoutError("test timeout")

    monkeypatch.setattr(service_module, "DeterministicScheduler", TimedOutScheduler)

    with pytest.raises(PlanningTimedOut):
        DecisionPlanningService().plan(_request())


def test_invalid_candidates_cannot_leak_into_a_recommendation() -> None:
    class RejectingValidator:
        def validate(self, snapshot, candidate, *, seed):
            return PlanValidation(
                validation_id=f"validation-{candidate.candidate_plan_id}",
                candidate_plan_id=candidate.candidate_plan_id,
                validator_version="test-validator",
                verdict=ValidationVerdict.INVALID,
                validated_at=candidate.generated_at,
                violations=[
                    ConstraintViolation(
                        violation_id=f"violation-{candidate.candidate_plan_id}",
                        constraint_code="TEST_REJECTED",
                        severity=ConstraintSeverity.ERROR,
                        message="Test validator rejects this candidate.",
                        entity_refs=[candidate.candidate_plan_id],
                    )
                ],
            )

    with pytest.raises(NoFeasiblePlan):
        DecisionPlanningService(validator=RejectingValidator()).plan(_request())


def test_small_schedule_kpis_are_calculated_from_assignments() -> None:
    request = _request()
    start_at = request.factory_snapshot.planning_window.start_at
    machine = Machine(
        machine_id="MX1",
        display_name="Small fixture machine",
        machine_family="fixture",
        status=MachineStatus.IDLE,
        capabilities=[MachineCapability(operation_type="cut", nominal_processing_minutes=30)],
    )
    job = ProductionJob(
        job_id="JX1",
        display_name="Small fixture job",
        release_at=start_at,
        due_at=start_at + timedelta(minutes=30),
        operations=[
            Operation(
                operation_id="OX1",
                sequence=1,
                operation_type="cut",
                machine_options=[MachineOption(machine_id="MX1", processing_minutes=30)],
            )
        ],
    )
    snapshot = FactorySnapshot(
        snapshot_id="small-kpi-snapshot",
        factory_id="small-kpi-factory",
        captured_at=start_at,
        planning_window=request.factory_snapshot.planning_window,
        machines=[machine],
        jobs=[job],
    )
    schedule = Schedule(
        schedule_id="small-kpi-schedule",
        factory_id=snapshot.factory_id,
        revision=1,
        planning_window=snapshot.planning_window,
        created_at=start_at,
        assignments=[
            ScheduleAssignment(
                assignment_id="small-kpi-assignment",
                assignment_type=AssignmentType.PRODUCTION,
                status=AssignmentStatus.PROPOSED,
                machine_id="MX1",
                start_at=start_at,
                end_at=start_at + timedelta(minutes=30),
                job_id="JX1",
                operation_id="OX1",
            )
        ],
    )

    kpis = DeterministicSimulator().calculate(
        snapshot, schedule, seed=7, simulation_runs=10
    )

    assert kpis.makespan_minutes == 30
    assert kpis.total_tardiness_minutes == 0
    assert kpis.maximum_tardiness_minutes == 0
    assert kpis.on_time_completion_rate == 1
    assert kpis.expected_failure_count == 0
    assert kpis.maintenance_cost == 0


def test_api_returns_recommendation_and_structured_errors(monkeypatch) -> None:
    import main

    client = TestClient(main.app)
    request = _request()

    success = client.post("/v1/operations/plan", json=request.model_dump(mode="json"))
    assert success.status_code == 200
    assert success.json()["recommended_plan_id"]

    malformed = client.post("/v1/operations/plan", json={})
    assert malformed.status_code == 422
    assert malformed.json()["code"] == "REQUEST_VALIDATION_ERROR"

    no_technician = request.model_copy(
        update={"factory_snapshot": request.factory_snapshot.model_copy(update={"technicians": []})}
    )
    infeasible = client.post(
        "/v1/operations/plan", json=no_technician.model_dump(mode="json")
    )
    assert infeasible.status_code == 409
    assert infeasible.json()["code"] == "NO_FEASIBLE_PLAN"

    class BrokenService:
        def plan(self, request):
            raise RuntimeError("private traceback detail")

    monkeypatch.setattr(main, "planning_service", BrokenService())
    internal = client.post("/v1/operations/plan", json=request.model_dump(mode="json"))
    assert internal.status_code == 500
    assert internal.json()["code"] == "INTERNAL_PLANNING_ERROR"
    assert "traceback" not in internal.text.lower()
