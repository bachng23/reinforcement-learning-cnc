/* Generated from contracts/v3/operations-domain.schema.json. Do not edit. */

export type AgentId = string;
export type AllowedToolIds = string[];
export type DisplayName = string;
export type Goal = string;
export type MaxToolCalls = number;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "AgentRole".
 */
export type AgentRole =
  | "SUPERVISOR"
  | "PDM"
  | "PRODUCTION_SCHEDULING"
  | "MAINTENANCE_PLANNING"
  | "TECHNICIAN_DISPATCH"
  | "INTEGRATED_PLANNING"
  | "VALIDATION"
  | "EXPLANATION";
export type SchemaVersion = "3.0";
export type TimeoutSeconds = number;
export type Version = string;
export type CorrelationId = string;
export type CreatedAt = string;
export type DecisionCaseId = string;
export type EvidenceRefs = string[];
export type FromAgentRunId = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MessageKind".
 */
export type MessageKind = "TASK" | "RESULT" | "EVIDENCE" | "FEEDBACK" | "ERROR";
export type MessageId = string;
export type SchemaVersion1 = "3.0";
export type Subject = string;
export type AgentId1 = string;
export type AgentRunId = string;
export type AgentVersion = string;
export type CompletedAt = string | null;
export type DecisionCaseId1 = string;
export type ErrorCode = string | null;
export type MessageIds = string[];
export type OutputRef = string | null;
export type SchemaVersion2 = "3.0";
export type StartedAt = string | null;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "RunStatus".
 */
export type RunStatus = "QUEUED" | "RUNNING" | "WAITING_FOR_DEPENDENCY" | "COMPLETED" | "FAILED" | "CANCELLED";
export type TaskId = string;
export type ToolCallIds = string[];
export type CreatedAt1 = string;
export type DecisionCaseId2 = string;
export type DependencyTaskIds = string[];
export type InputRefs = string[];
export type Objective = string;
export type SchemaVersion3 = "3.0";
export type TaskId1 = string;
export type Assumptions = string[];
export type CandidatePlanId = string;
export type DecisionCaseId3 = string;
export type GeneratedAt = string;
export type DecisionLatencyMs = number | null;
export type ExpectedEmergencyDowntimeMinutes = number;
export type ExpectedFailureCount = number;
export type FailureProbability = number;
export type MaintenanceCost = number;
export type MakespanMinutes = number;
export type MaximumTardinessMinutes = number;
export type OnTimeCompletionRate = number;
export type ScheduleChanges = number;
export type TechnicianUtilization = number;
export type TotalTardinessMinutes = number;
export type PlanVersion = number;
export type AssignmentId = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "AssignmentType".
 */
export type AssignmentType = "PRODUCTION" | "MAINTENANCE" | "BLOCKED_TIME";
export type EndAt = string;
export type JobId = string | null;
export type Locked = boolean;
export type MachineId = string;
export type MaintenanceRequestId = string | null;
export type OperationId = string | null;
export type StartAt = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "AssignmentStatus".
 */
export type AssignmentStatus = "PROPOSED" | "COMMITTED" | "RUNNING" | "COMPLETED" | "CANCELLED";
export type TechnicianIds = string[];
export type Assignments = ScheduleAssignment[];
export type CreatedAt2 = string;
export type FactoryId = string;
export type EndAt1 = string;
export type StartAt1 = string;
export type Revision = number;
export type ScheduleId = string;
export type SchemaVersion4 = "3.0";
export type SnapshotId = string;
export type SourceAgentRunIds = string[];
export type SourceEngineId = string;
export type SourceEngineVersion = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "PlanStrategy".
 */
export type PlanStrategy =
  "CURRENT" | "PRODUCTION_PRIORITY" | "BALANCED" | "RELIABILITY_PRIORITY" | "MANUAL" | "EXPERIMENTAL";
export type CandidatePlanId1 = string;
export type SchemaVersion5 = "3.0";
export type SimulationRuns = number;
export type ValidatedAt = string;
export type ValidationId = string;
export type ValidatorVersion = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ValidationVerdict".
 */
export type ValidationVerdict = "VALID" | "INVALID" | "ERROR";
export type ConstraintCode = string;
export type EntityRefs = string[];
export type Message = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ConstraintSeverity".
 */
export type ConstraintSeverity = "ERROR" | "WARNING";
export type ViolationId = string;
export type Violations = ConstraintViolation[];
export type Warnings = string[];
export type Warnings1 = string[];
export type CommittedScheduleId = string | null;
export type CreatedAt3 = string;
export type DecisionCaseId4 = string;
export type ErrorCode1 = string | null;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "DecisionMode".
 */
