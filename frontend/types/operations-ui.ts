// Fixture-backed view models for the UI port. Replace these imports with the
// generated contract v3 types when the schema-to-TypeScript pipeline lands.
export type AgentRole =
  | "SUPERVISOR"
  | "PDM"
  | "PRODUCTION_SCHEDULING"
  | "MAINTENANCE_PLANNING"
  | "TECHNICIAN_DISPATCH"
  | "INTEGRATED_PLANNING"
  | "VALIDATION"
  | "EXPLANATION"
  | "RAQMIX_POLICY";

export type RunStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_FOR_DEPENDENCY"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "NOT_CONFIGURED";

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

export type AgentRunSummary = {
  agentRunId: string;
  role: AgentRole;
  displayName: string;
  status: RunStatus;
  startedAt?: string;
  completedAt?: string;
  toolCallCount: number;
  outputLabel?: string;
  goal?: string;
  allowedTools?: string[];
  authority?: string;
};

export type DecisionEventItem = {
  schemaVersion: "3.0";
  eventId: string;
  sequence: number;
  decisionCaseId: string;
  eventType: DecisionEventType;
  occurredAt: string;
  subjectId: string;
  correlationId: string;
  title: string;
  summary: string;
  evidenceRefs: string[];
  payload: Record<string, unknown>;
};

export type AgentControlRoomFixture = {
  decisionCaseId: string;
  factoryId: string;
  status: "ANALYZING" | "GENERATING" | "VALIDATING" | "EXPLAINING" | "AWAITING_APPROVAL";
  trigger: string;
  lastSequence: number;
  agents: AgentRunSummary[];
  events: DecisionEventItem[];
};

export type AttentionItem = {
  id: string;
  machineId: string;
  title: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  status: "NEEDS_REVIEW" | "ANALYZING" | "MONITORING";
  risk: string;
  impact: string;
  action: string;
  evidence: string;
};

export type OperationsOverviewFixture = {
  factoryId: string;
  snapshotAt: string;
  attentionItems: AttentionItem[];
  activeAgentRuns: number;
  upcomingWindows: number;
  monitoredMachines: number;
};

export type ScenarioPresetId = "machine-unavailable" | "technician-unavailable" | "health-alert";

export type ScenarioInput = {
  label: string;
  value: string;
};

export type SimulationMetric = {
  label: string;
  baseline: string;
  simulated: string;
  tone: "positive" | "negative" | "neutral";
};

export type SimulationResult = {
  scenarioId: ScenarioPresetId;
  runId: string;
  seed: number;
  candidatePlanId: string;
  strategy: "BALANCED" | "PRODUCTION_PRIORITY" | "RELIABILITY_PRIORITY";
  verdict: "VALID" | "INVALID";
  metrics: SimulationMetric[];
  warnings: string[];
  eventSequence: DecisionEventItem[];
};

export type ScenarioPreset = {
  id: ScenarioPresetId;
  name: string;
  description: string;
  inputs: ScenarioInput[];
  result: SimulationResult;
};
