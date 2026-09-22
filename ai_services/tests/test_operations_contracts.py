import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from domain.operations.contracts import (
    AgentDefinition,
    AgentRole,
    AgentRunTrace,
    AssignmentStatus,
    AssignmentType,
    AuditLevel,
    CandidatePlan,
    ConstraintSeverity,
    ConstraintViolation,
    DecisionCaseStatus,
    DecisionCaseStatusResponse,
    DecisionMode,
    DiscreteRULDistribution,
    FactorySnapshot,
    HealthAlertTrigger,
    HealthSnapshot,
    HumanDecisionRequest,
    HumanDecisionType,
    Machine,
    MachineCapability,
    MachineOption,
    MachineStatus,
    MaintenancePriority,
    MaintenanceDecision,
    MaintenanceOption,
    MaintenanceOptionSet,
    MaintenanceRequest,
    MaintenanceRequestStatus,
    MaintenanceType,
    ObjectiveWeights,
    Operation,
    OperationStatus,
    PlanKPIs,
    PlanStrategy,
    PlanValidation,
    PlanningConfig,
    ProductionJob,
    ProductionOptionSet,
    ProductionRoutingOption,
    RecommendationExplanation,
    RecommendationPackage,
    RunDecisionCaseRequest,
    RunStatus,
    RiskDriver,
    MachineRiskReport,
    Schedule,
    ScheduleAssignment,
    Technician,
    TechnicianCandidate,
    TechnicianOptionSet,
    TechnicianSkill,
    TechnicianStatus,
    TimeWindow,
    ToolCallStatus,
    ToolCallTrace,
    ToolDefinition,
    ToolSideEffect,
    ValidationVerdict,
    WhatIfTrigger,
)
from domain.operations.schema import build_operations_contract_schema


SCHEMA_PATH = (
    Path(__file__).resolve().parents[2]
    / "contracts"
    / "v3"
    / "operations-domain.schema.json"
)
T0 = datetime(2026, 9, 21, 8, 0, tzinfo=timezone.utc)


def make_rul() -> DiscreteRULDistribution:
    return DiscreteRULDistribution(
        support_minutes=[0, 60, 120, 240],
        probability_mass=[0.01, 0.04, 0.15, 0.30],
        survival_beyond_horizon=0.50,
        model_version="rul-v1",
    )


def make_machine(machine_id: str = "M01") -> Machine:
    return Machine(
        machine_id=machine_id,
        display_name=f"Machine {machine_id}",
        machine_family="cnc-mill",
        status=MachineStatus.WARNING if machine_id == "M01" else MachineStatus.IDLE,
        capabilities=[
            MachineCapability(
                operation_type="milling",
                nominal_processing_minutes=45,
                load_factor=1.1,
                damage_factor=1.2,
            )
        ],
    )


def make_job() -> ProductionJob:
    return ProductionJob(
        job_id="J01",
        display_name="Priority order 01",
        release_at=T0,
        due_at=T0 + timedelta(hours=8),
        priority=80,
        operations=[
            Operation(
                operation_id="O01",
                sequence=0,
                operation_type="milling",
                status=OperationStatus.READY,
                machine_options=[
                    MachineOption(machine_id="M01", processing_minutes=45),
                    MachineOption(machine_id="M02", processing_minutes=55),
                ],
            ),
            Operation(
                operation_id="O02",
                sequence=1,
                operation_type="milling",
                predecessor_operation_ids=["O01"],
                machine_options=[MachineOption(machine_id="M02", processing_minutes=40)],
            ),
        ],
    )


def make_technician() -> Technician:
    return Technician(
        technician_id="K01",
        display_name="Technician K01",
        status=TechnicianStatus.AVAILABLE,
        availability=[TimeWindow(start_at=T0, end_at=T0 + timedelta(hours=8))],
        skills=[
            TechnicianSkill(
                skill_id="mechanical",
                level=4,
                certified_machine_families=["cnc-mill"],
                certified_action_types=["spindle-inspection"],
            )
        ],
    )


