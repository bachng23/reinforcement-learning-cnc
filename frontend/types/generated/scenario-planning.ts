/* Generated from Backend + canonical Python d49ddfbbe3ffddb51cea03077aa032e4acb2ee1e. Do not edit. */

/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "EnqueueRun".
 */
export type EnqueueRun =
  | {
      kind: "BASELINE";
    }
  | {
      kind: "SCENARIO";
      scenario_id: string;
      expected_revision: number;
    };
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "EngineResult".
 */
export type EngineResult = EvaluationResult | SensitivityResult;
export type Outcome = "FEASIBLE" | "NO_FEASIBLE_PLAN" | "TIMEOUT" | "NOT_EVALUATED";
export type Reason = string | null;
export type Strategy = string;
export type CandidateAvailability = CandidateAvailability1[];
export type Assumptions = string[];
export type CandidatePlanId = string;
export type DecisionCaseId = string;
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
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_AssignmentType".
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
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_AssignmentStatus".
 */
export type AssignmentStatus = "PROPOSED" | "COMMITTED" | "RUNNING" | "COMPLETED" | "CANCELLED";
export type TechnicianIds = string[];
export type Assignments = ScheduleAssignment[];
export type CreatedAt = string;
export type FactoryId = string;
export type EndAt1 = string;
export type StartAt1 = string;
export type Revision = number;
export type ScheduleId = string;
export type SchemaVersion = "3.0";
export type SnapshotId = string;
export type SourceAgentRunIds = string[];
export type SourceEngineId = string;
export type SourceEngineVersion = string;
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_PlanStrategy".
 */
export type PlanStrategy =
  "CURRENT" | "PRODUCTION_PRIORITY" | "BALANCED" | "RELIABILITY_PRIORITY" | "MANUAL" | "EXPERIMENTAL";
export type CandidatePlanId1 = string;
export type SchemaVersion1 = "3.0";
export type SimulationRuns = number;
export type ValidatedAt = string;
export type ValidationId = string;
export type ValidatorVersion = string;
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_ValidationVerdict".
 */
export type ValidationVerdict = "VALID" | "INVALID" | "ERROR";
export type ConstraintCode = string;
export type EntityRefs = string[];
export type Message = string;
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_ConstraintSeverity".
 */
export type ConstraintSeverity = "ERROR" | "WARNING";
export type ViolationId = string;
export type Violations = ConstraintViolation[];
export type Warnings = string[];
export type Warnings1 = string[];
/**
 * @maxItems 3
 */
export type Candidates = CandidatePlan[];
export type Code = string;
export type Field = string | null;
export type Message1 = string;
export type TargetIds = string[];
export type Diagnostics = Diagnostic[];
export type Outcome1 = "FEASIBLE" | "NO_FEASIBLE_PLAN" | "TIMEOUT" | "FAILED";
export type Partial = boolean;
export type ConstantRangeBenefit = 1;
export type NormalizationReferenceId = string;
export type Maintenance = number;
export type Production = number;
export type Reliability = number;
export type ScheduleStability = number;
export type Workforce = number;
export type CandidatePlanId2 = string;
export type Score = number;
export type Strategy1 = string;
export type TiedWith = string[];
export type Rows = RankingRow[];
export type TieBreak = string[];
export type Version = "objective-minmax:1";
export type SelectedCandidateId = string | null;
export type MetricRegistryVersion = "scenario-metrics:1";
export type AbsoluteDelta = number | null;
export type Baseline1 = number | null;
export type Change = "IMPROVED_UNDER_MODEL" | "WORSENED_UNDER_MODEL" | "UNCHANGED" | "UNAVAILABLE";
export type Metric = string;
export type PercentDelta = number | null;
export type PreferredDirection = "LOWER" | "HIGHER";
export type Reason1 = string | null;
export type Scenario = number | null;
export type Unit = string;
export type Metrics = MetricComparison[];
export type ModelAssumptions = string[];
export type ScoreComparison = "NOT_COMPARABLE_ACROSS_REFERENCES";
export type ContractVersion = "scenario-engine:1.0";
export type Diagnostics1 = Diagnostic[];
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_JsonValue".
 */