export type DecisionMode = "LIVE" | "SIMULATION_ONLY";
export type RecommendationId = string | null;
export type SchemaVersion6 = "3.0";
export type SnapshotId1 = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "DecisionCaseStatus".
 */
export type DecisionCaseStatus =
  | "CREATED"
  | "ANALYZING"
  | "GENERATING"
  | "VALIDATING"
  | "EXPLAINING"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "MODIFIED"
  | "REJECTED"
  | "COMMITTED"
  | "FAILED"
  | "CANCELLED";
export type UpdatedAt = string;
export type CorrelationId1 = string;
export type DecisionCaseId5 = string;
export type EventId = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "DecisionEventType".
 */
export type DecisionEventType =
  | "case.status_changed"
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "candidate.created"
  | "candidate.validated"
  | "recommendation.ready"
  | "human_decision.recorded"
  | "schedule.committed";
export type OccurredAt = string;
export type SchemaVersion7 = "3.0";
export type Sequence = number;
export type SubjectId = string;
export type Code = string;
export type CorrelationId2 = string;
export type Code1 = string;
export type Field = string | null;
export type Message1 = string;
export type Details = ErrorDetail[];
export type ErrorId = string;
export type Message2 = string;
export type Retryable = boolean;
export type SchemaVersion8 = "3.0";
export type CapturedAt = string;
export type FactoryId1 = string;
export type Confidence = "LOW" | "MEDIUM" | "HIGH";
export type FailureProbability1 = number;
export type FailureProbabilityHorizonMinutes = number;
export type HealthIndex = number;
export type HealthSnapshotId = string;
export type MachineId1 = string;
export type ObservedAt = string;
export type ObservedWearUm = number | null;
export type ModelVersion = string;
/**
 * @minItems 2
 */
export type ProbabilityMass = [number, number, ...number[]];
/**
 * @minItems 2
 */
export type SupportMinutes = [number, number, ...number[]];
export type SurvivalBeyondHorizon = number;
export type SourceModelVersion = string;
export type HealthSnapshots = HealthSnapshot[];
export type DisplayName1 = string;
export type DueAt = string;
export type JobId1 = string;
/**
 * @minItems 1
 */
export type Operations = [Operation, ...Operation[]];
/**
 * @minItems 1
 */
export type MachineOptions = [MachineOption, ...MachineOption[]];
export type ExpectedDamage = number | null;
export type LoadFactor = number;
export type MachineId2 = string;
export type ProcessingMinutes = number;
export type OperationId1 = string;
export type OperationType = string;
export type PredecessorOperationIds = string[];
export type Sequence1 = number;
export type OperationStatus = "PENDING" | "READY" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "BLOCKED";
export type Priority = number;
export type ReleaseAt = string;
export type Jobs = ProductionJob[];
/**
 * @minItems 1
 */
export type Machines = [Machine, ...Machine[]];
/**
 * @minItems 1
 */
export type Capabilities = [MachineCapability, ...MachineCapability[]];
export type DamageFactor = number;
export type LoadFactor1 = number;
export type NominalProcessingMinutes = number;
export type OperationType1 = string;
export type DisplayName2 = string;
export type MachineFamily = string;
export type MachineId3 = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MachineStatus".
 */
export type MachineStatus = "IDLE" | "RUNNING" | "WARNING" | "MAINTENANCE" | "FAILED" | "UNAVAILABLE";
export type ActionType = string;
export type EarliestStartAt = string;
export type ExpectedDurationMinutes = number;
export type LatestStartAt = string | null;
export type MachineId4 = string;
export type MaintenanceRequestId1 = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MaintenanceType".
 */
export type MaintenanceType = "PREVENTIVE" | "CORRECTIVE";
export type Mandatory = boolean;
export type MinimumSkillLevel = number;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MaintenancePriority".
 */
export type MaintenancePriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type RequestedAt = string;
/**
 * @minItems 1
 */
export type RequiredSkillIds = [string, ...string[]];
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MaintenanceRequestStatus".
 */
export type MaintenanceRequestStatus = "OPEN" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type MaintenanceRequests = MaintenanceRequest[];
export type SchemaVersion9 = "3.0";
export type SnapshotId2 = string;
export type Availability = TimeWindow[];
export type DisplayName3 = string;
/**
 * @minItems 1
 */
export type Skills = [TechnicianSkill, ...TechnicianSkill[]];
export type CertifiedActionTypes = string[];
export type CertifiedMachineFamilies = string[];
export type Level = number;
export type SkillId = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "TechnicianStatus".
 */
export type TechnicianStatus = "AVAILABLE" | "ASSIGNED" | "OFF_SHIFT" | "UNAVAILABLE";
export type TechnicianId = string;
export type Technicians = Technician[];
export type CandidatePlanId2 = string | null;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "HumanDecisionType".
 */
