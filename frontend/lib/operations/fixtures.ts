import type { CandidatePlan, OperationsFixture, Schedule, ScheduleAssignment } from "@/types/operations";

const currentAssignments: ScheduleAssignment[] = [
  { assignment_id: "A-101", assignment_type: "PRODUCTION", status: "RUNNING", machine_id: "M01", start_at: "2026-09-21T08:00:00Z", end_at: "2026-09-21T10:10:00Z", locked: true, job_id: "J-1042", operation_id: "O-17", technician_ids: [] },
  { assignment_id: "A-102", assignment_type: "PRODUCTION", status: "COMMITTED", machine_id: "M02", start_at: "2026-09-21T08:20:00Z", end_at: "2026-09-21T11:00:00Z", locked: false, job_id: "J-1048", operation_id: "O-21", technician_ids: [] },
  { assignment_id: "A-103", assignment_type: "MAINTENANCE", status: "RUNNING", machine_id: "M03", start_at: "2026-09-21T08:30:00Z", end_at: "2026-09-21T09:45:00Z", locked: true, maintenance_request_id: "MR-209", technician_ids: ["K-02"] },
  { assignment_id: "A-104", assignment_type: "PRODUCTION", status: "COMMITTED", machine_id: "M04", start_at: "2026-09-21T10:00:00Z", end_at: "2026-09-21T12:00:00Z", locked: false, job_id: "J-1051", operation_id: "O-24", technician_ids: [] },
  { assignment_id: "A-105", assignment_type: "BLOCKED_TIME", status: "COMMITTED", machine_id: "M02", start_at: "2026-09-21T12:00:00Z", end_at: "2026-09-21T12:30:00Z", locked: false, technician_ids: [] },
];

const schedule = (id: string, revision: number, assignments: ScheduleAssignment[]): Schedule => ({
  schedule_id: id,
  factory_id: "factory-north",
  revision,
  planning_window: { start_at: "2026-09-21T08:00:00Z", end_at: "2026-09-21T16:00:00Z" },
  created_at: "2026-09-21T08:00:00Z",
  assignments,
});

const proposedAssignments: ScheduleAssignment[] = [
  { ...currentAssignments[0], assignment_id: "A-P201", status: "PROPOSED", machine_id: "M04", start_at: "2026-09-21T08:50:00Z", end_at: "2026-09-21T11:00:00Z", locked: false },
  { ...currentAssignments[1], assignment_id: "A-P202", status: "PROPOSED", start_at: "2026-09-21T08:20:00Z", end_at: "2026-09-21T11:00:00Z" },
  { assignment_id: "A-P203", assignment_type: "MAINTENANCE", status: "PROPOSED", machine_id: "M01", start_at: "2026-09-21T09:15:00Z", end_at: "2026-09-21T10:15:00Z", locked: false, maintenance_request_id: "MR-210", technician_ids: ["K-01"] },
  { ...currentAssignments[2], assignment_id: "A-P204", status: "PROPOSED" },
  { ...currentAssignments[3], assignment_id: "A-P205", status: "PROPOSED", start_at: "2026-09-21T11:10:00Z", end_at: "2026-09-21T13:10:00Z" },
];

function candidate(
  id: string,
  strategy: CandidatePlan["strategy"],
  assignments: ScheduleAssignment[],
  kpis: CandidatePlan["kpis"],
  assumptions: string[],
  warnings: string[],
): CandidatePlan {
  return {
    schema_version: "3.0",
    candidate_plan_id: id,
    decision_case_id: "case-health-M01-0921",
    snapshot_id: "snapshot-shift-a-0921",
    plan_version: 3,
    strategy,
    source_engine_id: "integrated-cp-sat",
    source_engine_version: "0.3.0",
    generated_at: "2026-09-21T08:05:12Z",
    schedule: schedule(`schedule-${id}`, 8, assignments),
    kpis,
    source_agent_run_ids: ["run-integrated", "run-validation"],
    assumptions,
    warnings,
    validation: {
      schema_version: "3.0",
      validation_id: `validation-${id}`,
      candidate_plan_id: id,
      validator_version: "validator-0.3.0",
      verdict: "VALID",
      validated_at: "2026-09-21T08:05:18Z",
      violations: [],
      simulation_runs: 100,
      warnings,
    },
  };
}