export type ScenarioEngine_JsonValue = unknown;
export type Field1 = "availability" | "expected_duration_minutes" | "earliest_start_at";
export type TargetId = string;
export type TargetType = "TECHNICIAN" | "MAINTENANCE_REQUEST";
export type Diff = EffectiveDiff[];
export type EffectiveHash = string | null;
export type HashVersion = "scenario-jcs-sha256:1";
export type EndAt2 = string;
export type StartAt2 = string;
export type TechnicianId = string;
export type Type = "TECHNICIAN_UNAVAILABLE";
export type ExpectedDurationMinutes = number;
export type MaintenanceRequestId1 = string;
export type Type1 = "MAINTENANCE_DURATION";
export type EarliestStartAt = string;
export type MaintenanceRequestId2 = string;
export type Type2 = "DEFER_MAINTENANCE";
export type Overrides = (TechnicianUnavailable | MaintenanceDuration | DeferMaintenance)[];
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
export type DisplayName = string;
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
export type Sequence = number;
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
export type DisplayName1 = string;
export type MachineFamily = string;
export type MachineId3 = string;
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_MachineStatus".
 */
export type MachineStatus = "IDLE" | "RUNNING" | "WARNING" | "MAINTENANCE" | "FAILED" | "UNAVAILABLE";
export type ActionType = string;
export type EarliestStartAt1 = string;
export type ExpectedDurationMinutes1 = number;
export type LatestStartAt = string | null;
export type MachineId4 = string;
export type MaintenanceRequestId3 = string;
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_MaintenanceType".
 */
export type MaintenanceType = "PREVENTIVE" | "CORRECTIVE";
export type Mandatory = boolean;
export type MinimumSkillLevel = number;
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_MaintenancePriority".
 */
export type MaintenancePriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type RequestedAt = string;
/**
 * @minItems 1
 */
export type RequiredSkillIds = [string, ...string[]];
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_MaintenanceRequestStatus".
 */
export type MaintenanceRequestStatus = "OPEN" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type MaintenanceRequests = MaintenanceRequest[];
export type SchemaVersion2 = "3.0";
export type SnapshotId1 = string;
export type Availability = TimeWindow[];
export type DisplayName2 = string;
/**
 * @minItems 1
 */
export type Skills = [TechnicianSkill, ...TechnicianSkill[]];
export type CertifiedActionTypes = string[];
export type CertifiedMachineFamilies = string[];
export type Level = number;
export type SkillId = string;
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_TechnicianStatus".
 */
export type TechnicianStatus = "AVAILABLE" | "ASSIGNED" | "OFF_SHIFT" | "UNAVAILABLE";
export type TechnicianId1 = string;
export type Technicians = Technician[];
export type SourceHash = string;
export type TransformVersion = "scenario-transform:1";
export type EngineVersion = "scenario-evaluator:1.0.0";
export type FactoryId2 = string;
export type FrozenInputHash = string;
export type RunId = string;
export type WorkspaceId = string;
export type MappedDeferBounds = DeferMaintenance[];
export type Reasons = string[];
export type Supported = boolean;
export type Algorithm = "sha256-first53-uniform:1";
export type BaseSeed = number;
export type Coupling = "COMMON_RANDOM_NUMBERS";
export type CouplingKey = string;
export type ObservationSetHash = string;
export type SampleCount = number;
export type Version1 = "scenario-crn:1";
export type SemanticInputHash = string;
export type Axis = DurationAxis | WeightAxis;
export type MaintenanceRequestId4 = string;
export type Type3 = "MAINTENANCE_DURATION";
/**
 * @minItems 1
 * @maxItems 7
 */
export type Values = [number, ...number[]];
export type Type4 = "OBJECTIVE_WEIGHT";
/**
 * @minItems 1
 * @maxItems 7
 */
