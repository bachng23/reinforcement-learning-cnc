from __future__ import annotations

from datetime import datetime
from enum import Enum
from math import isclose
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


SCHEMA_VERSION = "3.0"

Identifier = Annotated[
    str,
    Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$"),
]
ShortText = Annotated[str, Field(min_length=1, max_length=256)]
LongText = Annotated[str, Field(min_length=1, max_length=4000)]
Probability = Annotated[float, Field(ge=0.0, le=1.0)]
HealthIndex = Annotated[float, Field(ge=0.0, le=1.0)]
NonNegativeFloat = Annotated[float, Field(ge=0.0)]
PositiveFloat = Annotated[float, Field(gt=0.0)]
NonNegativeInt = Annotated[int, Field(ge=0)]
PositiveInt = Annotated[int, Field(ge=1)]
SkillLevel = Annotated[int, Field(ge=1, le=5)]
JsonObject = dict[str, Any]


class ContractModel(BaseModel):
    model_config = ConfigDict(
        allow_inf_nan=False,
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
    )


def _ensure_unique(values: list[str], label: str) -> None:
    if len(values) != len(set(values)):
        raise ValueError(f"{label} values must be unique")


def _ensure_end_after_start(start: datetime, end: datetime, label: str) -> None:
    if end <= start:
        raise ValueError(f"{label} end must be later than start")


class MachineStatus(str, Enum):
    IDLE = "IDLE"
    RUNNING = "RUNNING"
    WARNING = "WARNING"
    MAINTENANCE = "MAINTENANCE"
    FAILED = "FAILED"
    UNAVAILABLE = "UNAVAILABLE"


class TechnicianStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    ASSIGNED = "ASSIGNED"
    OFF_SHIFT = "OFF_SHIFT"
    UNAVAILABLE = "UNAVAILABLE"


class OperationStatus(str, Enum):
    PENDING = "PENDING"
    READY = "READY"
    SCHEDULED = "SCHEDULED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    BLOCKED = "BLOCKED"


class MaintenanceType(str, Enum):
    PREVENTIVE = "PREVENTIVE"
    CORRECTIVE = "CORRECTIVE"


