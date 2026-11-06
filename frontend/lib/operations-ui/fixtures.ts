import type { AgentControlRoomFixture, AgentRole, DecisionEventItem, OperationsOverviewFixture, ScenarioPreset } from "@/types/operations-ui";

const CASE_ID = "dc-health-m03-001";
const CORRELATION_ID = "corr-dc-health-m03-001";

function event(
  sequence: number,
  eventType: DecisionEventItem["eventType"],
  subjectId: string,
  title: string,
  summary: string,
  payload: Record<string, unknown>,
  evidenceRefs: string[] = [],
): DecisionEventItem {
  return {
    schemaVersion: "3.0",
    eventId: `evt-${String(sequence).padStart(3, "0")}`,
    sequence,
    decisionCaseId: CASE_ID,
    eventType,
    occurredAt: `2026-09-21T08:${String(10 + sequence).padStart(2, "0")}:00.000Z`,
    subjectId,
    correlationId: CORRELATION_ID,
    title,
    summary,
    evidenceRefs,
    payload,
  };
}

export const agentControlRoomFixture: AgentControlRoomFixture = {
  decisionCaseId: CASE_ID,
  factoryId: "factory-demo-01",
  status: "GENERATING",
  trigger: "Machine M03 health alert",
  lastSequence: 13,
  agents: [
    { agentRunId: "run-supervisor", role: "SUPERVISOR", displayName: "Supervisor Agent", status: "WAITING_FOR_DEPENDENCY", toolCallCount: 0, outputLabel: "Waiting for policy inference", goal: "Coordinate evidence and publish a recommendation for human review.", allowedTools: [], authority: "Cannot approve, override, or commit decisions." },
    { agentRunId: "run-pdm", role: "PDM", displayName: "PdM Agent", status: "COMPLETED", startedAt: "2026-09-21T08:11:00.000Z", completedAt: "2026-09-21T08:13:00.000Z", toolCallCount: 1, outputLabel: "Risk evidence read", goal: "Report health values from the configured model output.", allowedTools: ["read_machine_health"], authority: "Cannot change predictions or select maintenance actions." },
    { agentRunId: "run-technician", role: "TECHNICIAN_DISPATCH", displayName: "Resource Agent", status: "COMPLETED", startedAt: "2026-09-21T08:11:00.000Z", completedAt: "2026-09-21T08:14:00.000Z", toolCallCount: 1, outputLabel: "Technician eligibility checked", goal: "Check skills, certifications, availability, and service duration.", allowedTools: ["check_technician_eligibility"], authority: "Cannot assign a technician or mutate a queue." },
    { agentRunId: "run-impact", role: "PRODUCTION_SCHEDULING", displayName: "Production Impact Agent", status: "COMPLETED", startedAt: "2026-09-21T08:11:00.000Z", completedAt: "2026-09-21T08:14:00.000Z", toolCallCount: 1, outputLabel: "Affected operations identified", goal: "Find scheduled production work on machines with maintenance requests.", allowedTools: ["inspect_production_impact"], authority: "Cannot change the schedule or declare feasibility." },
    { agentRunId: "run-raqmix", role: "RAQMIX_POLICY", displayName: "RA-QMIX Policy", status: "NOT_CONFIGURED", toolCallCount: 0, outputLabel: "Checkpoint and CTDE adapter not present", goal: "Select one local action per machine from masked observations.", allowedTools: ["CTDE policy inference (pending)"], authority: "Selects actions only; cannot commit state." },
    { agentRunId: "run-validator", role: "VALIDATION", displayName: "Deterministic Validator", status: "QUEUED", toolCallCount: 0, outputLabel: "Waiting for policy action", goal: "Check masks, eligibility, queue invariants, and safety constraints.", allowedTools: ["validate_joint_action (pending)"], authority: "Authoritative feasibility verdict; no natural-language override." },
  ],
  events: [
    event(1, "case.status_changed", CASE_ID, "Decision case opened", "The supervisor accepted a health alert for machine M03.", { status: "ANALYZING", trigger_type: "HEALTH_ALERT", machine_id: "M03" }),
    event(2, "agent.started", "run-pdm", "PdM analysis started", "The PdM Agent reads the recorded M03 health estimate.", { role: "PDM", task_id: "task-pdm" }, ["health-M03-001"]),
    event(3, "tool.started", "tool-call-pdm", "Health evidence tool started", "The read-only health tool was called by the PdM Agent.", { tool_id: "read_machine_health", status: "RUNNING" }),
    event(4, "tool.completed", "tool-call-pdm", "Risk tool completed", "The tool returned the recorded failure estimate and model version.", { tool_id: "read_machine_health", status: "SUCCEEDED", failure_probability: 0.42, model_version: "rul-demo-v1" }, ["health-M03-001"]),
    event(5, "agent.completed", "run-pdm", "PdM evidence ready", "The report preserves the health model output without changing the prediction.", { role: "PDM", output_ref: "health-M03-001" }, ["health-M03-001"]),
    event(6, "agent.started", "run-technician", "Resource analysis started", "The Resource Agent checks skills, machine certification, status, and availability.", { role: "TECHNICIAN_DISPATCH" }),
    event(7, "tool.started", "tool-call-resource", "Technician eligibility check started", "The resource tool evaluates the open M03 maintenance request.", { tool_id: "check_technician_eligibility", status: "RUNNING" }),
    event(8, "tool.completed", "tool-call-resource", "Technician eligibility checked", "T01 meets the recorded skill, certification, and availability constraints.", { tool_id: "check_technician_eligibility", eligible_technician_ids: ["T01"] }, ["MR-M03-001"]),
    event(9, "agent.completed", "run-technician", "Resource evidence ready", "Eligibility is reported as evidence; no assignment or queue mutation is performed.", { role: "TECHNICIAN_DISPATCH", eligible_technician_ids: ["T01"] }, ["MR-M03-001"]),
    event(10, "agent.started", "run-impact", "Production impact analysis started", "The impact agent finds current operations assigned to the maintenance machine.", { role: "PRODUCTION_SCHEDULING" }),
    event(11, "tool.started", "tool-call-impact", "Production impact tool started", "The read-only schedule inspection tool was called.", { tool_id: "inspect_production_impact", status: "RUNNING" }),
    event(12, "tool.completed", "tool-call-impact", "Affected operations identified", "Current M03 production assignments are listed for downstream policy analysis.", { tool_id: "inspect_production_impact", status: "SUCCEEDED" }, ["schedule-demo-current"]),
    event(13, "agent.completed", "run-impact", "Production evidence ready", "The evidence-gathering workflow is ready for policy inference; no recommendation has been issued.", { role: "PRODUCTION_SCHEDULING", next_stage: "RAQMIX_POLICY" }, ["schedule-demo-current"]),
  ],
};