export type Values1 = [number, ...number[]];
export type Weight = "production" | "reliability" | "maintenance" | "workforce" | "schedule_stability";
export type BaselineValue = number;
export type ContractVersion1 = "scenario-engine:1.0";
export type EngineVersion1 = "scenario-evaluator:1.0.0";
export type FixedInputs = string[];
export type Outcome2 = "COMPLETE" | "PARTIAL_FAILED" | "FAILED";
/**
 * @minItems 1
 * @maxItems 7
 */
export type Points = [SensitivityPoint, ...SensitivityPoint[]];
export type InputHash = string;
export type Status = "FEASIBLE" | "NO_FEASIBLE_PLAN" | "FAILED" | "TIMEOUT";
export type Value = number;
export type FromStrategy = string;
export type Interpretation = "SAMPLED_INTERVAL_NOT_EXACT_THRESHOLD";
export type LowerSample = number;
export type ToStrategy = string;
export type UpperSample = number;
export type RankChangeIntervals = RankChangeInterval[];
export type RequestedOrder = number[];
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_OperationStatus".
 */
export type OperationStatus1 = "PENDING" | "READY" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "BLOCKED";
export type EngineVersion2 = "scenario-evaluator:1.0.0";
export type Overrides1 = (TechnicianUnavailable | MaintenanceDuration | DeferMaintenance)[];
/**
 * @minItems 1
 * @maxItems 3
 */
export type AllowedStrategyIds = [
  "production-priority" | "balanced" | "reliability-priority",
  ...("production-priority" | "balanced" | "reliability-priority")[]
];
export type BaseSeed1 = number;
export type CandidateLimit = number;
export type HorizonMinutes = number;
export type SimulationRuns1 = number;
export type SolverTimeoutSeconds = number;
export type SemanticInputHash1 = string;
export type ContractVersion2 = "scenario-engine:1.0";
export type EngineVersion3 = "scenario-evaluator:1.0.0";
export type ReferenceOverrides = (TechnicianUnavailable | MaintenanceDuration | DeferMaintenance)[];
export type ReferenceSemanticInputHash = string;
/**
 * @minItems 1
 * @maxItems 3
 */
export type Runs = [ComparedRun, ...ComparedRun[]];
export type ScoreComparison1 = "NOT_COMPARABLE_ACROSS_REFERENCES";

export interface ScenarioProposalCatalog {}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "CreateWorkspace".
 */