class MaintenancePriority(str, Enum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class MaintenanceRequestStatus(str, Enum):
    OPEN = "OPEN"
    SCHEDULED = "SCHEDULED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class AssignmentType(str, Enum):
    PRODUCTION = "PRODUCTION"
    MAINTENANCE = "MAINTENANCE"
    BLOCKED_TIME = "BLOCKED_TIME"


class AssignmentStatus(str, Enum):
    PROPOSED = "PROPOSED"
    COMMITTED = "COMMITTED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class DecisionMode(str, Enum):
    LIVE = "LIVE"
    SIMULATION_ONLY = "SIMULATION_ONLY"


class DecisionCaseStatus(str, Enum):
    CREATED = "CREATED"
    ANALYZING = "ANALYZING"
    GENERATING = "GENERATING"
    VALIDATING = "VALIDATING"
    EXPLAINING = "EXPLAINING"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    APPROVED = "APPROVED"
    MODIFIED = "MODIFIED"
    REJECTED = "REJECTED"
    COMMITTED = "COMMITTED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class AgentRole(str, Enum):
    SUPERVISOR = "SUPERVISOR"
    PDM = "PDM"
    PRODUCTION_SCHEDULING = "PRODUCTION_SCHEDULING"
    MAINTENANCE_PLANNING = "MAINTENANCE_PLANNING"
    TECHNICIAN_DISPATCH = "TECHNICIAN_DISPATCH"
    INTEGRATED_PLANNING = "INTEGRATED_PLANNING"
    VALIDATION = "VALIDATION"
    EXPLANATION = "EXPLANATION"


class RunStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    WAITING_FOR_DEPENDENCY = "WAITING_FOR_DEPENDENCY"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class ToolCallStatus(str, Enum):
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    TIMED_OUT = "TIMED_OUT"
    CANCELLED = "CANCELLED"


class ToolSideEffect(str, Enum):
    NONE = "NONE"
    PERSIST_ONLY = "PERSIST_ONLY"
    OPERATIONAL_COMMIT = "OPERATIONAL_COMMIT"


class AuditLevel(str, Enum):
    METADATA = "METADATA"
    INPUT_OUTPUT_SUMMARY = "INPUT_OUTPUT_SUMMARY"
    FULL = "FULL"


class MessageKind(str, Enum):
    TASK = "TASK"
    RESULT = "RESULT"
    EVIDENCE = "EVIDENCE"
    FEEDBACK = "FEEDBACK"
    ERROR = "ERROR"


class PlanStrategy(str, Enum):
    CURRENT = "CURRENT"
    PRODUCTION_PRIORITY = "PRODUCTION_PRIORITY"
    BALANCED = "BALANCED"
    RELIABILITY_PRIORITY = "RELIABILITY_PRIORITY"
    MANUAL = "MANUAL"
    EXPERIMENTAL = "EXPERIMENTAL"


class ValidationVerdict(str, Enum):
    VALID = "VALID"
    INVALID = "INVALID"
    ERROR = "ERROR"


class ConstraintSeverity(str, Enum):
    ERROR = "ERROR"
    WARNING = "WARNING"


class HumanDecisionType(str, Enum):
    APPROVE = "APPROVE"
    MODIFY = "MODIFY"
    REJECT = "REJECT"


class DecisionTriggerType(str, Enum):
    HEALTH_ALERT = "HEALTH_ALERT"
    MACHINE_FAILURE = "MACHINE_FAILURE"
    TECHNICIAN_UNAVAILABLE = "TECHNICIAN_UNAVAILABLE"
    MAINTENANCE_REQUESTED = "MAINTENANCE_REQUESTED"
    MANUAL_REPLAN = "MANUAL_REPLAN"
    WHAT_IF = "WHAT_IF"


class DecisionEventType(str, Enum):
    CASE_STATUS_CHANGED = "case.status_changed"
    AGENT_STARTED = "agent.started"
    AGENT_COMPLETED = "agent.completed"
    AGENT_FAILED = "agent.failed"
    TOOL_STARTED = "tool.started"
    TOOL_COMPLETED = "tool.completed"
    TOOL_FAILED = "tool.failed"
    CANDIDATE_CREATED = "candidate.created"
    CANDIDATE_VALIDATED = "candidate.validated"
    RECOMMENDATION_READY = "recommendation.ready"
    HUMAN_DECISION_RECORDED = "human_decision.recorded"
    SCHEDULE_COMMITTED = "schedule.committed"


class TimeWindow(ContractModel):
    start_at: AwareDatetime
    end_at: AwareDatetime

    @model_validator(mode="after")
    def validate_window(self) -> TimeWindow:
        _ensure_end_after_start(self.start_at, self.end_at, "time window")
        return self


class DiscreteRULDistribution(ContractModel):
    support_minutes: list[NonNegativeInt] = Field(min_length=2)
    probability_mass: list[Probability] = Field(min_length=2)
    survival_beyond_horizon: Probability
    model_version: Identifier

    @model_validator(mode="after")
    def validate_distribution(self) -> DiscreteRULDistribution:
        if len(self.support_minutes) != len(self.probability_mass):
            raise ValueError("support_minutes and probability_mass must have equal length")
        if self.support_minutes[0] != 0:
            raise ValueError("support_minutes must begin at zero")
        if any(
            right <= left
            for left, right in zip(self.support_minutes, self.support_minutes[1:])
        ):
            raise ValueError("support_minutes must be strictly increasing")
        total = sum(self.probability_mass) + self.survival_beyond_horizon
        if not isclose(total, 1.0, rel_tol=0.0, abs_tol=1e-6):
            raise ValueError("probability_mass plus survival_beyond_horizon must sum to one")
        return self


class MachineCapability(ContractModel):
    operation_type: Identifier
    nominal_processing_minutes: PositiveInt
    load_factor: PositiveFloat = 1.0
    damage_factor: PositiveFloat = 1.0


class Machine(ContractModel):
    machine_id: Identifier
    display_name: ShortText
    machine_family: Identifier
    status: MachineStatus
    capabilities: list[MachineCapability] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_capabilities(self) -> Machine:
        _ensure_unique(
            [capability.operation_type for capability in self.capabilities],
            "machine capability operation_type",
        )
        return self


class MachineOption(ContractModel):
    machine_id: Identifier
    processing_minutes: PositiveInt
    load_factor: PositiveFloat = 1.0
    expected_damage: NonNegativeFloat | None = None


class Operation(ContractModel):
    operation_id: Identifier
    sequence: NonNegativeInt
    operation_type: Identifier
    status: OperationStatus = OperationStatus.PENDING
    predecessor_operation_ids: list[Identifier] = Field(default_factory=list)
    machine_options: list[MachineOption] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_operation(self) -> Operation:
        _ensure_unique(self.predecessor_operation_ids, "predecessor_operation_id")
        _ensure_unique(
            [option.machine_id for option in self.machine_options],
            "operation machine option machine_id",
        )
        if self.operation_id in self.predecessor_operation_ids:
            raise ValueError("an operation cannot depend on itself")
        return self


class ProductionJob(ContractModel):
    job_id: Identifier
    display_name: ShortText
    release_at: AwareDatetime
    due_at: AwareDatetime
    priority: Annotated[int, Field(ge=1, le=100)] = 50
    operations: list[Operation] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_job(self) -> ProductionJob:
        _ensure_end_after_start(self.release_at, self.due_at, "job")
        operation_ids = [operation.operation_id for operation in self.operations]
        _ensure_unique(operation_ids, "operation_id within a job")
        sequences = [operation.sequence for operation in self.operations]
        _ensure_unique([str(sequence) for sequence in sequences], "operation sequence")
        known = set(operation_ids)
        operation_by_id = {operation.operation_id: operation for operation in self.operations}
        for operation in self.operations:
            missing = set(operation.predecessor_operation_ids) - known
            if missing:
                raise ValueError(
                    f"operation {operation.operation_id} references unknown predecessors: "
                    f"{sorted(missing)}"
                )
            if any(
                operation_by_id[predecessor_id].sequence >= operation.sequence
                for predecessor_id in operation.predecessor_operation_ids
            ):
                raise ValueError(
                    "operation predecessors must have a lower sequence than their successor"
                )
        return self


class TechnicianSkill(ContractModel):
    skill_id: Identifier
    level: SkillLevel
    certified_machine_families: list[Identifier] = Field(default_factory=list)
    certified_action_types: list[Identifier] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_certifications(self) -> TechnicianSkill:
        _ensure_unique(self.certified_machine_families, "certified machine family")
        _ensure_unique(self.certified_action_types, "certified action type")
        return self


class Technician(ContractModel):
    technician_id: Identifier
    display_name: ShortText
    status: TechnicianStatus
    availability: list[TimeWindow] = Field(default_factory=list)
    skills: list[TechnicianSkill] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_skills(self) -> Technician:
        _ensure_unique([skill.skill_id for skill in self.skills], "technician skill_id")
        return self


class HealthSnapshot(ContractModel):
    health_snapshot_id: Identifier
    machine_id: Identifier
    observed_at: AwareDatetime
    health_index: HealthIndex
    observed_wear_um: NonNegativeFloat | None = None
    failure_probability_horizon_minutes: PositiveInt
    failure_probability: Probability
    rul_distribution: DiscreteRULDistribution | None = None
    confidence: Literal["LOW", "MEDIUM", "HIGH"]
    source_model_version: Identifier


class MaintenanceRequest(ContractModel):
    maintenance_request_id: Identifier
    machine_id: Identifier
    maintenance_type: MaintenanceType
    action_type: Identifier
    priority: MaintenancePriority
    status: MaintenanceRequestStatus
    requested_at: AwareDatetime
    earliest_start_at: AwareDatetime
    latest_start_at: AwareDatetime | None = None
    expected_duration_minutes: PositiveInt
    required_skill_ids: list[Identifier] = Field(min_length=1)
    minimum_skill_level: SkillLevel = 1
    mandatory: bool = False

    @model_validator(mode="after")
    def validate_request(self) -> MaintenanceRequest:
        _ensure_unique(self.required_skill_ids, "required skill_id")
        if self.latest_start_at is not None and self.latest_start_at < self.earliest_start_at:
            raise ValueError("latest_start_at cannot be earlier than earliest_start_at")
        if self.maintenance_type is MaintenanceType.CORRECTIVE and not self.mandatory:
            raise ValueError("corrective maintenance requests must be mandatory")
        return self


class ScheduleAssignment(ContractModel):
    assignment_id: Identifier
    assignment_type: AssignmentType
    status: AssignmentStatus
    machine_id: Identifier
    start_at: AwareDatetime
    end_at: AwareDatetime
    locked: bool = False
    job_id: Identifier | None = None
    operation_id: Identifier | None = None
    maintenance_request_id: Identifier | None = None
    technician_ids: list[Identifier] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_assignment_shape(self) -> ScheduleAssignment:
        _ensure_end_after_start(self.start_at, self.end_at, "schedule assignment")
        _ensure_unique(self.technician_ids, "assignment technician_id")

        if self.assignment_type is AssignmentType.PRODUCTION:
            if self.job_id is None or self.operation_id is None:
                raise ValueError("production assignments require job_id and operation_id")
            if self.maintenance_request_id is not None or self.technician_ids:
                raise ValueError(
                    "production assignments cannot reference maintenance or technicians"
                )
        elif self.assignment_type is AssignmentType.MAINTENANCE:
            if self.maintenance_request_id is None or not self.technician_ids:
                raise ValueError(
                    "maintenance assignments require maintenance_request_id and technician_ids"
                )
            if self.job_id is not None or self.operation_id is not None:
                raise ValueError("maintenance assignments cannot reference production work")
        else:
            if any(
                value is not None
                for value in (self.job_id, self.operation_id, self.maintenance_request_id)
            ) or self.technician_ids:
                raise ValueError("blocked-time assignments cannot reference work entities")
        return self


class Schedule(ContractModel):
    schedule_id: Identifier
    factory_id: Identifier
    revision: PositiveInt
    planning_window: TimeWindow
    created_at: AwareDatetime
    assignments: list[ScheduleAssignment] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_assignments(self) -> Schedule:
        _ensure_unique(
            [assignment.assignment_id for assignment in self.assignments],
            "schedule assignment_id",
        )
        for assignment in self.assignments:
            if (
                assignment.start_at < self.planning_window.start_at
                or assignment.end_at > self.planning_window.end_at
            ):
                raise ValueError("schedule assignments must fit inside planning_window")
        return self


class FactorySnapshot(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    snapshot_id: Identifier
    factory_id: Identifier
    captured_at: AwareDatetime
    planning_window: TimeWindow
    machines: list[Machine] = Field(min_length=1)
    jobs: list[ProductionJob] = Field(default_factory=list)
    technicians: list[Technician] = Field(default_factory=list)
    health_snapshots: list[HealthSnapshot] = Field(default_factory=list)
    maintenance_requests: list[MaintenanceRequest] = Field(default_factory=list)
    current_schedule: Schedule | None = None

    @model_validator(mode="after")
    def validate_references(self) -> FactorySnapshot:
        machine_ids = [machine.machine_id for machine in self.machines]
        technician_ids = [technician.technician_id for technician in self.technicians]
        job_ids = [job.job_id for job in self.jobs]
        request_ids = [request.maintenance_request_id for request in self.maintenance_requests]
        health_ids = [health.health_snapshot_id for health in self.health_snapshots]
        _ensure_unique(machine_ids, "machine_id")
        _ensure_unique(technician_ids, "technician_id")
        _ensure_unique(job_ids, "job_id")
        _ensure_unique(request_ids, "maintenance_request_id")
        _ensure_unique(health_ids, "health_snapshot_id")
        _ensure_unique(
            [health.machine_id for health in self.health_snapshots],
            "health snapshot machine_id",
        )

        known_machines = set(machine_ids)
        machine_by_id = {machine.machine_id: machine for machine in self.machines}
        known_technicians = set(technician_ids)
        known_requests = set(request_ids)
        operation_to_job: dict[str, str] = {}
        for job in self.jobs:
            for operation in job.operations:
                if operation.operation_id in operation_to_job:
                    raise ValueError("operation_id values must be unique across the factory snapshot")
                operation_to_job[operation.operation_id] = job.job_id
                missing_machines = {
                    option.machine_id for option in operation.machine_options
                } - known_machines
                if missing_machines:
                    raise ValueError(
                        f"operation {operation.operation_id} references unknown machines: "
                        f"{sorted(missing_machines)}"
                    )
                for option in operation.machine_options:
                    supported_types = {
                        capability.operation_type
                        for capability in machine_by_id[option.machine_id].capabilities
                    }
                    if operation.operation_type not in supported_types:
                        raise ValueError(
                            f"machine {option.machine_id} does not support operation type "
                            f"{operation.operation_type}"
                        )

        for health in self.health_snapshots:
            if health.machine_id not in known_machines:
                raise ValueError("health snapshot references an unknown machine")
        for request in self.maintenance_requests:
            if request.machine_id not in known_machines:
                raise ValueError("maintenance request references an unknown machine")

        if self.current_schedule is not None:
            if self.current_schedule.factory_id != self.factory_id:
                raise ValueError("current schedule must reference the snapshot factory")
            if self.current_schedule.planning_window != self.planning_window:
                raise ValueError("current schedule and snapshot planning windows must match")
            for assignment in self.current_schedule.assignments:
                if assignment.machine_id not in known_machines:
                    raise ValueError("schedule assignment references an unknown machine")
                if assignment.assignment_type is AssignmentType.PRODUCTION:
                    expected_job = operation_to_job.get(assignment.operation_id or "")
                    if expected_job is None or expected_job != assignment.job_id:
                        raise ValueError(
                            "production assignment must reference a known operation and its job"
                        )
                if assignment.assignment_type is AssignmentType.MAINTENANCE:
                    if assignment.maintenance_request_id not in known_requests:
                        raise ValueError(
                            "maintenance assignment references an unknown maintenance request"
                        )
                    if not set(assignment.technician_ids).issubset(known_technicians):
                        raise ValueError(
                            "maintenance assignment references an unknown technician"
                        )
        return self


class ObjectiveWeights(ContractModel):
    production: NonNegativeFloat = 1.0
    reliability: NonNegativeFloat = 1.0
    maintenance: NonNegativeFloat = 1.0
    workforce: NonNegativeFloat = 1.0
    schedule_stability: NonNegativeFloat = 0.25

    @model_validator(mode="after")
    def validate_nonzero_objective(self) -> ObjectiveWeights:
        if isclose(
            self.production
            + self.reliability
            + self.maintenance
            + self.workforce
            + self.schedule_stability,
            0.0,
            abs_tol=1e-12,
        ):
            raise ValueError("at least one objective weight must be positive")
        return self


class PlanningConfig(ContractModel):
    horizon_minutes: PositiveInt
    candidate_limit: Annotated[int, Field(ge=1, le=5)] = 3
    solver_timeout_seconds: Annotated[int, Field(ge=1, le=300)] = 30
    simulation_runs: Annotated[int, Field(ge=1, le=10000)] = 100
    base_seed: NonNegativeInt = 0
    objective_weights: ObjectiveWeights = Field(default_factory=ObjectiveWeights)
    allowed_strategy_ids: list[Identifier] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_strategies(self) -> PlanningConfig:
        _ensure_unique(self.allowed_strategy_ids, "allowed strategy_id")
        return self


class HealthAlertTrigger(ContractModel):
    type: Literal["HEALTH_ALERT"] = "HEALTH_ALERT"
    event_id: Identifier
    occurred_at: AwareDatetime
    machine_id: Identifier
    failure_probability: Probability
    alert_threshold: Probability

    @model_validator(mode="after")
    def validate_alert(self) -> HealthAlertTrigger:
        if self.failure_probability < self.alert_threshold:
            raise ValueError("health alert probability must meet or exceed its threshold")
        return self


class MachineFailureTrigger(ContractModel):
    type: Literal["MACHINE_FAILURE"] = "MACHINE_FAILURE"
    event_id: Identifier
    occurred_at: AwareDatetime
    machine_id: Identifier
    failure_code: Identifier


class TechnicianUnavailableTrigger(ContractModel):
    type: Literal["TECHNICIAN_UNAVAILABLE"] = "TECHNICIAN_UNAVAILABLE"
    event_id: Identifier
    occurred_at: AwareDatetime
    technician_id: Identifier
    unavailable_window: TimeWindow
    reason: ShortText


class MaintenanceRequestedTrigger(ContractModel):
    type: Literal["MAINTENANCE_REQUESTED"] = "MAINTENANCE_REQUESTED"
    event_id: Identifier
    occurred_at: AwareDatetime
    maintenance_request_id: Identifier


class ManualReplanTrigger(ContractModel):
    type: Literal["MANUAL_REPLAN"] = "MANUAL_REPLAN"
    event_id: Identifier
    occurred_at: AwareDatetime
    requested_by_user_id: Identifier
    reason: LongText


class WhatIfTrigger(ContractModel):
    type: Literal["WHAT_IF"] = "WHAT_IF"
    event_id: Identifier
    occurred_at: AwareDatetime
    requested_by_user_id: Identifier
    scenario_id: Identifier
    assumptions: JsonObject


DecisionTrigger = Annotated[
    HealthAlertTrigger
    | MachineFailureTrigger
    | TechnicianUnavailableTrigger
    | MaintenanceRequestedTrigger
    | ManualReplanTrigger
    | WhatIfTrigger,
    Field(discriminator="type"),
]


class RunDecisionCaseRequest(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    decision_case_id: Identifier
    mode: DecisionMode
    factory_snapshot: FactorySnapshot
    trigger: DecisionTrigger
    planning_config: PlanningConfig
    requested_by_user_id: Identifier | None = None

    @model_validator(mode="after")
    def validate_mode(self) -> RunDecisionCaseRequest:
        if isinstance(self.trigger, WhatIfTrigger) and self.mode is not DecisionMode.SIMULATION_ONLY:
            raise ValueError("WHAT_IF triggers require SIMULATION_ONLY mode")
        machine_ids = {machine.machine_id for machine in self.factory_snapshot.machines}
        technician_ids = {
            technician.technician_id for technician in self.factory_snapshot.technicians
        }
        request_ids = {
            request.maintenance_request_id
            for request in self.factory_snapshot.maintenance_requests
        }
        if isinstance(self.trigger, (HealthAlertTrigger, MachineFailureTrigger)):
            if self.trigger.machine_id not in machine_ids:
                raise ValueError("decision trigger references an unknown machine")
        if isinstance(self.trigger, TechnicianUnavailableTrigger):
            if self.trigger.technician_id not in technician_ids:
                raise ValueError("decision trigger references an unknown technician")
        if isinstance(self.trigger, MaintenanceRequestedTrigger):
            if self.trigger.maintenance_request_id not in request_ids:
                raise ValueError("decision trigger references an unknown maintenance request")
        return self


class RiskDriver(ContractModel):
    code: Identifier
    description: ShortText
    contribution: NonNegativeFloat | None = None
    evidence_refs: list[Identifier] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_evidence(self) -> RiskDriver:
        _ensure_unique(self.evidence_refs, "risk driver evidence_ref")
        return self


class MachineRiskReport(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    risk_report_id: Identifier
    decision_case_id: Identifier
    snapshot_id: Identifier
    generated_by_agent_run_id: Identifier
    generated_at: AwareDatetime
    machine_id: Identifier
    prediction_horizon_minutes: PositiveInt
    expected_rul_minutes: NonNegativeFloat | None = None
    failure_probability: Probability
    confidence: Literal["LOW", "MEDIUM", "HIGH"]
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    recommended_review_window_minutes: NonNegativeInt
    risk_drivers: list[RiskDriver] = Field(min_length=1)
    evidence_refs: list[Identifier] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_report(self) -> MachineRiskReport:
        _ensure_unique(self.evidence_refs, "machine risk report evidence_ref")
        return self


class ProductionRoutingOption(ContractModel):
    routing_option_id: Identifier
    job_id: Identifier
    operation_id: Identifier
    machine_id: Identifier
    proposed_window: TimeWindow
    expected_processing_minutes: PositiveInt
    expected_tardiness_minutes: NonNegativeFloat
    expected_damage: NonNegativeFloat | None = None
    reason_codes: list[Identifier] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_reasons(self) -> ProductionRoutingOption:
        _ensure_unique(self.reason_codes, "production routing reason_code")
        return self


class ProductionOptionSet(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    production_option_set_id: Identifier
    decision_case_id: Identifier
    snapshot_id: Identifier
    generated_by_agent_run_id: Identifier
    generated_at: AwareDatetime
    affected_job_ids: list[Identifier]
    affected_operation_ids: list[Identifier]
    routing_options: list[ProductionRoutingOption] = Field(min_length=1)
    evidence_refs: list[Identifier] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_options(self) -> ProductionOptionSet:
        _ensure_unique(self.affected_job_ids, "affected job_id")
        _ensure_unique(self.affected_operation_ids, "affected operation_id")
        _ensure_unique(
            [option.routing_option_id for option in self.routing_options],
            "production routing_option_id",
        )
        _ensure_unique(self.evidence_refs, "production option evidence_ref")
        affected_jobs = set(self.affected_job_ids)
        affected_operations = set(self.affected_operation_ids)
        if any(option.job_id not in affected_jobs for option in self.routing_options):
            raise ValueError("routing options must reference an affected job")
        if any(
            option.operation_id not in affected_operations for option in self.routing_options
        ):
            raise ValueError("routing options must reference an affected operation")
        return self


class MaintenanceDecision(str, Enum):
    MAINTAIN_NOW = "MAINTAIN_NOW"
    MAINTAIN_IN_WINDOW = "MAINTAIN_IN_WINDOW"
    CONTINUE_AND_MONITOR = "CONTINUE_AND_MONITOR"
    CORRECTIVE_REPAIR = "CORRECTIVE_REPAIR"


class MaintenanceOption(ContractModel):
    maintenance_option_id: Identifier
    maintenance_request_id: Identifier
    machine_id: Identifier
    decision: MaintenanceDecision
    proposed_window: TimeWindow | None = None
    expected_duration_minutes: PositiveInt | None = None
    expected_failure_probability: Probability
    expected_maintenance_cost: NonNegativeFloat
    expected_restoration_effectiveness: Probability | None = None
    required_skill_ids: list[Identifier] = Field(default_factory=list)
    reason_codes: list[Identifier] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_option(self) -> MaintenanceOption:
        _ensure_unique(self.required_skill_ids, "maintenance option required skill_id")
        _ensure_unique(self.reason_codes, "maintenance option reason_code")
        if self.decision is MaintenanceDecision.CONTINUE_AND_MONITOR:
            if self.proposed_window is not None or self.expected_duration_minutes is not None:
                raise ValueError(
                    "CONTINUE_AND_MONITOR cannot contain an intervention window or duration"
                )
        elif self.proposed_window is None or self.expected_duration_minutes is None:
            raise ValueError("maintenance interventions require a window and duration")
        return self


class MaintenanceOptionSet(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    maintenance_option_set_id: Identifier
    decision_case_id: Identifier
    snapshot_id: Identifier
    generated_by_agent_run_id: Identifier
    generated_at: AwareDatetime
    options: list[MaintenanceOption] = Field(min_length=1)
    evidence_refs: list[Identifier] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_options(self) -> MaintenanceOptionSet:
        _ensure_unique(
            [option.maintenance_option_id for option in self.options],
            "maintenance_option_id",
        )
        _ensure_unique(self.evidence_refs, "maintenance option set evidence_ref")
        return self


class TechnicianCandidate(ContractModel):
    technician_candidate_id: Identifier
    maintenance_option_id: Identifier
    technician_id: Identifier
    available_window: TimeWindow
    expected_duration_minutes: PositiveInt
    skill_match_level: SkillLevel
    expected_restoration_effectiveness: Probability
    expected_workforce_cost: NonNegativeFloat
    reason_codes: list[Identifier] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_reasons(self) -> TechnicianCandidate:
        _ensure_unique(self.reason_codes, "technician candidate reason_code")
        return self


class TechnicianOptionSet(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    technician_option_set_id: Identifier
    decision_case_id: Identifier
    snapshot_id: Identifier
    generated_by_agent_run_id: Identifier
    generated_at: AwareDatetime
    candidates: list[TechnicianCandidate] = Field(default_factory=list)
    unstaffed_maintenance_option_ids: list[Identifier] = Field(default_factory=list)
    evidence_refs: list[Identifier] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_candidates(self) -> TechnicianOptionSet:
        _ensure_unique(
            [candidate.technician_candidate_id for candidate in self.candidates],
            "technician_candidate_id",
        )
        _ensure_unique(
            self.unstaffed_maintenance_option_ids,
            "unstaffed maintenance_option_id",
        )
        _ensure_unique(self.evidence_refs, "technician option set evidence_ref")
        staffed = {candidate.maintenance_option_id for candidate in self.candidates}
        if staffed.intersection(self.unstaffed_maintenance_option_ids):
            raise ValueError(
                "a maintenance option cannot be both staffed and explicitly unstaffed"
            )
        return self


class ToolDefinition(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    tool_id: Identifier
    version: Identifier
    description: ShortText
    owner_service: Identifier
    input_schema_ref: ShortText
    output_schema_ref: ShortText
    timeout_ms: PositiveInt
    side_effect: ToolSideEffect = ToolSideEffect.NONE
    allowed_agent_roles: list[AgentRole] = Field(min_length=1)
    audit_level: AuditLevel = AuditLevel.INPUT_OUTPUT_SUMMARY

    @model_validator(mode="after")
    def validate_agent_roles(self) -> ToolDefinition:
        _ensure_unique([role.value for role in self.allowed_agent_roles], "allowed agent role")
        if (
            self.side_effect is ToolSideEffect.OPERATIONAL_COMMIT
            and AgentRole.SUPERVISOR not in self.allowed_agent_roles
        ):
            raise ValueError("operational commit tools must be restricted through SUPERVISOR")
        return self


class AgentDefinition(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    agent_id: Identifier
    version: Identifier
    role: AgentRole
    display_name: ShortText
    goal: LongText
    allowed_tool_ids: list[Identifier] = Field(default_factory=list)
    timeout_seconds: PositiveInt
    max_tool_calls: PositiveInt

    @model_validator(mode="after")
    def validate_tools(self) -> AgentDefinition:
        _ensure_unique(self.allowed_tool_ids, "allowed tool_id")
        return self


class AgentTask(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    task_id: Identifier
    decision_case_id: Identifier
    assigned_role: AgentRole
    objective: LongText
    input_refs: list[Identifier] = Field(default_factory=list)
    dependency_task_ids: list[Identifier] = Field(default_factory=list)
    created_at: AwareDatetime

    @model_validator(mode="after")
    def validate_task(self) -> AgentTask:
        _ensure_unique(self.input_refs, "agent task input_ref")
        _ensure_unique(self.dependency_task_ids, "agent task dependency_task_id")
        if self.task_id in self.dependency_task_ids:
            raise ValueError("an agent task cannot depend on itself")
        return self


class AgentMessage(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    message_id: Identifier
    decision_case_id: Identifier
    correlation_id: Identifier
    from_agent_run_id: Identifier
    to_agent_role: AgentRole
    kind: MessageKind
    subject: ShortText
    created_at: AwareDatetime
    payload: JsonObject
    evidence_refs: list[Identifier] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_evidence(self) -> AgentMessage:
        _ensure_unique(self.evidence_refs, "agent message evidence_ref")
        return self


class ToolCallTrace(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    tool_call_id: Identifier
    decision_case_id: Identifier
    agent_run_id: Identifier
    correlation_id: Identifier
    tool_id: Identifier
    tool_version: Identifier
    status: ToolCallStatus
    started_at: AwareDatetime
    completed_at: AwareDatetime | None = None
    input_summary: JsonObject
    output_summary: JsonObject | None = None
    evidence_refs: list[Identifier] = Field(default_factory=list)
    error_code: Identifier | None = None
    retry_count: NonNegativeInt = 0

    @model_validator(mode="after")
    def validate_tool_trace(self) -> ToolCallTrace:
        _ensure_unique(self.evidence_refs, "tool call evidence_ref")
        terminal = {
            ToolCallStatus.SUCCEEDED,
            ToolCallStatus.FAILED,
            ToolCallStatus.TIMED_OUT,
            ToolCallStatus.CANCELLED,
        }
        if self.status in terminal and self.completed_at is None:
            raise ValueError("terminal tool calls require completed_at")
        if self.status is ToolCallStatus.RUNNING and self.completed_at is not None:
            raise ValueError("running tool calls cannot have completed_at")
        if self.completed_at is not None:
            _ensure_end_after_start(self.started_at, self.completed_at, "tool call")
        if self.status is ToolCallStatus.SUCCEEDED and self.output_summary is None:
            raise ValueError("successful tool calls require output_summary")
        if self.status in {ToolCallStatus.FAILED, ToolCallStatus.TIMED_OUT} and self.error_code is None:
            raise ValueError("failed or timed-out tool calls require error_code")
        return self


class AgentRunTrace(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    agent_run_id: Identifier
    decision_case_id: Identifier
    task_id: Identifier
    agent_id: Identifier
    agent_version: Identifier
    role: AgentRole
    status: RunStatus
    started_at: AwareDatetime | None = None
    completed_at: AwareDatetime | None = None
    output_ref: Identifier | None = None
    error_code: Identifier | None = None
    tool_call_ids: list[Identifier] = Field(default_factory=list)
    message_ids: list[Identifier] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_run(self) -> AgentRunTrace:
        _ensure_unique(self.tool_call_ids, "agent run tool_call_id")
        _ensure_unique(self.message_ids, "agent run message_id")
        if self.status is RunStatus.QUEUED:
            if self.started_at is not None or self.completed_at is not None:
                raise ValueError("queued agent runs cannot have execution timestamps")
        elif self.started_at is None:
            raise ValueError("non-queued agent runs require started_at")
        if self.status in {RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED}:
            if self.completed_at is None:
                raise ValueError("terminal agent runs require completed_at")
        elif self.completed_at is not None:
            raise ValueError("non-terminal agent runs cannot have completed_at")
        if self.started_at is not None and self.completed_at is not None:
            _ensure_end_after_start(self.started_at, self.completed_at, "agent run")
        if self.status is RunStatus.COMPLETED and self.output_ref is None:
            raise ValueError("completed agent runs require output_ref")
        if self.status is RunStatus.FAILED and self.error_code is None:
            raise ValueError("failed agent runs require error_code")
        return self


class PlanKPIs(ContractModel):
    makespan_minutes: NonNegativeFloat
    total_tardiness_minutes: NonNegativeFloat
    maximum_tardiness_minutes: NonNegativeFloat
    on_time_completion_rate: Probability
    expected_failure_count: NonNegativeFloat
    failure_probability: Probability
    expected_emergency_downtime_minutes: NonNegativeFloat
    maintenance_cost: NonNegativeFloat
    technician_utilization: Probability
    schedule_changes: NonNegativeInt
    decision_latency_ms: NonNegativeInt | None = None


class ConstraintViolation(ContractModel):
    violation_id: Identifier
    constraint_code: Identifier
    severity: ConstraintSeverity
    message: ShortText
    entity_refs: list[Identifier] = Field(default_factory=list)
    time_window: TimeWindow | None = None

    @model_validator(mode="after")
    def validate_refs(self) -> ConstraintViolation:
        _ensure_unique(self.entity_refs, "constraint violation entity_ref")
        return self


class PlanValidation(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    validation_id: Identifier
    candidate_plan_id: Identifier
    validator_version: Identifier
    verdict: ValidationVerdict
    validated_at: AwareDatetime
    violations: list[ConstraintViolation] = Field(default_factory=list)
    simulation_runs: NonNegativeInt = 0
    warnings: list[ShortText] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_verdict(self) -> PlanValidation:
        error_count = sum(
            violation.severity is ConstraintSeverity.ERROR for violation in self.violations
        )
        if self.verdict is ValidationVerdict.VALID and error_count:
            raise ValueError("valid plans cannot contain ERROR violations")
        if self.verdict is ValidationVerdict.INVALID and not error_count:
            raise ValueError("invalid plans require at least one ERROR violation")
        return self


class CandidatePlan(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    candidate_plan_id: Identifier
    decision_case_id: Identifier
    snapshot_id: Identifier
    plan_version: PositiveInt
    strategy: PlanStrategy
    source_engine_id: Identifier
    source_engine_version: Identifier
    generated_at: AwareDatetime
    schedule: Schedule
    kpis: PlanKPIs
    source_agent_run_ids: list[Identifier] = Field(default_factory=list)
    assumptions: list[ShortText] = Field(default_factory=list)
    warnings: list[ShortText] = Field(default_factory=list)
    validation: PlanValidation | None = None

    @model_validator(mode="after")
    def validate_plan(self) -> CandidatePlan:
        _ensure_unique(self.source_agent_run_ids, "candidate source agent_run_id")
        if (
            self.validation is not None
            and self.validation.candidate_plan_id != self.candidate_plan_id
        ):
            raise ValueError("plan validation must reference the candidate plan")
        return self


class RecommendationExplanation(ContractModel):
    summary: LongText
    primary_reasons: list[ShortText] = Field(min_length=1)
    tradeoffs: list[ShortText] = Field(min_length=1)
    residual_risks: list[ShortText] = Field(default_factory=list)
    evidence_refs: list[Identifier] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_evidence(self) -> RecommendationExplanation:
        _ensure_unique(self.evidence_refs, "recommendation evidence_ref")
        return self


class RecommendationPackage(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    recommendation_id: Identifier
    decision_case_id: Identifier
    snapshot_id: Identifier
    generated_at: AwareDatetime
    recommended_plan_id: Identifier
    candidate_plans: list[CandidatePlan] = Field(min_length=1, max_length=5)
    explanation: RecommendationExplanation

    @model_validator(mode="after")
    def validate_recommendation(self) -> RecommendationPackage:
        plan_ids = [plan.candidate_plan_id for plan in self.candidate_plans]
        _ensure_unique(plan_ids, "recommendation candidate_plan_id")
        if self.recommended_plan_id not in set(plan_ids):
            raise ValueError("recommended_plan_id must reference a candidate plan")
        for plan in self.candidate_plans:
            if plan.decision_case_id != self.decision_case_id:
                raise ValueError("all plans must reference the recommendation decision case")
            if plan.snapshot_id != self.snapshot_id:
                raise ValueError("all plans must reference the recommendation snapshot")
            if plan.validation is None or plan.validation.verdict is not ValidationVerdict.VALID:
                raise ValueError("recommendations may contain only validated plans")
        return self


class HumanDecisionRequest(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    decision_case_id: Identifier
    recommendation_id: Identifier
    expected_snapshot_id: Identifier
    decision: HumanDecisionType
    candidate_plan_id: Identifier | None = None
    expected_plan_version: PositiveInt | None = None
    modified_schedule: Schedule | None = None
    note: LongText | None = None

    @model_validator(mode="after")
    def validate_decision(self) -> HumanDecisionRequest:
        if self.decision is HumanDecisionType.APPROVE:
            if self.candidate_plan_id is None or self.expected_plan_version is None:
                raise ValueError("approval requires candidate_plan_id and expected_plan_version")
            if self.modified_schedule is not None:
                raise ValueError("approval cannot include a modified schedule")
        elif self.decision is HumanDecisionType.MODIFY:
            if (
                self.candidate_plan_id is None
                or self.expected_plan_version is None
                or self.modified_schedule is None
            ):
                raise ValueError(
                    "modification requires candidate_plan_id, expected_plan_version, and modified_schedule"
                )
        else:
            if self.candidate_plan_id is not None or self.modified_schedule is not None:
                raise ValueError("rejection cannot select or modify a candidate plan")
            if self.note is None:
                raise ValueError("rejection requires a note")
        return self


class DecisionCaseStatusResponse(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    decision_case_id: Identifier
    mode: DecisionMode
    status: DecisionCaseStatus
    snapshot_id: Identifier
    created_at: AwareDatetime
    updated_at: AwareDatetime
    recommendation_id: Identifier | None = None
    committed_schedule_id: Identifier | None = None
    error_code: Identifier | None = None

    @model_validator(mode="after")
    def validate_status(self) -> DecisionCaseStatusResponse:
        if self.updated_at < self.created_at:
            raise ValueError("updated_at cannot be earlier than created_at")
        if self.status is DecisionCaseStatus.AWAITING_APPROVAL and self.recommendation_id is None:
            raise ValueError("AWAITING_APPROVAL requires recommendation_id")
        if self.status is DecisionCaseStatus.COMMITTED and self.committed_schedule_id is None:
            raise ValueError("COMMITTED requires committed_schedule_id")
        if self.status is DecisionCaseStatus.FAILED and self.error_code is None:
            raise ValueError("FAILED requires error_code")
        if self.mode is DecisionMode.SIMULATION_ONLY and self.status is DecisionCaseStatus.COMMITTED:
            raise ValueError("SIMULATION_ONLY decision cases cannot be committed")
        return self


class DecisionEvent(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    event_id: Identifier
    sequence: NonNegativeInt
    decision_case_id: Identifier
    event_type: DecisionEventType
    occurred_at: AwareDatetime
    subject_id: Identifier
    correlation_id: Identifier
    payload: JsonObject


class ErrorDetail(ContractModel):
    field: ShortText | None = None
    code: Identifier
    message: ShortText


class ErrorResponse(ContractModel):
    schema_version: Literal["3.0"] = SCHEMA_VERSION
    error_id: Identifier
    code: Identifier
    message: ShortText
    correlation_id: Identifier
    retryable: bool = False
    details: list[ErrorDetail] = Field(default_factory=list)


class OperationsContractCatalog(ContractModel):
    """Schema-export catalog. This wrapper is not itself a wire payload."""

    factory_snapshot: FactorySnapshot
    run_decision_case_request: RunDecisionCaseRequest
    machine_risk_report: MachineRiskReport
    production_option_set: ProductionOptionSet
    maintenance_option_set: MaintenanceOptionSet
    technician_option_set: TechnicianOptionSet
    decision_case_status_response: DecisionCaseStatusResponse
    agent_definition: AgentDefinition
    tool_definition: ToolDefinition
    agent_task: AgentTask
    agent_run_trace: AgentRunTrace
    agent_message: AgentMessage
    tool_call_trace: ToolCallTrace
    candidate_plan: CandidatePlan
    plan_validation: PlanValidation
    recommendation_package: RecommendationPackage
    human_decision_request: HumanDecisionRequest
    decision_event: DecisionEvent
    error_response: ErrorResponse