export const operationsOverviewFixture: OperationsOverviewFixture = {
  factoryId: "factory-demo-01",
  snapshotAt: "2026-09-21T08:18:00.000Z",
  activeAgentRuns: 2,
  upcomingWindows: 4,
  monitoredMachines: 12,
  attentionItems: [
    { id: "case-m03-health", machineId: "M03", title: "Machine health alert", severity: "CRITICAL", status: "NEEDS_REVIEW", risk: "71% failure probability", impact: "2 jobs may be rerouted", action: "Schedule preventive maintenance", evidence: "risk-M03-t120" },
    { id: "case-m07-wear", machineId: "M07", title: "Tool wear approaching threshold", severity: "HIGH", status: "ANALYZING", risk: "34% failure probability", impact: "15 min expected delay", action: "Compare replacement windows", evidence: "wear-M07-t180" },
    { id: "case-m02-spare", machineId: "M02", title: "Spare inventory constraint", severity: "MEDIUM", status: "MONITORING", risk: "Low current failure risk", impact: "1 spare available", action: "Monitor inventory coverage", evidence: "inventory-M02-live" },
  ],
};

function simulationEvent(
  sequence: number,
  role: AgentRole,
  title: string,
  summary: string,
  scenarioId: string,
): DecisionEventItem {
  return {
    schemaVersion: "3.0",
    eventId: `${scenarioId}-event-${sequence}`,
    sequence,
    decisionCaseId: `sim-${scenarioId}`,
    eventType: sequence === 4 ? "candidate.validated" : "agent.completed",
    occurredAt: `2026-09-21T09:0${sequence}:00.000Z`,
    subjectId: `${scenarioId}-${role.toLowerCase()}`,
    correlationId: `corr-${scenarioId}`,
    title,
    summary,
    evidenceRefs: [`${scenarioId}-evidence-${sequence}`],
    payload: { role, mode: "SIMULATION_ONLY" },
  };
}

