export type OperationsSchemaVersion = "3.0";

export type MachineStatus = "IDLE" | "RUNNING" | "WARNING" | "MAINTENANCE" | "FAILED" | "UNAVAILABLE";
export type TechnicianStatus = "AVAILABLE" | "ASSIGNED" | "OFF_SHIFT" | "UNAVAILABLE";
export type AssignmentType = "PRODUCTION" | "MAINTENANCE" | "BLOCKED_TIME";
export type AssignmentStatus = "PROPOSED" | "COMMITTED" | "RUNNING" | "COMPLETED" | "CANCELLED";
export type DecisionCaseStatus = "CREATED" | "ANALYZING" | "GENERATING" | "VALIDATING" | "EXPLAINING" | "AWAITING_APPROVAL" | "APPROVED" | "MODIFIED" | "REJECTED" | "COMMITTED" | "FAILED" | "CANCELLED";
export type AgentRole = "SUPERVISOR" | "PDM" | "PRODUCTION_SCHEDULING" | "MAINTENANCE_PLANNING" | "TECHNICIAN_DISPATCH" | "INTEGRATED_PLANNING" | "VALIDATION" | "EXPLANATION";
export type RunStatus = "QUEUED" | "RUNNING" | "WAITING_FOR_DEPENDENCY" | "COMPLETED" | "FAILED" | "CANCELLED";
export type ToolCallStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";
export type PlanStrategy = "CURRENT" | "PRODUCTION_PRIORITY" | "BALANCED" | "RELIABILITY_PRIORITY" | "MANUAL" | "EXPERIMENTAL";

export interface TimeWindow {
  start_at: string;
  end_at: string;
}

export interface Machine {
  machine_id: string;
  display_name: string;
  machine_family: string;
  status: MachineStatus;
  capabilities: Array<{
    operation_type: string;
    nominal_processing_minutes: number;
    load_factor: number;
    damage_factor: number;
  }>;
}

export interface Technician {
  technician_id: string;
  display_name: string;
  status: TechnicianStatus;
  availability: TimeWindow[];
  skills: Array<{
    skill_id: string;
    level: number;
    certified_machine_families: string[];
    certified_action_types: string[];
  }>;
}

export interface HealthSnapshot {
  health_snapshot_id: string;
  machine_id: string;
  observed_at: string;
  health_index: number;
  observed_wear_um?: number;
  failure_probability_horizon_minutes: number;
  failure_probability: number;
  rul_distribution?: {
    support_minutes: number[];
    probability_mass: number[];
    survival_beyond_horizon: number;
    model_version: string;
  };
  confidence: "LOW" | "MEDIUM" | "HIGH";
  source_model_version: string;
}

export interface MaintenanceRequest {
  maintenance_request_id: string;
  machine_id: string;
  maintenance_type: "PREVENTIVE" | "CORRECTIVE";
  action_type: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  status: "OPEN" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  requested_at: string;
  earliest_start_at: string;
  latest_start_at?: string;
  expected_duration_minutes: number;
  required_skill_ids: string[];
  minimum_skill_level: number;
  mandatory: boolean;
}

export interface ScheduleAssignment {
  assignment_id: string;
  assignment_type: AssignmentType;
  status: AssignmentStatus;
  machine_id: string;
  start_at: string;
  end_at: string;
  locked: boolean;
  job_id?: string;
  operation_id?: string;
  maintenance_request_id?: string;
  technician_ids: string[];
}

export interface Schedule {
  schedule_id: string;
  factory_id: string;
  revision: number;
  planning_window: TimeWindow;
  created_at: string;
  assignments: ScheduleAssignment[];
}

export interface FactorySnapshot {
  schema_version: OperationsSchemaVersion;
  snapshot_id: string;
  factory_id: string;
  captured_at: string;
  planning_window: TimeWindow;
  machines: Machine[];
  jobs: Array<{
    job_id: string;
    display_name: string;
    release_at: string;
    due_at: string;
    priority: number;
    operations: Array<{
      operation_id: string;
      sequence: number;
      operation_type: string;
      status: string;
      predecessor_operation_ids: string[];
      machine_options: Array<{ machine_id: string; processing_minutes: number; load_factor: number; expected_damage?: number }>;
    }>;
  }>;
  technicians: Technician[];
  health_snapshots: HealthSnapshot[];
  maintenance_requests: MaintenanceRequest[];
  current_schedule: Schedule | null;
}

export interface MachineRiskReport {
  schema_version: OperationsSchemaVersion;
  risk_report_id: string;
  decision_case_id: string;
  snapshot_id: string;
  generated_by_agent_run_id: string;
  generated_at: string;
  machine_id: string;
  prediction_horizon_minutes: number;
  expected_rul_minutes?: number;
  failure_probability: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recommended_review_window_minutes: number;
  risk_drivers: Array<{ code: string; description: string; contribution?: number; evidence_refs: string[] }>;
  evidence_refs: string[];
}