def make_maintenance_request() -> MaintenanceRequest:
    return MaintenanceRequest(
        maintenance_request_id="MR01",
        machine_id="M01",
        maintenance_type=MaintenanceType.PREVENTIVE,
        action_type="spindle-inspection",
        priority=MaintenancePriority.HIGH,
        status=MaintenanceRequestStatus.OPEN,
        requested_at=T0,
        earliest_start_at=T0 + timedelta(hours=1),
        latest_start_at=T0 + timedelta(hours=4),
        expected_duration_minutes=60,
        required_skill_ids=["mechanical"],
        minimum_skill_level=3,
    )


def make_schedule(revision: int = 1) -> Schedule:
    return Schedule(
        schedule_id=f"schedule-{revision}",
        factory_id="factory-01",
        revision=revision,
        planning_window=TimeWindow(start_at=T0, end_at=T0 + timedelta(hours=8)),
        created_at=T0,
        assignments=[
            ScheduleAssignment(
                assignment_id=f"A-production-{revision}",
                assignment_type=AssignmentType.PRODUCTION,
                status=AssignmentStatus.PROPOSED,
                machine_id="M02",
                job_id="J01",
                operation_id="O01",
                start_at=T0,
                end_at=T0 + timedelta(minutes=55),
            ),
            ScheduleAssignment(
                assignment_id=f"A-maintenance-{revision}",
                assignment_type=AssignmentType.MAINTENANCE,
                status=AssignmentStatus.PROPOSED,
                machine_id="M01",
                maintenance_request_id="MR01",
                technician_ids=["K01"],
                start_at=T0 + timedelta(hours=1),
                end_at=T0 + timedelta(hours=2),
            ),
        ],
    )


def make_snapshot() -> FactorySnapshot:
    return FactorySnapshot(
        snapshot_id="snapshot-001",
        factory_id="factory-01",
        captured_at=T0,
        planning_window=TimeWindow(start_at=T0, end_at=T0 + timedelta(hours=8)),
        machines=[make_machine("M01"), make_machine("M02")],
        jobs=[make_job()],
        technicians=[make_technician()],
        health_snapshots=[
            HealthSnapshot(
                health_snapshot_id="health-001",
                machine_id="M01",
                observed_at=T0,
                health_index=0.42,
                observed_wear_um=180.0,
                failure_probability_horizon_minutes=240,
                failure_probability=0.31,
                rul_distribution=make_rul(),
                confidence="MEDIUM",
                source_model_version="rul-v1",
            )
        ],
        maintenance_requests=[make_maintenance_request()],
        current_schedule=make_schedule(),
    )


def make_validation(plan_id: str = "plan-001") -> PlanValidation:
    return PlanValidation(
        validation_id="validation-001",
        candidate_plan_id=plan_id,
        validator_version="validator-v1",
        verdict=ValidationVerdict.VALID,
        validated_at=T0 + timedelta(minutes=1),
        simulation_runs=100,
        warnings=["Sensitive to restoration effectiveness"],
    )


def make_plan(plan_id: str = "plan-001") -> CandidatePlan:
    return CandidatePlan(
        candidate_plan_id=plan_id,
        decision_case_id="case-001",
        snapshot_id="snapshot-001",
        plan_version=1,
        strategy=PlanStrategy.BALANCED,
        source_engine_id="cp-sat",
        source_engine_version="1.0.0",
        generated_at=T0 + timedelta(minutes=1),
        schedule=make_schedule(revision=2),
        kpis=PlanKPIs(
            makespan_minutes=420,
            total_tardiness_minutes=24,
            maximum_tardiness_minutes=16,
            on_time_completion_rate=0.90,
            expected_failure_count=0.08,
            failure_probability=0.07,
            expected_emergency_downtime_minutes=18,
            maintenance_cost=420,
            technician_utilization=0.65,
            schedule_changes=2,
            decision_latency_ms=850,
        ),
        source_agent_run_ids=["run-integrated-001"],
        assumptions=["K01 remains available during the assigned window"],
        validation=make_validation(plan_id),
    )


