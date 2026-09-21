from __future__ import annotations

from datetime import datetime, timedelta, timezone

from domain.operations.contracts import (
    AssignmentStatus,
    AssignmentType,
    CandidatePlan,
    FactorySnapshot,
    HealthAlertTrigger,
    HealthSnapshot,
    Machine,
    MachineCapability,
    MachineOption,
    MachineStatus,
    MaintenancePriority,
    MaintenanceRequest,
    MaintenanceRequestStatus,
    MaintenanceType,
    Operation,
    OperationStatus,
    PlanKPIs,
    PlanStrategy,
    PlanValidation,
    PlanningConfig,
    ProductionJob,
    Schedule,
    ScheduleAssignment,
    Technician,
    TechnicianSkill,
    TechnicianStatus,
    TimeWindow,
    ValidationVerdict,
)
from domain.operations.planning import PlanningEngineInput, PlanningEngineOutput


DEMO_T0 = datetime(2026, 9, 22, 0, 0, tzinfo=timezone.utc)  # 08:00 Asia/Taipei
DEMO_WINDOW = TimeWindow(start_at=DEMO_T0, end_at=DEMO_T0 + timedelta(hours=12))


def _machine(
    machine_id: str,
    family: str,
    operation_type: str,
    processing_minutes: int,
    *,
    status: MachineStatus = MachineStatus.IDLE,
) -> Machine:
    return Machine(
        machine_id=machine_id,
        display_name=f"CNC {machine_id}",
        machine_family=family,
        status=status,
        capabilities=[
            MachineCapability(
                operation_type=operation_type,
                nominal_processing_minutes=processing_minutes,
            )
        ],
    )


DEMO_MACHINES = [
    _machine("M01", "mill-3-axis", "milling", 60),
    _machine("M02", "mill-3-axis", "milling", 60),
    _machine("M03", "lathe", "turning", 60, status=MachineStatus.WARNING),
    _machine("M04", "lathe", "turning", 60),
    _machine("M05", "drill-cell", "drilling", 45),
    _machine("M06", "inspection-cell", "quality-inspection", 30),
]