export interface CreateWorkspace {
  factory_id: string;
  name: string;
  expected_head: {
    snapshot_id: string;
    plan_version: number;
    revision: number;
  };
  planning_config: {
    horizon_minutes: number;
    candidate_limit: number;
    solver_timeout_seconds: number;
    simulation_runs: number;
    base_seed: number;
    objective_weights: {
      production: number;
      reliability: number;
      maintenance: number;
      workforce: number;
      schedule_stability: number;
    };
    /**
     * @minItems 1
     * @maxItems 3
     */
    allowed_strategy_ids: [
      "PRODUCTION_PRIORITY" | "BALANCED" | "RELIABILITY_PRIORITY",
      ...("PRODUCTION_PRIORITY" | "BALANCED" | "RELIABILITY_PRIORITY")[]
    ];
  };
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "CreateDraft".
 */
export interface CreateDraft {
  name: string;
  note: string;
  /**
   * @maxItems 5
   */
  overrides: (
    | {
        type: "TECHNICIAN_UNAVAILABLE";
        technician_id: string;
        start_at: string;
        end_at: string;
      }
    | {
        type: "MAINTENANCE_DURATION";
        maintenance_request_id: string;
        expected_duration_minutes: number;
      }
    | {
        type: "DEFER_MAINTENANCE";
        maintenance_request_id: string;
        earliest_start_at: string;
      }
  )[];
  objective_weights: {
    production: number;
    reliability: number;
    maintenance: number;
    workforce: number;
    schedule_stability: number;
  };
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "UpdateDraft".
 */
export interface UpdateDraft {
  name: string;
  note: string;
  /**
   * @maxItems 5
   */
  overrides: (
    | {
        type: "TECHNICIAN_UNAVAILABLE";
        technician_id: string;
        start_at: string;
        end_at: string;
      }
    | {
        type: "MAINTENANCE_DURATION";
        maintenance_request_id: string;
        expected_duration_minutes: number;
      }
    | {
        type: "DEFER_MAINTENANCE";
        maintenance_request_id: string;
        earliest_start_at: string;
      }
  )[];
  objective_weights: {
    production: number;
    reliability: number;
    maintenance: number;
    workforce: number;
    schedule_stability: number;
  };
  expected_revision: number;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "EnqueueSensitivity".
 */
export interface EnqueueSensitivity {
  source_run_id: string;
  axis:
    | {
        type: "MAINTENANCE_DURATION";
        maintenance_request_id: string;
        /**
         * @minItems 1
         * @maxItems 7
         */
        values: [number, ...number[]];
      }
    | {
        type: "OBJECTIVE_WEIGHT";
        weight: "production" | "reliability" | "maintenance" | "workforce" | "schedule_stability";
        /**
         * @minItems 1
         * @maxItems 7
         */
        values: [number, ...number[]];
      };
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "LiveEvaluation".
 */
export interface LiveEvaluation {
  source_run_id: string;
  confirmation: true;
  expected_head: {
    snapshot_id: string;
    plan_version: number;
    revision: number;
  };
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "PlanningConfig".
 */
export interface PlanningConfig {
  horizon_minutes: number;
  candidate_limit: number;
  solver_timeout_seconds: number;
  simulation_runs: number;
  base_seed: number;
  objective_weights: {
    production: number;
    reliability: number;
    maintenance: number;
    workforce: number;
    schedule_stability: number;
  };
  /**
   * @minItems 1
   * @maxItems 3
   */
  allowed_strategy_ids: [
    "PRODUCTION_PRIORITY" | "BALANCED" | "RELIABILITY_PRIORITY",
    ...("PRODUCTION_PRIORITY" | "BALANCED" | "RELIABILITY_PRIORITY")[]
  ];
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "Head".
 */
export interface Head {
  snapshot_id: string;
  plan_version: number;
  revision: number;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "Error".
 */
export interface Error {
  success: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "Baseline".
 */
export interface Baseline {
  factory_id: string;
  snapshot_id: string;
  snapshot_hash: string;
  plan_version: number;
  publication: {
    schedule_id: string;
    schedule_revision: number;
    schedule_hash: string;
  } | null;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "Workspace".
 */
export interface Workspace {
  workspace_id: string;
  name: string;
  baseline: Baseline;
  planning_config: PlanningConfig;
  engine_version: string;
  contract_version: string;
  created_by: string;
  created_at: string;
  current_head: Head | null;
  stale: boolean;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "BaselineEntities".
 */
export interface BaselineEntities {
  workspace_id: string;
  baseline: Baseline;
  planning_window: {
    start_at: string;
    end_at: string;
  };
  technicians: {
    technician_id: string;
    display_name: string;
    availability: {
      start_at: string;
      end_at: string;
    }[];
  }[];
  maintenance_requests: {
    maintenance_request_id: string;
    machine_id: string;
    expected_duration_minutes: number;
    earliest_start_at: string | null;
    latest_start_at: string | null;
    mandatory: boolean;
    priority: string;
    status: string;
  }[];
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "Draft".
 */
export interface Draft {
  name: string;
  note: string;
  /**
   * @maxItems 5
   */
  overrides: (
    | {
        type: "TECHNICIAN_UNAVAILABLE";
        technician_id: string;
        start_at: string;
        end_at: string;
      }
    | {
        type: "MAINTENANCE_DURATION";
        maintenance_request_id: string;
        expected_duration_minutes: number;
      }
    | {
        type: "DEFER_MAINTENANCE";
        maintenance_request_id: string;
        earliest_start_at: string;
      }
  )[];
  objective_weights: {
    production: number;
    reliability: number;
    maintenance: number;
    workforce: number;
    schedule_stability: number;
  };
  workspace_id: string;
  scenario_id: string;
  revision: number;
  created_at: string;
  updated_at: string;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "Job".
 */
export interface Job {
  workspace_id: string;
  job_id: string;
  kind: "RUN" | "SENSITIVITY";
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  input_hash: string;
  source_scenario_id: string | null;
  source_revision: number | null;
  source_run_id: string | null;
  engine_version: string;
  contract_version: string;
  attempt: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  deadline_at: string;
  error_code: string | null;
  result: EngineResult | null;
  points: Point[];
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_EvaluationResult".
 */
export interface EvaluationResult {
  baseline: Evaluation;
  comparison: Comparison;
  contract_version?: ContractVersion;
  effective: EffectiveInput;
  engine_version?: EngineVersion;
  identity: Identity;
  live_mapping: LiveMapping;
  sampling: SamplingEvidence;
  scenario: Evaluation;
  semantic_input_hash: SemanticInputHash;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_Evaluation".
 */
export interface Evaluation {
  candidate_availability?: CandidateAvailability;
  candidates?: Candidates;
  diagnostics?: Diagnostics;
  outcome: Outcome1;
  partial?: Partial;
  ranking?: Ranking | null;
  selected_candidate_id?: SelectedCandidateId;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_CandidateAvailability".
 */
export interface CandidateAvailability1 {
  outcome: Outcome;
  reason?: Reason;
  strategy: Strategy;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_CandidatePlan".
 */
export interface CandidatePlan {
  assumptions?: Assumptions;
  candidate_plan_id: CandidatePlanId;
  decision_case_id: DecisionCaseId;
  generated_at: GeneratedAt;
  kpis: PlanKPIs;
  plan_version: PlanVersion;
  schedule: Schedule;
  schema_version?: SchemaVersion;
  snapshot_id: SnapshotId;
  source_agent_run_ids?: SourceAgentRunIds;
  source_engine_id: SourceEngineId;
  source_engine_version: SourceEngineVersion;
  strategy: PlanStrategy;
  validation?: PlanValidation | null;
  warnings?: Warnings1;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_PlanKPIs".
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
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_Schedule".
 */
export interface Schedule {
  assignments?: Assignments;
  created_at: CreatedAt;
  factory_id: FactoryId;
  planning_window: TimeWindow;
  revision: Revision;
  schedule_id: ScheduleId;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_ScheduleAssignment".
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
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_TimeWindow".
 */
export interface TimeWindow {
  end_at: EndAt1;
  start_at: StartAt1;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_PlanValidation".
 */
export interface PlanValidation {
  candidate_plan_id: CandidatePlanId1;
  schema_version?: SchemaVersion1;
  simulation_runs?: SimulationRuns;
  validated_at: ValidatedAt;
  validation_id: ValidationId;
  validator_version: ValidatorVersion;
  verdict: ValidationVerdict;
  violations?: Violations;
  warnings?: Warnings;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_ConstraintViolation".
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
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_Diagnostic".
 */
export interface Diagnostic {
  code: Code;
  field?: Field;
  message: Message1;
  target_ids?: TargetIds;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_Ranking".
 */
export interface Ranking {
  constant_range_benefit?: ConstantRangeBenefit;
  normalization_reference_id: NormalizationReferenceId;
  normalized_weights: NormalizedWeights;
  raw_weights: ObjectiveWeights;
  reference_bounds: ReferenceBounds;
  rows: Rows;
  tie_break: TieBreak;
  version?: Version;
}
export interface NormalizedWeights {
  [k: string]: number;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_ObjectiveWeights".
 */
export interface ObjectiveWeights {
  maintenance?: Maintenance;
  production?: Production;
  reliability?: Reliability;
  schedule_stability?: ScheduleStability;
  workforce?: Workforce;
}
export interface ReferenceBounds {
  [k: string]: number[];
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_RankingRow".
 */
export interface RankingRow {
  candidate_plan_id: CandidatePlanId2;
  metric_benefits: MetricBenefits;
  objective_benefits: ObjectiveBenefits;
  raw_kpis: RawKpis;
  score: Score;
  strategy: Strategy1;
  tied_with: TiedWith;
  weighted_contributions: WeightedContributions;
}
export interface MetricBenefits {
  [k: string]: number;
}
export interface ObjectiveBenefits {
  [k: string]: number;
}
export interface RawKpis {
  [k: string]: number | null;
}
export interface WeightedContributions {
  [k: string]: number;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_Comparison".
 */
export interface Comparison {
  metric_registry_version?: MetricRegistryVersion;
  metrics: Metrics;
  model_assumptions: ModelAssumptions;
  score_comparison?: ScoreComparison;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_MetricComparison".
 */
export interface MetricComparison {
  absolute_delta: AbsoluteDelta;
  baseline: Baseline1;
  change: Change;
  metric: Metric;
  percent_delta: PercentDelta;
  preferred_direction: PreferredDirection;
  reason: Reason1;
  scenario: Scenario;
  unit: Unit;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_EffectiveInput".
 */
export interface EffectiveInput {
  diagnostics?: Diagnostics1;
  diff: Diff;
  effective_hash: EffectiveHash;
  hash_version?: HashVersion;
  overrides: Overrides;
  snapshot: FactorySnapshot | null;
  source_hash: SourceHash;
  transform_version?: TransformVersion;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_EffectiveDiff".
 */
export interface EffectiveDiff {
  after: ScenarioEngine_JsonValue;
  before: ScenarioEngine_JsonValue;
  field: Field1;
  target_id: TargetId;
  target_type: TargetType;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_TechnicianUnavailable".
 */
export interface TechnicianUnavailable {
  end_at: EndAt2;
  start_at: StartAt2;
  technician_id: TechnicianId;
  type: Type;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_MaintenanceDuration".
 */
export interface MaintenanceDuration {
  expected_duration_minutes: ExpectedDurationMinutes;
  maintenance_request_id: MaintenanceRequestId1;
  type: Type1;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_DeferMaintenance".
 */
export interface DeferMaintenance {
  earliest_start_at: EarliestStartAt;
  maintenance_request_id: MaintenanceRequestId2;
  type: Type2;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_FactorySnapshot".
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
  schema_version?: SchemaVersion2;
  snapshot_id: SnapshotId1;
  technicians?: Technicians;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_HealthSnapshot".
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
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_DiscreteRULDistribution".
 */
export interface DiscreteRULDistribution {
  model_version: ModelVersion;
  probability_mass: ProbabilityMass;
  support_minutes: SupportMinutes;
  survival_beyond_horizon: SurvivalBeyondHorizon;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_ProductionJob".
 */
export interface ProductionJob {
  display_name: DisplayName;
  due_at: DueAt;
  job_id: JobId1;
  operations: Operations;
  priority?: Priority;
  release_at: ReleaseAt;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_Operation".
 */
export interface Operation {
  machine_options: MachineOptions;
  operation_id: OperationId1;
  operation_type: OperationType;
  predecessor_operation_ids?: PredecessorOperationIds;
  sequence: Sequence;
  status?: OperationStatus;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_MachineOption".
 */
export interface MachineOption {
  expected_damage?: ExpectedDamage;
  load_factor?: LoadFactor;
  machine_id: MachineId2;
  processing_minutes: ProcessingMinutes;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_Machine".
 */
export interface Machine {
  capabilities: Capabilities;
  display_name: DisplayName1;
  machine_family: MachineFamily;
  machine_id: MachineId3;
  status: MachineStatus;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_MachineCapability".
 */
export interface MachineCapability {
  damage_factor?: DamageFactor;
  load_factor?: LoadFactor1;
  nominal_processing_minutes: NominalProcessingMinutes;
  operation_type: OperationType1;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_MaintenanceRequest".
 */
export interface MaintenanceRequest {
  action_type: ActionType;
  earliest_start_at: EarliestStartAt1;
  expected_duration_minutes: ExpectedDurationMinutes1;
  latest_start_at?: LatestStartAt;
  machine_id: MachineId4;
  maintenance_request_id: MaintenanceRequestId3;
  maintenance_type: MaintenanceType;
  mandatory?: Mandatory;
  minimum_skill_level?: MinimumSkillLevel;
  priority: MaintenancePriority;
  requested_at: RequestedAt;
  required_skill_ids: RequiredSkillIds;
  status: MaintenanceRequestStatus;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_Technician".
 */
export interface Technician {
  availability?: Availability;
  display_name: DisplayName2;
  skills: Skills;
  status: TechnicianStatus;
  technician_id: TechnicianId1;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_TechnicianSkill".
 */
export interface TechnicianSkill {
  certified_action_types?: CertifiedActionTypes;
  certified_machine_families?: CertifiedMachineFamilies;
  level: Level;
  skill_id: SkillId;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_Identity".
 */
export interface Identity {
  factory_id: FactoryId2;
  frozen_input_hash: FrozenInputHash;
  run_id: RunId;
  workspace_id: WorkspaceId;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_LiveMapping".
 */
export interface LiveMapping {
  mapped_defer_bounds: MappedDeferBounds;
  mapped_weights: ObjectiveWeights | null;
  reasons: Reasons;
  supported: Supported;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_SamplingEvidence".
 */
export interface SamplingEvidence {
  algorithm: Algorithm;
  base_seed: BaseSeed;
  coupling?: Coupling;
  coupling_key: CouplingKey;
  observation_set_hash: ObservationSetHash;
  sample_count: SampleCount;
  version?: Version1;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_SensitivityResult".
 */
export interface SensitivityResult {
  axis: Axis;
  baseline_point: Evaluation;
  baseline_value: BaselineValue;
  contract_version?: ContractVersion1;
  engine_version?: EngineVersion1;
  fixed_inputs: FixedInputs;
  identity: Identity;
  outcome: Outcome2;
  points: Points;
  rank_change_intervals: RankChangeIntervals;
  requested_order: RequestedOrder;
  sampling: SamplingEvidence;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_DurationAxis".
 */
export interface DurationAxis {
  maintenance_request_id: MaintenanceRequestId4;
  type: Type3;
  values: Values;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_WeightAxis".
 */
export interface WeightAxis {
  type: Type4;
  values: Values1;
  weight: Weight;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_SensitivityPoint".
 */
export interface SensitivityPoint {
  comparison: Comparison;
  evaluation: Evaluation;
  input_hash: InputHash;
  status: Status;
  value: Value;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_RankChangeInterval".
 */
export interface RankChangeInterval {
  from_strategy: FromStrategy;
  interpretation?: Interpretation;
  lower_sample: LowerSample;
  to_strategy: ToStrategy;
  upper_sample: UpperSample;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "Point".
 */
export interface Point {
  point_index: number;
  value: number | null;
  status: "QUEUED" | "RUNNING" | "FEASIBLE" | "NO_FEASIBLE_PLAN" | "FAILED" | "TIMEOUT";
  error_code: string | null;
  result: Evaluation | null;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_ComparedRun".
 */
export interface ComparedRun {
  comparison: Comparison;
  engine_version?: EngineVersion2;
  identity: Identity;
  overrides: Overrides1;
  planning_config: ScenarioPlanningConfig;
  sampling: SamplingEvidence;
  semantic_input_hash: SemanticInputHash1;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_ScenarioPlanningConfig".
 */
export interface ScenarioPlanningConfig {
  allowed_strategy_ids: AllowedStrategyIds;
  base_seed?: BaseSeed1;
  candidate_limit?: CandidateLimit;
  horizon_minutes: HorizonMinutes;
  objective_weights: ObjectiveWeights;
  simulation_runs?: SimulationRuns1;
  solver_timeout_seconds?: SolverTimeoutSeconds;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "ScenarioEngine_CompareResult".
 *
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "Comparison".
 */
export interface CompareResult {
  contract_version?: ContractVersion2;
  engine_version?: EngineVersion3;
  reference_identity: Identity;
  reference_overrides: ReferenceOverrides;
  reference_planning_config: ScenarioPlanningConfig;
  reference_sampling: SamplingEvidence;
  reference_semantic_input_hash: ReferenceSemanticInputHash;
  runs: Runs;
  score_comparison?: ScoreComparison1;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "LiveCreated".
 */
export interface LiveCreated {
  workspace_id: string;
  source_run_id: string;
  decision_case_id: string;
  mode: "LIVE";
  current_head: Head;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "post_scenario_workspaces".
 */
export interface PostScenarioWorkspaces {
  success: true;
  data: Workspace;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "get_scenario_workspaces".
 */
export interface GetScenarioWorkspaces {
  success: true;
  data: {
    items: Workspace[];
    next_cursor: string | null;
  };
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "get_scenario_workspaces_by_workspace_id".
 */
export interface GetScenarioWorkspacesByWorkspaceId {
  success: true;
  data: Workspace;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "get_scenario_workspaces_by_workspace_id_baseline_entities".
 */
export interface GetScenarioWorkspacesByWorkspaceIdBaselineEntities {
  success: true;
  data: BaselineEntities;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "post_scenario_workspaces_by_workspace_id_scenarios".
 */
export interface PostScenarioWorkspacesByWorkspaceIdScenarios {
  success: true;
  data: Draft;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "get_scenario_workspaces_by_workspace_id_scenarios".
 */
export interface GetScenarioWorkspacesByWorkspaceIdScenarios {
  success: true;
  data: {
    items: Draft[];
    next_cursor: string | null;
  };
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "get_scenario_workspaces_by_workspace_id_scenarios_by_scenario_id".
 */
export interface GetScenarioWorkspacesByWorkspaceIdScenariosByScenarioId {
  success: true;
  data: Draft;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "patch_scenario_workspaces_by_workspace_id_scenarios_by_scenario_id".
 */
export interface PatchScenarioWorkspacesByWorkspaceIdScenariosByScenarioId {
  success: true;
  data: Draft;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "post_scenario_workspaces_by_workspace_id_runs".
 */
export interface PostScenarioWorkspacesByWorkspaceIdRuns {
  success: true;
  data: Job;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "get_scenario_workspaces_by_workspace_id_runs".
 */
export interface GetScenarioWorkspacesByWorkspaceIdRuns {
  success: true;
  data: {
    items: Job[];
    next_cursor: string | null;
  };
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "get_scenario_workspaces_by_workspace_id_runs_by_run_id".
 */
export interface GetScenarioWorkspacesByWorkspaceIdRunsByRunId {
  success: true;
  data: Job;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "get_scenario_workspaces_by_workspace_id_compare".
 */
export interface GetScenarioWorkspacesByWorkspaceIdCompare {
  success: true;
  data: CompareResult;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "post_scenario_workspaces_by_workspace_id_sensitivity_jobs".
 */
export interface PostScenarioWorkspacesByWorkspaceIdSensitivityJobs {
  success: true;
  data: Job;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "get_scenario_workspaces_by_workspace_id_sensitivity_jobs".
 */
export interface GetScenarioWorkspacesByWorkspaceIdSensitivityJobs {
  success: true;
  data: {
    items: Job[];
    next_cursor: string | null;
  };
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "get_scenario_workspaces_by_workspace_id_sensitivity_jobs_by_job_id".
 */
export interface GetScenarioWorkspacesByWorkspaceIdSensitivityJobsByJobId {
  success: true;
  data: Job;
}
/**
 * This interface was referenced by `ScenarioProposalCatalog`'s JSON-Schema
 * via the `definition` "post_scenario_workspaces_by_workspace_id_live_evaluations".
 */
export interface PostScenarioWorkspacesByWorkspaceIdLiveEvaluations {
  success: true;
  data: LiveCreated;
}
