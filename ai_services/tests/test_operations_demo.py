import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from domain.operations.contracts import (
    AssignmentStatus,
    CandidatePlan,
    FactorySnapshot,
    PlanStrategy,
    PlanValidation,
    RecommendationPackage,
    Schedule,
    ValidationVerdict,
)
from domain.operations.demo import (
    DEMO_CANDIDATE_PLANS,
    DEMO_FACTORY_SNAPSHOT,
    DEMO_PLAN_VALIDATIONS,
    DEMO_PLANNING_INPUT,
    DEMO_PLANNING_OUTPUT,
    DEMO_TRIGGER,
)
from domain.operations.planning import PlanningEngineOutput


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
INVALID_DIR = REPOSITORY_ROOT / "contracts" / "v3" / "fixtures" / "invalid"


def _load(name: str) -> dict:
    return json.loads((INVALID_DIR / name).read_text(encoding="utf-8"))


def test_canonical_demo_has_requested_shape() -> None:
    assert len(DEMO_FACTORY_SNAPSHOT.machines) == 6
    assert len(DEMO_FACTORY_SNAPSHOT.jobs) == 12
    assert len(DEMO_FACTORY_SNAPSHOT.technicians) == 3
    assert DEMO_TRIGGER.machine_id == "M03"
    assert len(DEMO_CANDIDATE_PLANS) == 3
    assert {plan.strategy for plan in DEMO_CANDIDATE_PLANS} == {
        PlanStrategy.PRODUCTION_PRIORITY,
        PlanStrategy.BALANCED,
        PlanStrategy.RELIABILITY_PRIORITY,
    }
    assert all(
        validation.verdict is ValidationVerdict.VALID
        for validation in DEMO_PLAN_VALIDATIONS
    )
    assert DEMO_PLANNING_INPUT.factory_snapshot is DEMO_FACTORY_SNAPSHOT
    assert len(DEMO_PLANNING_OUTPUT.validations) == 3


def test_canonical_demo_candidates_satisfy_v1_resource_constraints() -> None:
    jobs_by_operation = {
        operation.operation_id: (job, operation)
        for job in DEMO_FACTORY_SNAPSHOT.jobs
        for operation in job.operations
    }
    machines = {
        machine.machine_id: machine for machine in DEMO_FACTORY_SNAPSHOT.machines
    }
    technicians = {
        technician.technician_id: technician
        for technician in DEMO_FACTORY_SNAPSHOT.technicians
    }

    for plan in DEMO_CANDIDATE_PLANS:
        active = [
            assignment
            for assignment in plan.schedule.assignments
            if assignment.status is not AssignmentStatus.CANCELLED
        ]
        for index, left in enumerate(active):
            for right in active[index + 1 :]:
                if left.machine_id == right.machine_id:
                    assert not (
                        left.start_at < right.end_at and right.start_at < left.end_at
                    )

        production_by_operation = {
            assignment.operation_id: assignment
            for assignment in active
            if assignment.operation_id is not None
        }
        for operation_id, assignment in production_by_operation.items():
            _, operation = jobs_by_operation[operation_id]
            assert assignment.machine_id in {
                option.machine_id for option in operation.machine_options
            }
            assert operation.operation_type in {
                capability.operation_type
                for capability in machines[assignment.machine_id].capabilities
            }
            for predecessor_id in operation.predecessor_operation_ids:
                assert production_by_operation[predecessor_id].end_at <= assignment.start_at

        maintenance = next(
            assignment
            for assignment in active
            if assignment.maintenance_request_id == "MR-M03-001"
        )
        technician = technicians[maintenance.technician_ids[0]]
        assert any(
            window.start_at <= maintenance.start_at
            and maintenance.end_at <= window.end_at
            for window in technician.availability
        )
        skill = next(skill for skill in technician.skills if skill.skill_id == "mechanical")
        assert skill.level >= 4
        assert "lathe" in skill.certified_machine_families
        assert "spindle-inspection" in skill.certified_action_types


def test_planning_output_requires_one_validation_per_candidate() -> None:
    with pytest.raises(ValidationError, match="exactly one validation"):
        PlanningEngineOutput(
            candidate_plans=DEMO_CANDIDATE_PLANS,
            validations=DEMO_PLAN_VALIDATIONS[:2],
        )


def test_unknown_machine_fixture_is_schema_invalid() -> None:
    with pytest.raises(ValidationError, match="unknown machines"):
        FactorySnapshot.model_validate(_load("unknown-machine-option.json"))


def test_assignment_outside_window_fixture_is_schema_invalid() -> None:
    with pytest.raises(ValidationError, match="fit inside planning_window"):
        Schedule.model_validate(_load("assignment-outside-planning-window.json"))


def test_overlap_fixture_is_structural_but_domain_invalid() -> None:
    plan = CandidatePlan.model_validate(_load("machine-capacity-overlap.json"))
    assert plan.validation is not None
    assert plan.validation.verdict is ValidationVerdict.INVALID
    assert plan.validation.violations[0].constraint_code == "MACHINE_CAPACITY_OVERLAP"


def test_invalid_verdict_without_error_fixture_is_rejected() -> None:
    with pytest.raises(ValidationError, match="at least one ERROR"):
        PlanValidation.model_validate(_load("invalid-verdict-without-error.json"))


def test_recommendation_with_invalid_plan_fixture_is_rejected() -> None:
    with pytest.raises(ValidationError, match="only validated plans"):
        RecommendationPackage.model_validate(
            _load("recommendation-with-invalid-plan.json")
        )