def test_valid_factory_snapshot_and_decision_request() -> None:
    snapshot = make_snapshot()
    request = RunDecisionCaseRequest(
        decision_case_id="case-001",
        mode=DecisionMode.LIVE,
        factory_snapshot=snapshot,
        trigger=HealthAlertTrigger(
            event_id="event-001",
            occurred_at=T0,
            machine_id="M01",
            failure_probability=0.31,
            alert_threshold=0.20,
        ),
        planning_config=PlanningConfig(
            horizon_minutes=480,
            candidate_limit=3,
            solver_timeout_seconds=20,
            simulation_runs=100,
            base_seed=42,
        ),
        requested_by_user_id="user-001",
    )

    assert request.schema_version == "3.0"
    assert request.factory_snapshot.current_schedule is not None
    assert request.trigger.machine_id == "M01"


def test_decision_trigger_must_reference_snapshot_entity() -> None:
    with pytest.raises(ValidationError, match="unknown machine"):
        RunDecisionCaseRequest(
            decision_case_id="case-unknown-machine",
            mode=DecisionMode.LIVE,
            factory_snapshot=make_snapshot(),
            trigger=HealthAlertTrigger(
                event_id="event-unknown-machine",
                occurred_at=T0,
                machine_id="M99",
                failure_probability=0.31,
                alert_threshold=0.20,
            ),
            planning_config=PlanningConfig(horizon_minutes=480),
        )


def test_specialist_agent_handoff_contracts() -> None:
    risk_report = MachineRiskReport(
        risk_report_id="risk-report-001",
        decision_case_id="case-001",
        snapshot_id="snapshot-001",
        generated_by_agent_run_id="run-pdm-001",
        generated_at=T0,
        machine_id="M01",
        prediction_horizon_minutes=240,
        expected_rul_minutes=186,
        failure_probability=0.31,
        confidence="MEDIUM",
        risk_level="HIGH",
        recommended_review_window_minutes=90,
        risk_drivers=[
            RiskDriver(
                code="HIGH_LOAD_OPERATION",
                description="O01 exposes M01 to a high load factor.",
                evidence_refs=["health-001"],
            )
        ],
        evidence_refs=["health-001", "tool-call-risk-001"],
    )
    production_options = ProductionOptionSet(
        production_option_set_id="production-options-001",
        decision_case_id="case-001",
        snapshot_id="snapshot-001",
        generated_by_agent_run_id="run-scheduling-001",
        generated_at=T0,
        affected_job_ids=["J01"],
        affected_operation_ids=["O01"],
        routing_options=[
            ProductionRoutingOption(
                routing_option_id="route-001",
                job_id="J01",
                operation_id="O01",
                machine_id="M02",
                proposed_window=TimeWindow(
                    start_at=T0,
                    end_at=T0 + timedelta(minutes=55),
                ),
                expected_processing_minutes=55,
                expected_tardiness_minutes=6,
                reason_codes=["AVOID_HIGH_RISK_MACHINE"],
            )
        ],
        evidence_refs=["risk-report-001"],
    )
    maintenance_options = MaintenanceOptionSet(
        maintenance_option_set_id="maintenance-options-001",
        decision_case_id="case-001",
        snapshot_id="snapshot-001",
        generated_by_agent_run_id="run-maintenance-001",
        generated_at=T0,
        options=[
            MaintenanceOption(
                maintenance_option_id="maintenance-option-001",
                maintenance_request_id="MR01",
                machine_id="M01",
                decision=MaintenanceDecision.MAINTAIN_IN_WINDOW,
                proposed_window=TimeWindow(
                    start_at=T0 + timedelta(hours=1),
                    end_at=T0 + timedelta(hours=2),
                ),
                expected_duration_minutes=60,
                expected_failure_probability=0.07,
                expected_maintenance_cost=420,
                expected_restoration_effectiveness=0.85,
                required_skill_ids=["mechanical"],
                reason_codes=["REDUCE_FAILURE_RISK"],
            )
        ],
        evidence_refs=["risk-report-001"],
    )
    technician_options = TechnicianOptionSet(
        technician_option_set_id="technician-options-001",
        decision_case_id="case-001",
        snapshot_id="snapshot-001",
        generated_by_agent_run_id="run-technician-001",
        generated_at=T0,
        candidates=[
            TechnicianCandidate(
                technician_candidate_id="technician-candidate-001",
                maintenance_option_id="maintenance-option-001",
                technician_id="K01",
                available_window=TimeWindow(
                    start_at=T0 + timedelta(hours=1),
                    end_at=T0 + timedelta(hours=2),
                ),
                expected_duration_minutes=60,
                skill_match_level=4,
                expected_restoration_effectiveness=0.85,
                expected_workforce_cost=120,
                reason_codes=["CERTIFIED_AND_AVAILABLE"],
            )
        ],
        evidence_refs=["maintenance-options-001"],
    )

    assert risk_report.machine_id == "M01"
    assert production_options.routing_options[0].machine_id == "M02"
    assert maintenance_options.options[0].decision is MaintenanceDecision.MAINTAIN_IN_WINDOW
    assert technician_options.candidates[0].technician_id == "K01"


