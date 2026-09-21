import { getOperationsFixture } from "@/lib/operations/fixtures";
import type { DecisionEvent } from "@/types/generated/operations";
import type { CandidatePlan, PlanKPIs } from "@/types/operations";

export type WhatIfScenarioId = "machine-unavailable" | "technician-unavailable" | "earlier-health-alert";

export interface WhatIfScenarioFixture {
  scenario_id: WhatIfScenarioId;
  name: string;
  description: string;
  run_id: string;
  seed: number;
  overrides: Array<{ label: string; value: string }>;
  baseline_kpis: PlanKPIs;
  result: CandidatePlan;
  events: DecisionEvent[];
}

const baselineKpis: PlanKPIs = {
  makespan_minutes: 456,
  total_tardiness_minutes: 58,
  maximum_tardiness_minutes: 31,
  on_time_completion_rate: 0.78,
  expected_failure_count: 0.36,
  failure_probability: 0.31,
  expected_emergency_downtime_minutes: 74,
  maintenance_cost: 280,
  technician_utilization: 0.49,
  schedule_changes: 0,
  decision_latency_ms: 0,
};

function simulationEvents(scenarioId: WhatIfScenarioId, candidatePlanId: string): DecisionEvent[] {
  const caseId = `case-what-if-${scenarioId}`;
  const correlationId = `corr-${caseId}`;
  return [
    {
      schema_version: "3.0",
      event_id: `${scenarioId}-event-001`,
      sequence: 1,
      decision_case_id: caseId,
      event_type: "agent.completed",
      occurred_at: "2026-09-21T09:01:00Z",
      subject_id: `${scenarioId}-analysis`,
      correlation_id: correlationId,
      payload: { role: "PDM", mode: "SIMULATION_ONLY", output: "risk-options-ready" },
    },
    {
      schema_version: "3.0",
      event_id: `${scenarioId}-event-002`,
      sequence: 2,
      decision_case_id: caseId,
      event_type: "candidate.created",
      occurred_at: "2026-09-21T09:02:00Z",
      subject_id: candidatePlanId,
      correlation_id: correlationId,
      payload: { candidate_plan_id: candidatePlanId, mode: "SIMULATION_ONLY" },
    },
    {
      schema_version: "3.0",
      event_id: `${scenarioId}-event-003`,
      sequence: 3,
      decision_case_id: caseId,
      event_type: "candidate.validated",
      occurred_at: "2026-09-21T09:03:00Z",
      subject_id: candidatePlanId,
      correlation_id: correlationId,
      payload: { candidate_plan_id: candidatePlanId, verdict: "VALID", mode: "SIMULATION_ONLY" },
    },
  ];
}

const operations = getOperationsFixture();
const [balanced, productionPriority, reliabilityPriority] = operations.recommendation.candidate_plans;

const scenarios: WhatIfScenarioFixture[] = [
  {
    scenario_id: "machine-unavailable",
    name: "Machine unavailable",
    description: "Remove M01 from the planning window and evaluate the returned balanced plan.",
    run_id: "simulation-machine-001",
    seed: 4107,
    overrides: [
      { label: "Machine", value: "M01" },
      { label: "Unavailable from", value: "09:15" },
      { label: "Duration", value: "60 min" },
      { label: "Simulation runs", value: "100" },
    ],
    baseline_kpis: baselineKpis,
    result: balanced,
    events: simulationEvents("machine-unavailable", balanced.candidate_plan_id),
  },
  {
    scenario_id: "technician-unavailable",
    name: "Technician unavailable",
    description: "Remove K-01 from the shift and inspect the reliability-priority fallback.",
    run_id: "simulation-technician-001",
    seed: 7331,
    overrides: [
      { label: "Technician", value: "K-01" },
      { label: "Unavailable", value: "Full shift" },
      { label: "Fallback pool", value: "K-02, K-03" },
      { label: "Simulation runs", value: "100" },
    ],
    baseline_kpis: baselineKpis,
    result: reliabilityPriority,
    events: simulationEvents("technician-unavailable", reliabilityPriority.candidate_plan_id),
  },
  {
    scenario_id: "earlier-health-alert",
    name: "Earlier health alert",
    description: "Move the M01 alert earlier and inspect the returned production-priority plan.",
    run_id: "simulation-alert-001",
    seed: 9025,
    overrides: [
      { label: "Machine", value: "M01" },
      { label: "Alert shift", value: "-60 min" },
      { label: "Planning horizon", value: "480 min" },
      { label: "Simulation runs", value: "100" },
    ],
    baseline_kpis: baselineKpis,
    result: productionPriority,
    events: simulationEvents("earlier-health-alert", productionPriority.candidate_plan_id),
  },
];

export function getWhatIfScenarios(): WhatIfScenarioFixture[] {
  return structuredClone(scenarios);
}