export type HumanDecisionType = "APPROVE" | "MODIFY" | "REJECT";
export type DecisionCaseId6 = string;
export type ExpectedPlanVersion = number | null;
export type ExpectedSnapshotId = string;
export type Note = string | null;
export type RecommendationId1 = string;
export type SchemaVersion10 = "3.0";
export type Confidence1 = "LOW" | "MEDIUM" | "HIGH";
export type DecisionCaseId7 = string;
/**
 * @minItems 1
 */
export type EvidenceRefs1 = [string, ...string[]];
export type ExpectedRulMinutes = number | null;
export type FailureProbability2 = number;
export type GeneratedAt1 = string;
export type GeneratedByAgentRunId = string;
export type MachineId5 = string;
export type PredictionHorizonMinutes = number;
export type RecommendedReviewWindowMinutes = number;
/**
 * @minItems 1
 */
export type RiskDrivers = [RiskDriver, ...RiskDriver[]];
export type Code2 = string;
export type Contribution = number | null;
export type Description = string;
export type EvidenceRefs2 = string[];
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RiskReportId = string;
export type SchemaVersion11 = "3.0";
export type SnapshotId3 = string;
export type DecisionCaseId8 = string;
/**
 * @minItems 1
 */
export type EvidenceRefs3 = [string, ...string[]];
export type GeneratedAt2 = string;
export type GeneratedByAgentRunId1 = string;
export type MaintenanceOptionSetId = string;
/**
 * @minItems 1
 */
export type Options = [MaintenanceOption, ...MaintenanceOption[]];
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MaintenanceDecision".
 */
export type MaintenanceDecision = "MAINTAIN_NOW" | "MAINTAIN_IN_WINDOW" | "CONTINUE_AND_MONITOR" | "CORRECTIVE_REPAIR";
export type ExpectedDurationMinutes1 = number | null;
export type ExpectedFailureProbability = number;
export type ExpectedMaintenanceCost = number;
export type ExpectedRestorationEffectiveness = number | null;
export type MachineId6 = string;
export type MaintenanceOptionId = string;
export type MaintenanceRequestId2 = string;
/**
 * @minItems 1
 */
export type ReasonCodes = [string, ...string[]];
export type RequiredSkillIds1 = string[];
export type SchemaVersion12 = "3.0";
export type SnapshotId4 = string;
export type AffectedJobIds = string[];
export type AffectedOperationIds = string[];
export type DecisionCaseId9 = string;
/**
 * @minItems 1
 */
export type EvidenceRefs4 = [string, ...string[]];
export type GeneratedAt3 = string;
export type GeneratedByAgentRunId2 = string;
export type ProductionOptionSetId = string;
/**
 * @minItems 1
 */
export type RoutingOptions = [ProductionRoutingOption, ...ProductionRoutingOption[]];
export type ExpectedDamage1 = number | null;
export type ExpectedProcessingMinutes = number;
export type ExpectedTardinessMinutes = number;
export type JobId2 = string;
export type MachineId7 = string;
export type OperationId2 = string;
/**
 * @minItems 1
 */
export type ReasonCodes1 = [string, ...string[]];
export type RoutingOptionId = string;
export type SchemaVersion13 = "3.0";
export type SnapshotId5 = string;
/**
 * @minItems 1
 * @maxItems 5
 */
export type CandidatePlans = [CandidatePlan, ...CandidatePlan[]];
export type DecisionCaseId10 = string;
/**
 * @minItems 1
 */
export type EvidenceRefs5 = [string, ...string[]];
/**
 * @minItems 1
 */
export type PrimaryReasons = [string, ...string[]];
export type ResidualRisks = string[];
export type Summary = string;
/**
 * @minItems 1
 */
export type Tradeoffs = [string, ...string[]];
export type GeneratedAt4 = string;
export type RecommendationId2 = string;
export type RecommendedPlanId = string;
export type SchemaVersion14 = "3.0";
export type SnapshotId6 = string;
export type DecisionCaseId11 = string;
export type AllowedStrategyIds = string[];
export type BaseSeed = number;
export type CandidateLimit = number;
export type HorizonMinutes = number;
export type Maintenance = number;
export type Production = number;
export type Reliability = number;
export type ScheduleStability = number;
export type Workforce = number;
export type SimulationRuns1 = number;
export type SolverTimeoutSeconds = number;
export type RequestedByUserId = string | null;
export type SchemaVersion15 = "3.0";
export type Trigger =
  | HealthAlertTrigger
  | MachineFailureTrigger
  | TechnicianUnavailableTrigger
  | MaintenanceRequestedTrigger
  | ManualReplanTrigger
  | WhatIfTrigger;