def test_factory_snapshot_rejects_unknown_machine_reference() -> None:
    payload = make_snapshot().model_dump()
    payload["jobs"][0]["operations"][0]["machine_options"][0]["machine_id"] = "M99"
    with pytest.raises(ValidationError, match="unknown machines"):
        FactorySnapshot.model_validate(payload)


def test_factory_snapshot_rejects_unsupported_machine_capability() -> None:
    payload = make_snapshot().model_dump()
    payload["machines"][0]["capabilities"][0]["operation_type"] = "turning"
    with pytest.raises(ValidationError, match="does not support operation type"):
        FactorySnapshot.model_validate(payload)


def test_factory_snapshot_rejects_cross_job_operation_collision() -> None:
    payload = make_snapshot().model_dump()
    duplicate_job = make_job().model_dump()
    duplicate_job["job_id"] = "J02"
    payload["jobs"].append(duplicate_job)
    with pytest.raises(ValidationError, match="operation_id values must be unique"):
        FactorySnapshot.model_validate(payload)


def test_job_precedence_must_follow_sequence_order() -> None:
    payload = make_job().model_dump()
    payload["operations"][0]["predecessor_operation_ids"] = ["O02"]
    with pytest.raises(ValidationError, match="lower sequence"):
        ProductionJob.model_validate(payload)


def test_schedule_assignment_enforces_discriminated_shape() -> None:
    with pytest.raises(ValidationError, match="require job_id and operation_id"):
        ScheduleAssignment(
            assignment_id="A01",
            assignment_type=AssignmentType.PRODUCTION,
            status=AssignmentStatus.PROPOSED,
            machine_id="M01",
            start_at=T0,
            end_at=T0 + timedelta(minutes=30),
        )

    with pytest.raises(ValidationError, match="maintenance_request_id and technician_ids"):
        ScheduleAssignment(
            assignment_id="A02",
            assignment_type=AssignmentType.MAINTENANCE,
            status=AssignmentStatus.PROPOSED,
            machine_id="M01",
            start_at=T0,
            end_at=T0 + timedelta(minutes=30),
        )


def test_time_contracts_require_aware_and_ordered_datetimes() -> None:
    with pytest.raises(ValidationError):
        TimeWindow(
            start_at=datetime(2026, 9, 21, 8, 0),
            end_at=datetime(2026, 9, 21, 9, 0),
        )
    with pytest.raises(ValidationError, match="later than start"):
        TimeWindow(start_at=T0, end_at=T0)