const balanced = candidate(
  "plan-balanced-03",
  "BALANCED",
  proposedAssignments,
  { makespan_minutes: 431, total_tardiness_minutes: 26, maximum_tardiness_minutes: 14, on_time_completion_rate: 0.91, expected_failure_count: 0.08, failure_probability: 0.07, expected_emergency_downtime_minutes: 18, maintenance_cost: 420, technician_utilization: 0.68, schedule_changes: 3, decision_latency_ms: 3210 },
  ["K-01 remains available from 09:15 to 10:15", "M04 keeps its current capability certification"],
  ["O-24 starts 70 minutes later than the current schedule"],
);

const productionFirst = candidate(
  "plan-production-02",
  "PRODUCTION_PRIORITY",
  [
    { ...currentAssignments[0], assignment_id: "A-P301", status: "PROPOSED", end_at: "2026-09-21T10:10:00Z" },
    { ...currentAssignments[1], assignment_id: "A-P302", status: "PROPOSED" },
    { assignment_id: "A-P303", assignment_type: "MAINTENANCE", status: "PROPOSED", machine_id: "M01", start_at: "2026-09-21T11:00:00Z", end_at: "2026-09-21T12:00:00Z", locked: false, maintenance_request_id: "MR-210", technician_ids: ["K-01"] },
    { ...currentAssignments[3], assignment_id: "A-P304", status: "PROPOSED" },
  ],
  { makespan_minutes: 410, total_tardiness_minutes: 12, maximum_tardiness_minutes: 8, on_time_completion_rate: 0.96, expected_failure_count: 0.22, failure_probability: 0.19, expected_emergency_downtime_minutes: 42, maintenance_cost: 360, technician_utilization: 0.61, schedule_changes: 1, decision_latency_ms: 2840 },
  ["M01 can continue until the proposed maintenance window"],
  ["M01 retains elevated failure probability before intervention"],
);

const reliabilityFirst = candidate(
  "plan-reliability-01",
  "RELIABILITY_PRIORITY",
  [
    { assignment_id: "A-P401", assignment_type: "MAINTENANCE", status: "PROPOSED", machine_id: "M01", start_at: "2026-09-21T08:20:00Z", end_at: "2026-09-21T09:20:00Z", locked: false, maintenance_request_id: "MR-210", technician_ids: ["K-01"] },
    { ...currentAssignments[0], assignment_id: "A-P402", status: "PROPOSED", machine_id: "M04", start_at: "2026-09-21T08:30:00Z", end_at: "2026-09-21T10:40:00Z", locked: false },
    { ...currentAssignments[1], assignment_id: "A-P403", status: "PROPOSED" },
    { ...currentAssignments[2], assignment_id: "A-P404", status: "PROPOSED" },
  ],
  { makespan_minutes: 448, total_tardiness_minutes: 39, maximum_tardiness_minutes: 22, on_time_completion_rate: 0.84, expected_failure_count: 0.03, failure_probability: 0.03, expected_emergency_downtime_minutes: 8, maintenance_cost: 455, technician_utilization: 0.72, schedule_changes: 4, decision_latency_ms: 3490 },
  ["K-01 can begin intervention at 08:20"],
  ["J-1051 may finish after its preferred completion window"],
);