export type AlertThreshold = number;
export type EventId1 = string;
export type FailureProbability3 = number;
export type MachineId8 = string;
export type OccurredAt1 = string;
export type Type = "HEALTH_ALERT";
export type EventId2 = string;
export type FailureCode = string;
export type MachineId9 = string;
export type OccurredAt2 = string;
export type Type1 = "MACHINE_FAILURE";
export type EventId3 = string;
export type OccurredAt3 = string;
export type Reason = string;
export type TechnicianId1 = string;
export type Type2 = "TECHNICIAN_UNAVAILABLE";
export type EventId4 = string;
export type MaintenanceRequestId3 = string;
export type OccurredAt4 = string;
export type Type3 = "MAINTENANCE_REQUESTED";
export type EventId5 = string;
export type OccurredAt5 = string;
export type Reason1 = string;
export type RequestedByUserId1 = string;
export type Type4 = "MANUAL_REPLAN";
export type EventId6 = string;
export type OccurredAt6 = string;
export type RequestedByUserId2 = string;
export type ScenarioId = string;
export type Type5 = "WHAT_IF";
export type ExpectedDurationMinutes2 = number;
export type ExpectedRestorationEffectiveness1 = number;
export type ExpectedWorkforceCost = number;
export type MaintenanceOptionId1 = string;
/**
 * @minItems 1
 */
export type ReasonCodes2 = [string, ...string[]];
export type SkillMatchLevel = number;
export type TechnicianCandidateId = string;
export type TechnicianId2 = string;
export type Candidates = TechnicianCandidate[];
export type DecisionCaseId12 = string;
/**
 * @minItems 1
 */
export type EvidenceRefs6 = [string, ...string[]];
export type GeneratedAt5 = string;
export type GeneratedByAgentRunId3 = string;
export type SchemaVersion16 = "3.0";
export type SnapshotId7 = string;
export type TechnicianOptionSetId = string;
export type UnstaffedMaintenanceOptionIds = string[];
export type AgentRunId1 = string;
export type CompletedAt1 = string | null;
export type CorrelationId3 = string;
export type DecisionCaseId13 = string;
export type ErrorCode2 = string | null;
export type EvidenceRefs7 = string[];
export type OutputSummary = {
  [k: string]: unknown;
} | null;
export type RetryCount = number;
export type SchemaVersion17 = "3.0";
export type StartedAt1 = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ToolCallStatus".
 */
export type ToolCallStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";
export type ToolCallId = string;
export type ToolId = string;
export type ToolVersion = string;
/**
 * @minItems 1
 */
export type AllowedAgentRoles = [AgentRole, ...AgentRole[]];
export type AuditLevel = "METADATA" | "INPUT_OUTPUT_SUMMARY" | "FULL";
export type Description1 = string;
export type InputSchemaRef = string;
export type OutputSchemaRef = string;
export type OwnerService = string;
export type SchemaVersion18 = "3.0";
export type ToolSideEffect = "NONE" | "PERSIST_ONLY" | "OPERATIONAL_COMMIT";
export type TimeoutMs = number;
export type ToolId1 = string;
export type Version1 = string;
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "AuditLevel".
 */
export type AuditLevel1 = "METADATA" | "INPUT_OUTPUT_SUMMARY" | "FULL";
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "OperationStatus".
 */
export type OperationStatus1 = "PENDING" | "READY" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "BLOCKED";
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ToolSideEffect".
 */
export type ToolSideEffect1 = "NONE" | "PERSIST_ONLY" | "OPERATIONAL_COMMIT";

/**
 * Canonical wire-contract catalog for factory snapshots, integrated schedules, decision cases, agent/tool observability, validation, recommendations, and human approval. The catalog wrapper is not a wire payload; consumers use the models in $defs.
 */