def test_corrective_maintenance_is_mandatory() -> None:
    payload = make_maintenance_request().model_dump()
    payload["maintenance_type"] = MaintenanceType.CORRECTIVE
    payload["mandatory"] = False
    with pytest.raises(ValidationError, match="must be mandatory"):
        MaintenanceRequest.model_validate(payload)


def test_objective_weights_cannot_all_be_zero() -> None:
    with pytest.raises(ValidationError, match="at least one objective"):
        ObjectiveWeights(
            production=0,
            reliability=0,
            maintenance=0,
            workforce=0,
            schedule_stability=0,
        )


def test_what_if_trigger_requires_simulation_mode() -> None:
    trigger = WhatIfTrigger(
        event_id="event-what-if",
        occurred_at=T0,
        requested_by_user_id="user-001",
        scenario_id="scenario-001",
        assumptions={"unavailable_machine_id": "M02"},
    )
    with pytest.raises(ValidationError, match="SIMULATION_ONLY"):
        RunDecisionCaseRequest(
            decision_case_id="case-what-if",
            mode=DecisionMode.LIVE,
            factory_snapshot=make_snapshot(),
            trigger=trigger,
            planning_config=PlanningConfig(horizon_minutes=480),
        )


def test_invalid_plan_requires_error_violation() -> None:
    with pytest.raises(ValidationError, match="require at least one ERROR"):
        PlanValidation(
            validation_id="validation-invalid",
            candidate_plan_id="plan-invalid",
            validator_version="validator-v1",
            verdict=ValidationVerdict.INVALID,
            validated_at=T0,
            violations=[
                ConstraintViolation(
                    violation_id="warning-001",
                    constraint_code="RESTORATION_SENSITIVITY",
                    severity=ConstraintSeverity.WARNING,
                    message="Plan is sensitive to restoration quality",
                )
            ],
        )


def test_recommendation_accepts_only_validated_plans() -> None:
    plan = make_plan()
    recommendation = RecommendationPackage(
        recommendation_id="recommendation-001",
        decision_case_id="case-001",
        snapshot_id="snapshot-001",
        generated_at=T0 + timedelta(minutes=2),
        recommended_plan_id=plan.candidate_plan_id,
        candidate_plans=[plan],
        explanation=RecommendationExplanation(
            summary="Move O01 to M02 and maintain M01 at 09:00 UTC.",
            primary_reasons=["Failure probability falls from 31% to 7%"],
            tradeoffs=["Total tardiness increases by 6 minutes"],
            evidence_refs=["validation-001", "health-001"],
        ),
    )
    assert recommendation.recommended_plan_id == "plan-001"

    invalid_payload = plan.model_dump()
    invalid_payload["validation"] = None
    invalid_plan = CandidatePlan.model_validate(invalid_payload)
    with pytest.raises(ValidationError, match="only validated plans"):
        RecommendationPackage(
            recommendation_id="recommendation-002",
            decision_case_id="case-001",
            snapshot_id="snapshot-001",
            generated_at=T0,
            recommended_plan_id="plan-001",
            candidate_plans=[invalid_plan],
            explanation=RecommendationExplanation(
                summary="An invalid recommendation must be rejected.",
                primary_reasons=["Test reason"],
                tradeoffs=["Test tradeoff"],
                evidence_refs=["evidence-001"],
            ),
        )


@pytest.mark.parametrize(
    "payload, expected_error",
    [
        (
            {
                "decision": HumanDecisionType.APPROVE,
                "candidate_plan_id": None,
                "expected_plan_version": None,
            },
            "approval requires",
        ),
        (
            {"decision": HumanDecisionType.REJECT, "note": None},
            "rejection requires a note",
        ),
    ],
)
def test_human_decision_requires_optimistic_lock_fields(
    payload: dict, expected_error: str
) -> None:
    data = {
        "decision_case_id": "case-001",
        "recommendation_id": "recommendation-001",
        "expected_snapshot_id": "snapshot-001",
        **payload,
    }
    with pytest.raises(ValidationError, match=expected_error):
        HumanDecisionRequest.model_validate(data)