export const OPERATIONS_FIXTURE: OperationsFixture = {
  factory_snapshot: {
    schema_version: "3.0",
    snapshot_id: "snapshot-shift-a-0921",
    factory_id: "factory-north",
    captured_at: "2026-09-21T08:00:00Z",
    planning_window: { start_at: "2026-09-21T08:00:00Z", end_at: "2026-09-21T16:00:00Z" },
    machines: [
      { machine_id: "M01", display_name: "CNC Mill 01", machine_family: "cnc-mill", status: "WARNING", capabilities: [{ operation_type: "milling", nominal_processing_minutes: 45, load_factor: 1.1, damage_factor: 1.2 }] },
      { machine_id: "M02", display_name: "CNC Mill 02", machine_family: "cnc-mill", status: "RUNNING", capabilities: [{ operation_type: "milling", nominal_processing_minutes: 50, load_factor: 1, damage_factor: 1 }] },
      { machine_id: "M03", display_name: "CNC Lathe 03", machine_family: "cnc-lathe", status: "MAINTENANCE", capabilities: [{ operation_type: "turning", nominal_processing_minutes: 40, load_factor: 1, damage_factor: 1 }] },
      { machine_id: "M04", display_name: "CNC Mill 04", machine_family: "cnc-mill", status: "IDLE", capabilities: [{ operation_type: "milling", nominal_processing_minutes: 52, load_factor: 0.95, damage_factor: 0.9 }] },
    ],
    jobs: [
      { job_id: "J-1042", display_name: "Gear housing batch", release_at: "2026-09-21T08:00:00Z", due_at: "2026-09-21T14:00:00Z", priority: 90, operations: [{ operation_id: "O-17", sequence: 0, operation_type: "milling", status: "RUNNING", predecessor_operation_ids: [], machine_options: [{ machine_id: "M01", processing_minutes: 130, load_factor: 1.1, expected_damage: 0.18 }, { machine_id: "M04", processing_minutes: 130, load_factor: 0.95, expected_damage: 0.11 }] }] },
      { job_id: "J-1048", display_name: "Valve body batch", release_at: "2026-09-21T08:00:00Z", due_at: "2026-09-21T15:00:00Z", priority: 70, operations: [{ operation_id: "O-21", sequence: 0, operation_type: "milling", status: "SCHEDULED", predecessor_operation_ids: [], machine_options: [{ machine_id: "M02", processing_minutes: 160, load_factor: 1 }] }] },
      { job_id: "J-1051", display_name: "Bearing cap batch", release_at: "2026-09-21T09:00:00Z", due_at: "2026-09-21T15:30:00Z", priority: 60, operations: [{ operation_id: "O-24", sequence: 0, operation_type: "milling", status: "READY", predecessor_operation_ids: [], machine_options: [{ machine_id: "M04", processing_minutes: 120, load_factor: 0.95 }] }] },
    ],
    technicians: [
      { technician_id: "K-01", display_name: "Alex Tran", status: "AVAILABLE", availability: [{ start_at: "2026-09-21T08:00:00Z", end_at: "2026-09-21T16:00:00Z" }], skills: [{ skill_id: "mechanical", level: 4, certified_machine_families: ["cnc-mill"], certified_action_types: ["spindle-inspection"] }] },
      { technician_id: "K-02", display_name: "Minh Le", status: "ASSIGNED", availability: [{ start_at: "2026-09-21T09:45:00Z", end_at: "2026-09-21T16:00:00Z" }], skills: [{ skill_id: "electrical", level: 5, certified_machine_families: ["cnc-lathe"], certified_action_types: ["drive-calibration"] }] },
      { technician_id: "K-03", display_name: "Sam Nguyen", status: "OFF_SHIFT", availability: [], skills: [{ skill_id: "mechanical", level: 3, certified_machine_families: ["cnc-mill", "cnc-lathe"], certified_action_types: ["spindle-inspection"] }] },
    ],
    health_snapshots: [
      { health_snapshot_id: "health-M01-0800", machine_id: "M01", observed_at: "2026-09-21T08:00:00Z", health_index: 0.42, observed_wear_um: 180, failure_probability_horizon_minutes: 240, failure_probability: 0.31, confidence: "MEDIUM", source_model_version: "rul-v1", rul_distribution: { support_minutes: [0, 60, 120, 240], probability_mass: [0.01, 0.04, 0.15, 0.3], survival_beyond_horizon: 0.5, model_version: "rul-v1" } },
      { health_snapshot_id: "health-M02-0800", machine_id: "M02", observed_at: "2026-09-21T08:00:00Z", health_index: 0.81, observed_wear_um: 76, failure_probability_horizon_minutes: 240, failure_probability: 0.06, confidence: "HIGH", source_model_version: "rul-v1" },
      { health_snapshot_id: "health-M03-0800", machine_id: "M03", observed_at: "2026-09-21T08:00:00Z", health_index: 0.66, observed_wear_um: 112, failure_probability_horizon_minutes: 240, failure_probability: 0.12, confidence: "HIGH", source_model_version: "rul-v1" },
      { health_snapshot_id: "health-M04-0800", machine_id: "M04", observed_at: "2026-09-21T08:00:00Z", health_index: 0.9, observed_wear_um: 41, failure_probability_horizon_minutes: 240, failure_probability: 0.03, confidence: "HIGH", source_model_version: "rul-v1" },
    ],
    maintenance_requests: [
      { maintenance_request_id: "MR-209", machine_id: "M03", maintenance_type: "PREVENTIVE", action_type: "drive-calibration", priority: "NORMAL", status: "IN_PROGRESS", requested_at: "2026-09-21T07:30:00Z", earliest_start_at: "2026-09-21T08:30:00Z", latest_start_at: "2026-09-21T10:00:00Z", expected_duration_minutes: 75, required_skill_ids: ["electrical"], minimum_skill_level: 4, mandatory: false },
      { maintenance_request_id: "MR-210", machine_id: "M01", maintenance_type: "PREVENTIVE", action_type: "spindle-inspection", priority: "HIGH", status: "OPEN", requested_at: "2026-09-21T08:01:00Z", earliest_start_at: "2026-09-21T08:20:00Z", latest_start_at: "2026-09-21T11:30:00Z", expected_duration_minutes: 60, required_skill_ids: ["mechanical"], minimum_skill_level: 3, mandatory: false },
    ],
    current_schedule: schedule("schedule-current", 7, currentAssignments),
  },
  risk_reports: [{ schema_version: "3.0", risk_report_id: "risk-M01-001", decision_case_id: "case-health-M01-0921", snapshot_id: "snapshot-shift-a-0921", generated_by_agent_run_id: "run-pdm", generated_at: "2026-09-21T08:02:04Z", machine_id: "M01", prediction_horizon_minutes: 240, expected_rul_minutes: 186, failure_probability: 0.31, confidence: "MEDIUM", risk_level: "HIGH", recommended_review_window_minutes: 90, risk_drivers: [{ code: "HIGH_LOAD_OPERATION", description: "O-17 exposes M01 to a high load factor.", contribution: 0.18, evidence_refs: ["health-M01-0800"] }, { code: "WEAR_TREND", description: "Observed wear increased in the latest sensor window.", contribution: 0.13, evidence_refs: ["evidence-sensor-M01"] }], evidence_refs: ["health-M01-0800", "tool-risk-M01"] }],
  decision_cases: [{ schema_version: "3.0", decision_case_id: "case-health-M01-0921", mode: "LIVE", status: "AWAITING_APPROVAL", snapshot_id: "snapshot-shift-a-0921", created_at: "2026-09-21T08:02:01Z", updated_at: "2026-09-21T08:05:20Z", recommendation_id: "recommendation-M01-001", trigger: { type: "HEALTH_ALERT", event_id: "event-health-M01", occurred_at: "2026-09-21T08:02:01Z", machine_id: "M01", failure_probability: 0.31, alert_threshold: 0.2 } }],
  recommendation: { schema_version: "3.0", recommendation_id: "recommendation-M01-001", decision_case_id: "case-health-M01-0921", snapshot_id: "snapshot-shift-a-0921", generated_at: "2026-09-21T08:05:20Z", recommended_plan_id: balanced.candidate_plan_id, candidate_plans: [balanced, productionFirst, reliabilityFirst], explanation: { summary: "Move O-17 from M01 to M04 and inspect M01 at 09:15 with K-01. The balanced plan preserves production flow while reducing the returned failure probability.", primary_reasons: ["M01 has a HIGH risk report for the next 240 minutes", "M04 is a validated routing option for O-17", "K-01 matches the mechanical skill requirement"], tradeoffs: ["O-24 starts later", "Maintenance cost is higher than the production-priority option"], residual_risks: ["Restoration effectiveness remains an assumption until inspection"], evidence_refs: ["risk-M01-001", "validation-plan-balanced-03", "tool-solver-001"] } },
  agent_definitions: [
    { schema_version: "3.0", agent_id: "agent-supervisor", version: "0.3.0", role: "SUPERVISOR", display_name: "Supervisor Agent", goal: "Coordinate the decision workflow and assemble validated recommendations.", allowed_tool_ids: [], timeout_seconds: 60, max_tool_calls: 8 },
    { schema_version: "3.0", agent_id: "agent-pdm", version: "0.3.0", role: "PDM", display_name: "PdM Agent", goal: "Produce health and risk evidence.", allowed_tool_ids: ["predict-rul"], timeout_seconds: 30, max_tool_calls: 4 },
    { schema_version: "3.0", agent_id: "agent-scheduling", version: "0.3.0", role: "PRODUCTION_SCHEDULING", display_name: "Scheduling Agent", goal: "Find production routing options.", allowed_tool_ids: ["find-alternative-machines"], timeout_seconds: 45, max_tool_calls: 5 },
    { schema_version: "3.0", agent_id: "agent-technician", version: "0.3.0", role: "TECHNICIAN_DISPATCH", display_name: "Technician Agent", goal: "Match technicians to maintenance options.", allowed_tool_ids: ["match-technician"], timeout_seconds: 30, max_tool_calls: 4 },
    { schema_version: "3.0", agent_id: "agent-integrated", version: "0.3.0", role: "INTEGRATED_PLANNING", display_name: "Integrated Planner", goal: "Generate integrated candidate plans.", allowed_tool_ids: ["run-cp-sat"], timeout_seconds: 90, max_tool_calls: 6 },
    { schema_version: "3.0", agent_id: "agent-validation", version: "0.3.0", role: "VALIDATION", display_name: "Validation Agent", goal: "Validate constraints and return authoritative plan KPIs.", allowed_tool_ids: ["simulate-plan"], timeout_seconds: 90, max_tool_calls: 6 },
  ],
  agent_runs: [
    { schema_version: "3.0", agent_run_id: "run-supervisor", decision_case_id: "case-health-M01-0921", task_id: "task-supervise", agent_id: "agent-supervisor", agent_version: "0.3.0", role: "SUPERVISOR", status: "RUNNING", started_at: "2026-09-21T08:02:01Z", tool_call_ids: [], message_ids: ["message-risk"] },
    { schema_version: "3.0", agent_run_id: "run-pdm", decision_case_id: "case-health-M01-0921", task_id: "task-health", agent_id: "agent-pdm", agent_version: "0.3.0", role: "PDM", status: "COMPLETED", started_at: "2026-09-21T08:02:02Z", completed_at: "2026-09-21T08:02:04Z", output_ref: "risk-M01-001", tool_call_ids: ["tool-risk-M01"], message_ids: ["message-risk"] },
    { schema_version: "3.0", agent_run_id: "run-scheduling", decision_case_id: "case-health-M01-0921", task_id: "task-routing", agent_id: "agent-scheduling", agent_version: "0.3.0", role: "PRODUCTION_SCHEDULING", status: "COMPLETED", started_at: "2026-09-21T08:02:05Z", completed_at: "2026-09-21T08:02:07Z", output_ref: "production-options-001", tool_call_ids: ["tool-routing-001"], message_ids: [] },
    { schema_version: "3.0", agent_run_id: "run-technician", decision_case_id: "case-health-M01-0921", task_id: "task-technician", agent_id: "agent-technician", agent_version: "0.3.0", role: "TECHNICIAN_DISPATCH", status: "COMPLETED", started_at: "2026-09-21T08:02:06Z", completed_at: "2026-09-21T08:02:08Z", output_ref: "technician-options-001", tool_call_ids: ["tool-technician-001"], message_ids: [] },
    { schema_version: "3.0", agent_run_id: "run-integrated", decision_case_id: "case-health-M01-0921", task_id: "task-plan", agent_id: "agent-integrated", agent_version: "0.3.0", role: "INTEGRATED_PLANNING", status: "COMPLETED", started_at: "2026-09-21T08:02:08Z", completed_at: "2026-09-21T08:05:12Z", output_ref: "plan-balanced-03", tool_call_ids: ["tool-solver-001"], message_ids: [] },
    { schema_version: "3.0", agent_run_id: "run-validation", decision_case_id: "case-health-M01-0921", task_id: "task-validate", agent_id: "agent-validation", agent_version: "0.3.0", role: "VALIDATION", status: "COMPLETED", started_at: "2026-09-21T08:05:12Z", completed_at: "2026-09-21T08:05:18Z", output_ref: "validation-plan-balanced-03", tool_call_ids: ["tool-validation-001"], message_ids: [] },
  ],
  tool_calls: [
    { schema_version: "3.0", tool_call_id: "tool-risk-M01", decision_case_id: "case-health-M01-0921", agent_run_id: "run-pdm", correlation_id: "corr-case-M01", tool_id: "predict-rul", tool_version: "1.4.0", status: "SUCCEEDED", started_at: "2026-09-21T08:02:02Z", completed_at: "2026-09-21T08:02:04Z", input_summary: { machine_id: "M01", sensor_window_ref: "sensor-window-M01-0800" }, output_summary: { risk_report_id: "risk-M01-001", failure_probability: 0.31, expected_rul_minutes: 186 }, evidence_refs: ["health-M01-0800"], retry_count: 0 },
    { schema_version: "3.0", tool_call_id: "tool-routing-001", decision_case_id: "case-health-M01-0921", agent_run_id: "run-scheduling", correlation_id: "corr-case-M01", tool_id: "find-alternative-machines", tool_version: "1.2.0", status: "SUCCEEDED", started_at: "2026-09-21T08:02:05Z", completed_at: "2026-09-21T08:02:07Z", input_summary: { operation_id: "O-17", excluded_machine_ids: ["M01"] }, output_summary: { option_ids: ["route-M04-O17"] }, evidence_refs: ["snapshot-shift-a-0921"], retry_count: 0 },
    { schema_version: "3.0", tool_call_id: "tool-technician-001", decision_case_id: "case-health-M01-0921", agent_run_id: "run-technician", correlation_id: "corr-case-M01", tool_id: "match-technician", tool_version: "1.0.0", status: "SUCCEEDED", started_at: "2026-09-21T08:02:06Z", completed_at: "2026-09-21T08:02:08Z", input_summary: { maintenance_request_id: "MR-210", required_skill_ids: ["mechanical"] }, output_summary: { technician_id: "K-01", skill_match_level: 4 }, evidence_refs: ["K-01", "MR-210"], retry_count: 0 },
    { schema_version: "3.0", tool_call_id: "tool-solver-001", decision_case_id: "case-health-M01-0921", agent_run_id: "run-integrated", correlation_id: "corr-case-M01", tool_id: "run-cp-sat", tool_version: "0.8.0", status: "SUCCEEDED", started_at: "2026-09-21T08:02:08Z", completed_at: "2026-09-21T08:05:12Z", input_summary: { snapshot_id: "snapshot-shift-a-0921", candidate_limit: 3 }, output_summary: { candidate_plan_ids: ["plan-balanced-03", "plan-production-02", "plan-reliability-01"] }, evidence_refs: ["production-options-001", "technician-options-001"], retry_count: 0 },
    { schema_version: "3.0", tool_call_id: "tool-validation-001", decision_case_id: "case-health-M01-0921", agent_run_id: "run-validation", correlation_id: "corr-case-M01", tool_id: "simulate-plan", tool_version: "0.5.0", status: "SUCCEEDED", started_at: "2026-09-21T08:05:12Z", completed_at: "2026-09-21T08:05:18Z", input_summary: { candidate_plan_id: "plan-balanced-03", simulation_runs: 100 }, output_summary: { verdict: "VALID", validation_id: "validation-plan-balanced-03" }, evidence_refs: ["validation-plan-balanced-03"], retry_count: 0 },
  ],
  messages: [{ schema_version: "3.0", message_id: "message-risk", decision_case_id: "case-health-M01-0921", correlation_id: "corr-case-M01", from_agent_run_id: "run-pdm", to_agent_role: "INTEGRATED_PLANNING", kind: "EVIDENCE", subject: "Machine risk report", created_at: "2026-09-21T08:02:04Z", payload: { machine_id: "M01", failure_probability: 0.31, expected_rul_minutes: 186, confidence: "MEDIUM", recommendation: "Evaluate maintenance within 90 minutes" }, evidence_refs: ["risk-M01-001"] }],
  modified_schedule: schedule("schedule-manual-draft", 8, proposedAssignments.map((assignment) => assignment.assignment_id === "A-P203" ? { ...assignment, start_at: "2026-09-21T09:30:00Z", end_at: "2026-09-21T10:30:00Z" } : assignment)),
};

/** Fixture values are copied from contract-shaped payloads; UI components must not recompute authoritative KPIs. */
export function getOperationsFixture(): OperationsFixture {
  return structuredClone(OPERATIONS_FIXTURE);
}