export const scenarioPresets: ScenarioPreset[] = [
  {
    id: "machine-unavailable",
    name: "Machine unavailable",
    description: "Take M03 out of service for a preventive maintenance window.",
    inputs: [
      { label: "Machine", value: "M03" },
      { label: "Unavailable", value: "90 min" },
      { label: "Start", value: "10:30" },
      { label: "Seeds", value: "20" },
    ],
    result: {
      scenarioId: "machine-unavailable",
      runId: "sim-run-machine-001",
      seed: 4107,
      candidatePlanId: "sim-plan-balanced-001",
      strategy: "BALANCED",
      verdict: "VALID",
      metrics: [
        { label: "Makespan", baseline: "510 min", simulated: "528 min", tone: "negative" },
        { label: "Total tardiness", baseline: "82 min", simulated: "46 min", tone: "positive" },
        { label: "Expected failures", baseline: "1.40", simulated: "0.35", tone: "positive" },
        { label: "Technician utilization", baseline: "42%", simulated: "61%", tone: "neutral" },
      ],
      warnings: ["J09 moves to M05 and finishes 18 minutes later."],
      eventSequence: [
        simulationEvent(1, "PDM", "Risk impact evaluated", "The simulated maintenance window reduces M03 failure exposure.", "machine-unavailable"),
        simulationEvent(2, "PRODUCTION_SCHEDULING", "Jobs rerouted", "Eligible operations were moved to M02 and M05.", "machine-unavailable"),
        simulationEvent(3, "TECHNICIAN_DISPATCH", "Technician assigned", "T02 remains eligible and available for the full window.", "machine-unavailable"),
        simulationEvent(4, "VALIDATION", "Scenario validated", "All hard constraints pass in simulation mode.", "machine-unavailable"),
      ],
    },
  },
  {
    id: "technician-unavailable",
    name: "Technician unavailable",
    description: "Remove T02 from the shift and test the fallback assignment.",
    inputs: [
      { label: "Technician", value: "T02" },
      { label: "Unavailable", value: "Full shift" },
      { label: "Fallback", value: "T04" },
      { label: "Seeds", value: "20" },
    ],
    result: {
      scenarioId: "technician-unavailable",
      runId: "sim-run-tech-001",
      seed: 7331,
      candidatePlanId: "sim-plan-reliability-002",
      strategy: "RELIABILITY_PRIORITY",
      verdict: "VALID",
      metrics: [
        { label: "Makespan", baseline: "510 min", simulated: "544 min", tone: "negative" },
        { label: "Total tardiness", baseline: "82 min", simulated: "67 min", tone: "positive" },
        { label: "Expected failures", baseline: "1.40", simulated: "0.52", tone: "positive" },
        { label: "Technician utilization", baseline: "42%", simulated: "78%", tone: "negative" },
      ],
      warnings: ["T04 reaches 78% utilization.", "Maintenance starts 25 minutes later than the preferred window."],
      eventSequence: [
        simulationEvent(1, "TECHNICIAN_DISPATCH", "Fallback search completed", "T04 is the only eligible technician in the revised calendar.", "technician-unavailable"),
        simulationEvent(2, "MAINTENANCE_PLANNING", "Window shifted", "The maintenance task moves to the first T04 availability window.", "technician-unavailable"),
        simulationEvent(3, "PRODUCTION_SCHEDULING", "Schedule repaired", "Affected operations are delayed but remain inside the planning horizon.", "technician-unavailable"),
        simulationEvent(4, "VALIDATION", "Scenario validated", "Skill, availability and precedence constraints pass.", "technician-unavailable"),
      ],
    },
  },
  {
    id: "health-alert",
    name: "Earlier health alert",
    description: "Move the M03 alert 60 minutes earlier in the simulator timeline.",
    inputs: [
      { label: "Machine", value: "M03" },
      { label: "Alert shift", value: "-60 min" },
      { label: "Risk horizon", value: "120 min" },
      { label: "Seeds", value: "30" },
    ],
    result: {
      scenarioId: "health-alert",
      runId: "sim-run-alert-001",
      seed: 9025,
      candidatePlanId: "sim-plan-production-003",
      strategy: "PRODUCTION_PRIORITY",
      verdict: "VALID",
      metrics: [
        { label: "Makespan", baseline: "510 min", simulated: "512 min", tone: "neutral" },
        { label: "Total tardiness", baseline: "82 min", simulated: "31 min", tone: "positive" },
        { label: "Expected failures", baseline: "1.40", simulated: "0.44", tone: "positive" },
        { label: "Technician utilization", baseline: "42%", simulated: "55%", tone: "neutral" },
      ],
      warnings: ["Result depends on the simulator alert-time assumption."],
      eventSequence: [
        simulationEvent(1, "PDM", "Earlier evidence applied", "The alert is available before J07 enters its critical operation.", "health-alert"),
        simulationEvent(2, "MAINTENANCE_PLANNING", "Larger window found", "An earlier low-load interval is available for maintenance.", "health-alert"),
        simulationEvent(3, "PRODUCTION_SCHEDULING", "Production impact minimized", "Only one operation requires rerouting.", "health-alert"),
        simulationEvent(4, "VALIDATION", "Scenario validated", "The candidate remains feasible across all sampled seeds.", "health-alert"),
      ],
    },
  },
];