export interface MultiAgentPdMOperationsContractCatalogV3 {
  agent_definition: AgentDefinition;
  agent_message: AgentMessage;
  agent_run_trace: AgentRunTrace;
  agent_task: AgentTask;
  candidate_plan: CandidatePlan;
  decision_case_status_response: DecisionCaseStatusResponse;
  decision_event: DecisionEvent;
  error_response: ErrorResponse;
  factory_snapshot: FactorySnapshot;
  human_decision_request: HumanDecisionRequest;
  machine_risk_report: MachineRiskReport;
  maintenance_option_set: MaintenanceOptionSet;
  plan_validation: PlanValidation;
  production_option_set: ProductionOptionSet;
  recommendation_package: RecommendationPackage;
  run_decision_case_request: RunDecisionCaseRequest;
  technician_option_set: TechnicianOptionSet;
  tool_call_trace: ToolCallTrace;
  tool_definition: ToolDefinition;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "AgentDefinition".
 */
export interface AgentDefinition {
  agent_id: AgentId;
  allowed_tool_ids?: AllowedToolIds;
  display_name: DisplayName;
  goal: Goal;
  max_tool_calls: MaxToolCalls;
  role: AgentRole;
  schema_version?: SchemaVersion;
  timeout_seconds: TimeoutSeconds;
  version: Version;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "AgentMessage".
 */
export interface AgentMessage {
  correlation_id: CorrelationId;
  created_at: CreatedAt;
  decision_case_id: DecisionCaseId;
  evidence_refs?: EvidenceRefs;
  from_agent_run_id: FromAgentRunId;
  kind: MessageKind;
  message_id: MessageId;
  payload: Payload;
  schema_version?: SchemaVersion1;
  subject: Subject;
  to_agent_role: AgentRole;
}
export interface Payload {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "AgentRunTrace".
 */
export interface AgentRunTrace {
  agent_id: AgentId1;
  agent_run_id: AgentRunId;
  agent_version: AgentVersion;
  completed_at?: CompletedAt;
  decision_case_id: DecisionCaseId1;
  error_code?: ErrorCode;
  message_ids?: MessageIds;
  output_ref?: OutputRef;
  role: AgentRole;
  schema_version?: SchemaVersion2;
  started_at?: StartedAt;
  status: RunStatus;
  task_id: TaskId;
  tool_call_ids?: ToolCallIds;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "AgentTask".
 */
export interface AgentTask {
  assigned_role: AgentRole;
  created_at: CreatedAt1;
  decision_case_id: DecisionCaseId2;
  dependency_task_ids?: DependencyTaskIds;
  input_refs?: InputRefs;
  objective: Objective;
  schema_version?: SchemaVersion3;
  task_id: TaskId1;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "CandidatePlan".
 */
export interface CandidatePlan {
  assumptions?: Assumptions;
  candidate_plan_id: CandidatePlanId;
  decision_case_id: DecisionCaseId3;
  generated_at: GeneratedAt;
  kpis: PlanKPIs;
  plan_version: PlanVersion;
  schedule: Schedule;
  schema_version?: SchemaVersion4;
  snapshot_id: SnapshotId;
  source_agent_run_ids?: SourceAgentRunIds;
  source_engine_id: SourceEngineId;
  source_engine_version: SourceEngineVersion;
  strategy: PlanStrategy;
  validation?: PlanValidation | null;
  warnings?: Warnings1;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "PlanKPIs".
 */
export interface PlanKPIs {
  decision_latency_ms?: DecisionLatencyMs;
  expected_emergency_downtime_minutes: ExpectedEmergencyDowntimeMinutes;
  expected_failure_count: ExpectedFailureCount;
  failure_probability: FailureProbability;
  maintenance_cost: MaintenanceCost;
  makespan_minutes: MakespanMinutes;
  maximum_tardiness_minutes: MaximumTardinessMinutes;
  on_time_completion_rate: OnTimeCompletionRate;
  schedule_changes: ScheduleChanges;
  technician_utilization: TechnicianUtilization;
  total_tardiness_minutes: TotalTardinessMinutes;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "Schedule".
 */
export interface Schedule {
  assignments?: Assignments;
  created_at: CreatedAt2;
  factory_id: FactoryId;
  planning_window: TimeWindow;
  revision: Revision;
  schedule_id: ScheduleId;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ScheduleAssignment".
 */
export interface ScheduleAssignment {
  assignment_id: AssignmentId;
  assignment_type: AssignmentType;
  end_at: EndAt;
  job_id?: JobId;
  locked?: Locked;
  machine_id: MachineId;
  maintenance_request_id?: MaintenanceRequestId;
  operation_id?: OperationId;
  start_at: StartAt;
  status: AssignmentStatus;
  technician_ids?: TechnicianIds;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "TimeWindow".
 */
export interface TimeWindow {
  end_at: EndAt1;
  start_at: StartAt1;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "PlanValidation".
 */
export interface PlanValidation {
  candidate_plan_id: CandidatePlanId1;
  schema_version?: SchemaVersion5;
  simulation_runs?: SimulationRuns;
  validated_at: ValidatedAt;
  validation_id: ValidationId;
  validator_version: ValidatorVersion;
  verdict: ValidationVerdict;
  violations?: Violations;
  warnings?: Warnings;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ConstraintViolation".
 */
export interface ConstraintViolation {
  constraint_code: ConstraintCode;
  entity_refs?: EntityRefs;
  message: Message;
  severity: ConstraintSeverity;
  time_window?: TimeWindow | null;
  violation_id: ViolationId;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "DecisionCaseStatusResponse".
 */
export interface DecisionCaseStatusResponse {
  committed_schedule_id?: CommittedScheduleId;
  created_at: CreatedAt3;
  decision_case_id: DecisionCaseId4;
  error_code?: ErrorCode1;
  mode: DecisionMode;
  recommendation_id?: RecommendationId;
  schema_version?: SchemaVersion6;
  snapshot_id: SnapshotId1;
  status: DecisionCaseStatus;
  updated_at: UpdatedAt;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "DecisionEvent".
 */
export interface DecisionEvent {
  correlation_id: CorrelationId1;
  decision_case_id: DecisionCaseId5;
  event_id: EventId;
  event_type: DecisionEventType;
  occurred_at: OccurredAt;
  payload: Payload1;
  schema_version?: SchemaVersion7;
  sequence: Sequence;
  subject_id: SubjectId;
}
export interface Payload1 {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ErrorResponse".
 */
export interface ErrorResponse {
  code: Code;
  correlation_id: CorrelationId2;
  details?: Details;
  error_id: ErrorId;
  message: Message2;
  retryable?: Retryable;
  schema_version?: SchemaVersion8;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ErrorDetail".
 */
export interface ErrorDetail {
  code: Code1;
  field?: Field;
  message: Message1;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "FactorySnapshot".
 */
export interface FactorySnapshot {
  captured_at: CapturedAt;
  current_schedule?: Schedule | null;
  factory_id: FactoryId1;
  health_snapshots?: HealthSnapshots;
  jobs?: Jobs;
  machines: Machines;
  maintenance_requests?: MaintenanceRequests;
  planning_window: TimeWindow;
  schema_version?: SchemaVersion9;
  snapshot_id: SnapshotId2;
  technicians?: Technicians;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "HealthSnapshot".
 */
export interface HealthSnapshot {
  confidence: Confidence;
  failure_probability: FailureProbability1;
  failure_probability_horizon_minutes: FailureProbabilityHorizonMinutes;
  health_index: HealthIndex;
  health_snapshot_id: HealthSnapshotId;
  machine_id: MachineId1;
  observed_at: ObservedAt;
  observed_wear_um?: ObservedWearUm;
  rul_distribution?: DiscreteRULDistribution | null;
  source_model_version: SourceModelVersion;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "DiscreteRULDistribution".
 */
export interface DiscreteRULDistribution {
  model_version: ModelVersion;
  probability_mass: ProbabilityMass;
  support_minutes: SupportMinutes;
  survival_beyond_horizon: SurvivalBeyondHorizon;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ProductionJob".
 */
export interface ProductionJob {
  display_name: DisplayName1;
  due_at: DueAt;
  job_id: JobId1;
  operations: Operations;
  priority?: Priority;
  release_at: ReleaseAt;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "Operation".
 */
export interface Operation {
  machine_options: MachineOptions;
  operation_id: OperationId1;
  operation_type: OperationType;
  predecessor_operation_ids?: PredecessorOperationIds;
  sequence: Sequence1;
  status?: OperationStatus;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MachineOption".
 */
export interface MachineOption {
  expected_damage?: ExpectedDamage;
  load_factor?: LoadFactor;
  machine_id: MachineId2;
  processing_minutes: ProcessingMinutes;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "Machine".
 */
export interface Machine {
  capabilities: Capabilities;
  display_name: DisplayName2;
  machine_family: MachineFamily;
  machine_id: MachineId3;
  status: MachineStatus;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MachineCapability".
 */
export interface MachineCapability {
  damage_factor?: DamageFactor;
  load_factor?: LoadFactor1;
  nominal_processing_minutes: NominalProcessingMinutes;
  operation_type: OperationType1;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MaintenanceRequest".
 */
export interface MaintenanceRequest {
  action_type: ActionType;
  earliest_start_at: EarliestStartAt;
  expected_duration_minutes: ExpectedDurationMinutes;
  latest_start_at?: LatestStartAt;
  machine_id: MachineId4;
  maintenance_request_id: MaintenanceRequestId1;
  maintenance_type: MaintenanceType;
  mandatory?: Mandatory;
  minimum_skill_level?: MinimumSkillLevel;
  priority: MaintenancePriority;
  requested_at: RequestedAt;
  required_skill_ids: RequiredSkillIds;
  status: MaintenanceRequestStatus;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "Technician".
 */
export interface Technician {
  availability?: Availability;
  display_name: DisplayName3;
  skills: Skills;
  status: TechnicianStatus;
  technician_id: TechnicianId;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "TechnicianSkill".
 */
export interface TechnicianSkill {
  certified_action_types?: CertifiedActionTypes;
  certified_machine_families?: CertifiedMachineFamilies;
  level: Level;
  skill_id: SkillId;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "HumanDecisionRequest".
 */
export interface HumanDecisionRequest {
  candidate_plan_id?: CandidatePlanId2;
  decision: HumanDecisionType;
  decision_case_id: DecisionCaseId6;
  expected_plan_version?: ExpectedPlanVersion;
  expected_snapshot_id: ExpectedSnapshotId;
  modified_schedule?: Schedule | null;
  note?: Note;
  recommendation_id: RecommendationId1;
  schema_version?: SchemaVersion10;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MachineRiskReport".
 */
export interface MachineRiskReport {
  confidence: Confidence1;
  decision_case_id: DecisionCaseId7;
  evidence_refs: EvidenceRefs1;
  expected_rul_minutes?: ExpectedRulMinutes;
  failure_probability: FailureProbability2;
  generated_at: GeneratedAt1;
  generated_by_agent_run_id: GeneratedByAgentRunId;
  machine_id: MachineId5;
  prediction_horizon_minutes: PredictionHorizonMinutes;
  recommended_review_window_minutes: RecommendedReviewWindowMinutes;
  risk_drivers: RiskDrivers;
  risk_level: RiskLevel;
  risk_report_id: RiskReportId;
  schema_version?: SchemaVersion11;
  snapshot_id: SnapshotId3;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "RiskDriver".
 */
export interface RiskDriver {
  code: Code2;
  contribution?: Contribution;
  description: Description;
  evidence_refs?: EvidenceRefs2;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MaintenanceOptionSet".
 */
export interface MaintenanceOptionSet {
  decision_case_id: DecisionCaseId8;
  evidence_refs: EvidenceRefs3;
  generated_at: GeneratedAt2;
  generated_by_agent_run_id: GeneratedByAgentRunId1;
  maintenance_option_set_id: MaintenanceOptionSetId;
  options: Options;
  schema_version?: SchemaVersion12;
  snapshot_id: SnapshotId4;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MaintenanceOption".
 */
export interface MaintenanceOption {
  decision: MaintenanceDecision;
  expected_duration_minutes?: ExpectedDurationMinutes1;
  expected_failure_probability: ExpectedFailureProbability;
  expected_maintenance_cost: ExpectedMaintenanceCost;
  expected_restoration_effectiveness?: ExpectedRestorationEffectiveness;
  machine_id: MachineId6;
  maintenance_option_id: MaintenanceOptionId;
  maintenance_request_id: MaintenanceRequestId2;
  proposed_window?: TimeWindow | null;
  reason_codes: ReasonCodes;
  required_skill_ids?: RequiredSkillIds1;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ProductionOptionSet".
 */
export interface ProductionOptionSet {
  affected_job_ids: AffectedJobIds;
  affected_operation_ids: AffectedOperationIds;
  decision_case_id: DecisionCaseId9;
  evidence_refs: EvidenceRefs4;
  generated_at: GeneratedAt3;
  generated_by_agent_run_id: GeneratedByAgentRunId2;
  production_option_set_id: ProductionOptionSetId;
  routing_options: RoutingOptions;
  schema_version?: SchemaVersion13;
  snapshot_id: SnapshotId5;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ProductionRoutingOption".
 */
export interface ProductionRoutingOption {
  expected_damage?: ExpectedDamage1;
  expected_processing_minutes: ExpectedProcessingMinutes;
  expected_tardiness_minutes: ExpectedTardinessMinutes;
  job_id: JobId2;
  machine_id: MachineId7;
  operation_id: OperationId2;
  proposed_window: TimeWindow;
  reason_codes: ReasonCodes1;
  routing_option_id: RoutingOptionId;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "RecommendationPackage".
 */
export interface RecommendationPackage {
  candidate_plans: CandidatePlans;
  decision_case_id: DecisionCaseId10;
  explanation: RecommendationExplanation;
  generated_at: GeneratedAt4;
  recommendation_id: RecommendationId2;
  recommended_plan_id: RecommendedPlanId;
  schema_version?: SchemaVersion14;
  snapshot_id: SnapshotId6;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "RecommendationExplanation".
 */
export interface RecommendationExplanation {
  evidence_refs: EvidenceRefs5;
  primary_reasons: PrimaryReasons;
  residual_risks?: ResidualRisks;
  summary: Summary;
  tradeoffs: Tradeoffs;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "RunDecisionCaseRequest".
 */
export interface RunDecisionCaseRequest {
  decision_case_id: DecisionCaseId11;
  factory_snapshot: FactorySnapshot;
  mode: DecisionMode;
  planning_config: PlanningConfig;
  requested_by_user_id?: RequestedByUserId;
  schema_version?: SchemaVersion15;
  trigger: Trigger;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "PlanningConfig".
 */
export interface PlanningConfig {
  allowed_strategy_ids?: AllowedStrategyIds;
  base_seed?: BaseSeed;
  candidate_limit?: CandidateLimit;
  horizon_minutes: HorizonMinutes;
  objective_weights?: ObjectiveWeights;
  simulation_runs?: SimulationRuns1;
  solver_timeout_seconds?: SolverTimeoutSeconds;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ObjectiveWeights".
 */
export interface ObjectiveWeights {
  maintenance?: Maintenance;
  production?: Production;
  reliability?: Reliability;
  schedule_stability?: ScheduleStability;
  workforce?: Workforce;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "HealthAlertTrigger".
 */
export interface HealthAlertTrigger {
  alert_threshold: AlertThreshold;
  event_id: EventId1;
  failure_probability: FailureProbability3;
  machine_id: MachineId8;
  occurred_at: OccurredAt1;
  type?: Type;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MachineFailureTrigger".
 */
export interface MachineFailureTrigger {
  event_id: EventId2;
  failure_code: FailureCode;
  machine_id: MachineId9;
  occurred_at: OccurredAt2;
  type?: Type1;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "TechnicianUnavailableTrigger".
 */
export interface TechnicianUnavailableTrigger {
  event_id: EventId3;
  occurred_at: OccurredAt3;
  reason: Reason;
  technician_id: TechnicianId1;
  type?: Type2;
  unavailable_window: TimeWindow;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "MaintenanceRequestedTrigger".
 */
export interface MaintenanceRequestedTrigger {
  event_id: EventId4;
  maintenance_request_id: MaintenanceRequestId3;
  occurred_at: OccurredAt4;
  type?: Type3;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ManualReplanTrigger".
 */
export interface ManualReplanTrigger {
  event_id: EventId5;
  occurred_at: OccurredAt5;
  reason: Reason1;
  requested_by_user_id: RequestedByUserId1;
  type?: Type4;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "WhatIfTrigger".
 */
export interface WhatIfTrigger {
  assumptions: Assumptions1;
  event_id: EventId6;
  occurred_at: OccurredAt6;
  requested_by_user_id: RequestedByUserId2;
  scenario_id: ScenarioId;
  type?: Type5;
}
export interface Assumptions1 {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "TechnicianOptionSet".
 */
export interface TechnicianOptionSet {
  candidates?: Candidates;
  decision_case_id: DecisionCaseId12;
  evidence_refs: EvidenceRefs6;
  generated_at: GeneratedAt5;
  generated_by_agent_run_id: GeneratedByAgentRunId3;
  schema_version?: SchemaVersion16;
  snapshot_id: SnapshotId7;
  technician_option_set_id: TechnicianOptionSetId;
  unstaffed_maintenance_option_ids?: UnstaffedMaintenanceOptionIds;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "TechnicianCandidate".
 */
export interface TechnicianCandidate {
  available_window: TimeWindow;
  expected_duration_minutes: ExpectedDurationMinutes2;
  expected_restoration_effectiveness: ExpectedRestorationEffectiveness1;
  expected_workforce_cost: ExpectedWorkforceCost;
  maintenance_option_id: MaintenanceOptionId1;
  reason_codes: ReasonCodes2;
  skill_match_level: SkillMatchLevel;
  technician_candidate_id: TechnicianCandidateId;
  technician_id: TechnicianId2;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ToolCallTrace".
 */
export interface ToolCallTrace {
  agent_run_id: AgentRunId1;
  completed_at?: CompletedAt1;
  correlation_id: CorrelationId3;
  decision_case_id: DecisionCaseId13;
  error_code?: ErrorCode2;
  evidence_refs?: EvidenceRefs7;
  input_summary: InputSummary;
  output_summary?: OutputSummary;
  retry_count?: RetryCount;
  schema_version?: SchemaVersion17;
  started_at: StartedAt1;
  status: ToolCallStatus;
  tool_call_id: ToolCallId;
  tool_id: ToolId;
  tool_version: ToolVersion;
}
export interface InputSummary {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `MultiAgentPdMOperationsContractCatalogV3`'s JSON-Schema
 * via the `definition` "ToolDefinition".
 */
export interface ToolDefinition {
  allowed_agent_roles: AllowedAgentRoles;
  audit_level?: AuditLevel;
  description: Description1;
  input_schema_ref: InputSchemaRef;
  output_schema_ref: OutputSchemaRef;
  owner_service: OwnerService;
  schema_version?: SchemaVersion18;
  side_effect?: ToolSideEffect;
  timeout_ms: TimeoutMs;
  tool_id: ToolId1;
  version: Version1;
}