export interface PlanKPIs {
  makespan_minutes: number;
  total_tardiness_minutes: number;
  maximum_tardiness_minutes: number;
  on_time_completion_rate: number;
  expected_failure_count: number;
  failure_probability: number;
  expected_emergency_downtime_minutes: number;
  maintenance_cost: number;
  technician_utilization: number;
  schedule_changes: number;
  decision_latency_ms?: number;
}

export interface CandidatePlan {
  schema_version: OperationsSchemaVersion;
  candidate_plan_id: string;
  decision_case_id: string;
  snapshot_id: string;
  plan_version: number;
  strategy: PlanStrategy;
  source_engine_id: string;
  source_engine_version: string;
  generated_at: string;
  schedule: Schedule;
  kpis: PlanKPIs;
  source_agent_run_ids: string[];
  assumptions: string[];
  warnings: string[];
  validation: {
    schema_version: OperationsSchemaVersion;
    validation_id: string;
    candidate_plan_id: string;
    validator_version: string;
    verdict: "VALID" | "INVALID" | "ERROR";
    validated_at: string;
    violations: Array<{ violation_id: string; constraint_code: string; severity: "ERROR" | "WARNING"; message: string; entity_refs: string[]; time_window?: TimeWindow }>;
    simulation_runs: number;
    warnings: string[];
  } | null;
}

export interface RecommendationPackage {
  schema_version: OperationsSchemaVersion;
  recommendation_id: string;
  decision_case_id: string;
  snapshot_id: string;
  generated_at: string;
  recommended_plan_id: string;
  candidate_plans: CandidatePlan[];
  explanation: {
    summary: string;
    primary_reasons: string[];
    tradeoffs: string[];
    residual_risks: string[];
    evidence_refs: string[];
  };
}

export interface DecisionCaseSummary {
  schema_version: OperationsSchemaVersion;
  decision_case_id: string;
  mode: "LIVE" | "SIMULATION_ONLY";
  status: DecisionCaseStatus;
  snapshot_id: string;
  created_at: string;
  updated_at: string;
  recommendation_id?: string;
  committed_schedule_id?: string;
  error_code?: string;
  trigger: {
    type: "HEALTH_ALERT";
    event_id: string;
    occurred_at: string;
    machine_id: string;
    failure_probability: number;
    alert_threshold: number;
  };
}

export interface AgentDefinition {
  schema_version: OperationsSchemaVersion;
  agent_id: string;
  version: string;
  role: AgentRole;
  display_name: string;
  goal: string;
  allowed_tool_ids: string[];
  timeout_seconds: number;
  max_tool_calls: number;
}

export interface AgentRunTrace {
  schema_version: OperationsSchemaVersion;
  agent_run_id: string;
  decision_case_id: string;
  task_id: string;
  agent_id: string;
  agent_version: string;
  role: AgentRole;
  status: RunStatus;
  started_at?: string;
  completed_at?: string;
  output_ref?: string;
  error_code?: string;
  tool_call_ids: string[];
  message_ids: string[];
}

export interface ToolCallTrace {
  schema_version: OperationsSchemaVersion;
  tool_call_id: string;
  decision_case_id: string;
  agent_run_id: string;
  correlation_id: string;
  tool_id: string;
  tool_version: string;
  status: ToolCallStatus;
  started_at: string;
  completed_at?: string;
  input_summary: Record<string, unknown>;
  output_summary?: Record<string, unknown>;
  evidence_refs: string[];
  error_code?: string;
  retry_count: number;
}

export interface AgentMessage {
  schema_version: OperationsSchemaVersion;
  message_id: string;
  decision_case_id: string;
  correlation_id: string;
  from_agent_run_id: string;
  to_agent_role: AgentRole;
  kind: "TASK" | "RESULT" | "EVIDENCE" | "FEEDBACK" | "ERROR";
  subject: string;
  created_at: string;
  payload: Record<string, unknown>;
  evidence_refs: string[];
}

export type HumanDecisionRequest =
  | { schema_version: OperationsSchemaVersion; decision_case_id: string; recommendation_id: string; expected_snapshot_id: string; decision: "APPROVE"; candidate_plan_id: string; expected_plan_version: number; note?: string }
  | { schema_version: OperationsSchemaVersion; decision_case_id: string; recommendation_id: string; expected_snapshot_id: string; decision: "MODIFY"; candidate_plan_id: string; expected_plan_version: number; modified_schedule: Schedule; note?: string }
  | { schema_version: OperationsSchemaVersion; decision_case_id: string; recommendation_id: string; expected_snapshot_id: string; decision: "REJECT"; note: string };

export interface OperationsFixture {
  factory_snapshot: FactorySnapshot;
  risk_reports: MachineRiskReport[];
  decision_cases: DecisionCaseSummary[];
  recommendation: RecommendationPackage;
  agent_definitions: AgentDefinition[];
  agent_runs: AgentRunTrace[];
  tool_calls: ToolCallTrace[];
  messages: AgentMessage[];
  modified_schedule: Schedule;
}