def test_simulation_case_cannot_be_committed() -> None:
    with pytest.raises(ValidationError, match="cannot be committed"):
        DecisionCaseStatusResponse(
            decision_case_id="case-what-if",
            mode=DecisionMode.SIMULATION_ONLY,
            status=DecisionCaseStatus.COMMITTED,
            snapshot_id="snapshot-001",
            created_at=T0,
            updated_at=T0,
            committed_schedule_id="schedule-002",
        )


def test_agent_and_tool_lifecycle_contracts() -> None:
    definition = AgentDefinition(
        agent_id="pdm-agent",
        version="1.0.0",
        role=AgentRole.PDM,
        display_name="PdM Agent",
        goal="Assess machine health and provide a structured risk report.",
        allowed_tool_ids=["predict-rul"],
        timeout_seconds=30,
        max_tool_calls=5,
    )
    tool = ToolDefinition(
        tool_id="predict-rul",
        version="1.0.0",
        description="Predict a discrete remaining useful life distribution.",
        owner_service="ai-service",
        input_schema_ref="#/$defs/RULPredictionRequest",
        output_schema_ref="#/$defs/DiscreteRULDistribution",
        timeout_ms=5000,
        side_effect=ToolSideEffect.NONE,
        allowed_agent_roles=[AgentRole.PDM],
        audit_level=AuditLevel.FULL,
    )
    call = ToolCallTrace(
        tool_call_id="call-001",
        decision_case_id="case-001",
        agent_run_id="run-pdm-001",
        correlation_id="correlation-001",
        tool_id=tool.tool_id,
        tool_version=tool.version,
        status=ToolCallStatus.SUCCEEDED,
        started_at=T0,
        completed_at=T0 + timedelta(seconds=1),
        input_summary={"machine_id": "M01"},
        output_summary={"failure_probability": 0.31},
        evidence_refs=["health-001"],
    )
    run = AgentRunTrace(
        agent_run_id="run-pdm-001",
        decision_case_id="case-001",
        task_id="task-pdm-001",
        agent_id=definition.agent_id,
        agent_version=definition.version,
        role=definition.role,
        status=RunStatus.COMPLETED,
        started_at=T0,
        completed_at=T0 + timedelta(seconds=2),
        output_ref="risk-report-001",
        tool_call_ids=[call.tool_call_id],
    )
    assert run.role is AgentRole.PDM


def test_operational_commit_tool_must_route_through_supervisor() -> None:
    with pytest.raises(ValidationError, match="restricted through SUPERVISOR"):
        ToolDefinition(
            tool_id="commit-schedule",
            version="1.0.0",
            description="Commit an approved schedule revision.",
            owner_service="backend",
            input_schema_ref="#/$defs/HumanDecisionRequest",
            output_schema_ref="#/$defs/Schedule",
            timeout_ms=5000,
            side_effect=ToolSideEffect.OPERATIONAL_COMMIT,
            allowed_agent_roles=[AgentRole.INTEGRATED_PLANNING],
        )


@pytest.mark.parametrize("invalid_number", [float("nan"), float("inf")])
def test_contracts_reject_non_finite_numbers(invalid_number: float) -> None:
    with pytest.raises(ValidationError):
        PlanKPIs(
            makespan_minutes=invalid_number,
            total_tardiness_minutes=0,
            maximum_tardiness_minutes=0,
            on_time_completion_rate=1,
            expected_failure_count=0,
            failure_probability=0,
            expected_emergency_downtime_minutes=0,
            maintenance_cost=0,
            technician_utilization=0,
            schedule_changes=0,
        )


def test_exported_operations_schema_is_current() -> None:
    exported = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert exported == build_operations_contract_schema()
    assert exported["$id"].endswith("/contracts/v3/operations-domain.schema.json")
    assert "FactorySnapshot" in exported["$defs"]
    assert "RecommendationPackage" in exported["$defs"]