def _job(index: int) -> ProductionJob:
    job_id = f"J{index:02d}"
    is_milling = index % 2 == 1
    operation_type = "milling" if is_milling else "turning"
    primary_machines = ("M01", "M02") if is_milling else ("M03", "M04")
    first_operation_id = f"{job_id}-O10"
    return ProductionJob(
        job_id=job_id,
        display_name=f"Demo order {index:02d}",
        release_at=DEMO_T0,
        due_at=DEMO_T0 + timedelta(hours=8 + index // 4),
        priority=90 if index <= 3 else 60,
        operations=[
            Operation(
                operation_id=first_operation_id,
                sequence=10,
                operation_type=operation_type,
                status=OperationStatus.READY,
                machine_options=[
                    MachineOption(machine_id=machine_id, processing_minutes=60)
                    for machine_id in primary_machines
                ],
            ),
            Operation(
                operation_id=f"{job_id}-O20",
                sequence=20,
                operation_type="quality-inspection",
                predecessor_operation_ids=[first_operation_id],
                machine_options=[
                    MachineOption(machine_id="M06", processing_minutes=30)
                ],
            ),
        ],
    )


DEMO_JOBS = [_job(index) for index in range(1, 13)]

DEMO_TECHNICIANS = [
    Technician(
        technician_id="T01",
        display_name="An Nguyen",
        status=TechnicianStatus.AVAILABLE,
        availability=[DEMO_WINDOW],
        skills=[
            TechnicianSkill(
                skill_id="mechanical",
                level=4,
                certified_machine_families=["lathe", "mill-3-axis"],
                certified_action_types=["spindle-inspection", "bearing-replacement"],
            )
        ],
    ),
    Technician(
        technician_id="T02",
        display_name="Binh Tran",
        status=TechnicianStatus.AVAILABLE,
        availability=[
            TimeWindow(
                start_at=DEMO_T0 + timedelta(hours=1),
                end_at=DEMO_WINDOW.end_at,
            )
        ],
        skills=[
            TechnicianSkill(
                skill_id="electrical",
                level=5,
                certified_machine_families=["lathe", "drill-cell"],
                certified_action_types=["servo-diagnostics"],
            )
        ],
    ),
    Technician(
        technician_id="T03",
        display_name="Chi Le",
        status=TechnicianStatus.AVAILABLE,
        availability=[DEMO_WINDOW],
        skills=[
            TechnicianSkill(
                skill_id="mechanical",
                level=3,
                certified_machine_families=["lathe"],
                certified_action_types=["spindle-inspection"],
            )
        ],
    ),
]

DEMO_MAINTENANCE_REQUEST = MaintenanceRequest(
    maintenance_request_id="MR-M03-001",
    machine_id="M03",
    maintenance_type=MaintenanceType.PREVENTIVE,
    action_type="spindle-inspection",
    priority=MaintenancePriority.HIGH,
    status=MaintenanceRequestStatus.OPEN,
    requested_at=DEMO_T0,
    earliest_start_at=DEMO_T0,
    latest_start_at=DEMO_T0 + timedelta(hours=4),
    expected_duration_minutes=60,
    required_skill_ids=["mechanical"],
    minimum_skill_level=4,
)


def _production_assignments(
    machine_choices: dict[str, str],
) -> list[ScheduleAssignment]:
    machine_cursor = {machine.machine_id: DEMO_T0 for machine in DEMO_MACHINES}
    first_end_by_job: dict[str, datetime] = {}
    assignments: list[ScheduleAssignment] = []

    for job in DEMO_JOBS:
        first = job.operations[0]
        machine_id = machine_choices[job.job_id]
        start_at = machine_cursor[machine_id]
        end_at = start_at + timedelta(minutes=60)
        machine_cursor[machine_id] = end_at
        first_end_by_job[job.job_id] = end_at
        assignments.append(
            ScheduleAssignment(
                assignment_id=f"A-{job.job_id}-O10",
                assignment_type=AssignmentType.PRODUCTION,
                status=AssignmentStatus.PROPOSED,
                machine_id=machine_id,
                job_id=job.job_id,
                operation_id=first.operation_id,
                start_at=start_at,
                end_at=end_at,
            )
        )

    inspection_cursor = DEMO_T0
    for job in DEMO_JOBS:
        start_at = max(inspection_cursor, first_end_by_job[job.job_id])
        end_at = start_at + timedelta(minutes=30)
        inspection_cursor = end_at
        assignments.append(
            ScheduleAssignment(
                assignment_id=f"A-{job.job_id}-O20",
                assignment_type=AssignmentType.PRODUCTION,
                status=AssignmentStatus.PROPOSED,
                machine_id="M06",
                job_id=job.job_id,
                operation_id=job.operations[1].operation_id,
                start_at=start_at,
                end_at=end_at,
            )
        )
    return assignments


_CURRENT_CHOICES = {
    **{f"J{index:02d}": "M01" if index % 4 == 1 else "M02" for index in range(1, 13, 2)},
    **{f"J{index:02d}": "M03" if index % 4 == 2 else "M04" for index in range(2, 13, 2)},
}

DEMO_FACTORY_SNAPSHOT = FactorySnapshot(
    snapshot_id="snapshot-demo-20260922-0800",
    factory_id="factory-demo-01",
    captured_at=DEMO_T0,
    planning_window=DEMO_WINDOW,
    machines=DEMO_MACHINES,
    jobs=DEMO_JOBS,
    technicians=DEMO_TECHNICIANS,
    health_snapshots=[
        HealthSnapshot(
            health_snapshot_id="health-M03-001",
            machine_id="M03",
            observed_at=DEMO_T0,
            health_index=0.38,
            observed_wear_um=205.0,
            failure_probability_horizon_minutes=480,
            failure_probability=0.42,
            confidence="HIGH",
            source_model_version="rul-demo-v1",
        )
    ],
    maintenance_requests=[DEMO_MAINTENANCE_REQUEST],
    current_schedule=Schedule(
        schedule_id="schedule-demo-current",
        factory_id="factory-demo-01",
        revision=1,
        planning_window=DEMO_WINDOW,
        created_at=DEMO_T0,
        assignments=_production_assignments(_CURRENT_CHOICES),
    ),
)

DEMO_TRIGGER = HealthAlertTrigger(
    event_id="health-alert-M03-001",
    occurred_at=DEMO_T0,
    machine_id="M03",
    failure_probability=0.42,
    alert_threshold=0.30,
)

DEMO_PLANNING_CONFIG = PlanningConfig(
    horizon_minutes=720,
    candidate_limit=3,
    solver_timeout_seconds=30,
    simulation_runs=100,
    base_seed=20260922,
    allowed_strategy_ids=[
        "production-priority",
        "balanced",
        "reliability-priority",
    ],
)


def _candidate(
    plan_id: str,
    strategy: PlanStrategy,
    machine_choices: dict[str, str],
    maintenance_start: datetime,
    kpis: PlanKPIs,
    tradeoff: str,
) -> tuple[CandidatePlan, PlanValidation]:
    validation = PlanValidation(
        validation_id=f"validation-{plan_id}",
        candidate_plan_id=plan_id,
        validator_version="hard-constraints-v1",
        verdict=ValidationVerdict.VALID,
        validated_at=DEMO_T0 + timedelta(minutes=2),
        simulation_runs=100,
        warnings=[tradeoff],
    )
    schedule = Schedule(
        schedule_id=f"schedule-{plan_id}",
        factory_id="factory-demo-01",
        revision=2,
        planning_window=DEMO_WINDOW,
        created_at=DEMO_T0 + timedelta(minutes=1),
        assignments=[
            *_production_assignments(machine_choices),
            ScheduleAssignment(
                assignment_id=f"A-maintenance-{plan_id}",
                assignment_type=AssignmentType.MAINTENANCE,
                status=AssignmentStatus.PROPOSED,
                machine_id="M03",
                maintenance_request_id="MR-M03-001",
                technician_ids=["T01"],
                start_at=maintenance_start,
                end_at=maintenance_start + timedelta(hours=1),
            ),
        ],
    )
    return (
        CandidatePlan(
            candidate_plan_id=plan_id,
            decision_case_id="case-demo-M03-001",
            snapshot_id=DEMO_FACTORY_SNAPSHOT.snapshot_id,
            plan_version=1,
            strategy=strategy,
            source_engine_id="demo-integrated-planner",
            source_engine_version="1.0.0-draft",
            generated_at=DEMO_T0 + timedelta(minutes=1),
            schedule=schedule,
            kpis=kpis,
            assumptions=["M03 restoration takes exactly 60 minutes"],
            warnings=[tradeoff],
            validation=validation,
        ),
        validation,
    )


_BALANCED_CHOICES = dict(_CURRENT_CHOICES)
_BALANCED_CHOICES["J10"] = "M04"
_RELIABILITY_CHOICES = dict(_CURRENT_CHOICES)
for _job_id in ("J02", "J06", "J10"):
    _RELIABILITY_CHOICES[_job_id] = "M04"

_candidate_specs = [
    _candidate(
        "plan-production-priority",
        PlanStrategy.PRODUCTION_PRIORITY,
        _CURRENT_CHOICES,
        DEMO_T0 + timedelta(hours=3),
        PlanKPIs(
            makespan_minutes=420,
            total_tardiness_minutes=0,
            maximum_tardiness_minutes=0,
            on_time_completion_rate=1.0,
            expected_failure_count=0.18,
            failure_probability=0.16,
            expected_emergency_downtime_minutes=35,
            maintenance_cost=350,
            technician_utilization=0.08,
            schedule_changes=1,
        ),
        "M03 intervention is delayed until its three queued turning operations finish.",
    ),
    _candidate(
        "plan-balanced",
        PlanStrategy.BALANCED,
        _BALANCED_CHOICES,
        DEMO_T0 + timedelta(hours=2),
        PlanKPIs(
            makespan_minutes=420,
            total_tardiness_minutes=8,
            maximum_tardiness_minutes=8,
            on_time_completion_rate=0.92,
            expected_failure_count=0.08,
            failure_probability=0.07,
            expected_emergency_downtime_minutes=16,
            maintenance_cost=380,
            technician_utilization=0.08,
            schedule_changes=3,
        ),
        "One M03 turning operation moves to M04 to open an earlier intervention window.",
    ),
    _candidate(
        "plan-reliability-priority",
        PlanStrategy.RELIABILITY_PRIORITY,
        _RELIABILITY_CHOICES,
        DEMO_T0,
        PlanKPIs(
            makespan_minutes=480,
            total_tardiness_minutes=22,
            maximum_tardiness_minutes=12,
            on_time_completion_rate=0.83,
            expected_failure_count=0.03,
            failure_probability=0.02,
            expected_emergency_downtime_minutes=5,
            maintenance_cost=420,
            technician_utilization=0.08,
            schedule_changes=5,
        ),
        "All initial M03 load moves to M04 so intervention can start immediately.",
    ),
]

DEMO_CANDIDATE_PLANS = [candidate for candidate, _ in _candidate_specs]
DEMO_PLAN_VALIDATIONS = [validation for _, validation in _candidate_specs]

DEMO_PLANNING_INPUT = PlanningEngineInput(
    factory_snapshot=DEMO_FACTORY_SNAPSHOT,
    trigger=DEMO_TRIGGER,
    config=DEMO_PLANNING_CONFIG,
)

DEMO_PLANNING_OUTPUT = PlanningEngineOutput(
    candidate_plans=DEMO_CANDIDATE_PLANS,
    validations=DEMO_PLAN_VALIDATIONS,
)
