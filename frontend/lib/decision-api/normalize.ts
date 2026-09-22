import { malformedProductApiResponse } from "@/lib/product-api/errors";
import type { EnvironmentConfig, FleetObservation, PolicyRecommendation, ToolAction } from "@/types/cnc";
import type { DecisionQueueItem, DecisionStatus } from "@/types/decision";

type RecordValue = Record<string, unknown>;

export function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function machineAction(value: unknown): value is { machine_id: string; action: ToolAction } {
  return record(value) && Boolean(text(value.machine_id)) &&
    (value.action === "CONTINUE" || value.action === "REPLACE");
}

/** Maps only values returned on the wire; never estimates severity, risk or cost. */
export function rowsFromEvents(input: {
  experimentId: string;
  experimentName: string;
  episodeId: string;
  attempt: number;
  environmentConfig: EnvironmentConfig;
  observations: unknown[];
  recommendations: unknown[];
  knownStatuses?: Map<string, { decisionId: string; status: DecisionStatus }>;
}): DecisionQueueItem[] {
  const byObservationId = new Map<string, RecordValue>();
  for (const value of input.observations) {
    if (!record(value) || !text(value.id) || !record(value.payload)) {
      throw malformedProductApiResponse("Product API returned a malformed observation event.");
    }
    byObservationId.set(value.id as string, value);
  }

  const rows: DecisionQueueItem[] = [];
  for (const value of input.recommendations) {
    if (!record(value) || !text(value.id) || !text(value.observationId) || !record(value.payload)) {
      throw malformedProductApiResponse("Product API returned a malformed recommendation event.");
    }
    const observationEvent = byObservationId.get(value.observationId as string);
    if (!observationEvent || !record(observationEvent.payload)) {
      throw malformedProductApiResponse("Recommendation has no matching observation event.");
    }
    const observation = observationEvent.payload;
    const recommendation = value.payload;
    const jointAction = recommendation.actions;
    if (!record(jointAction) || !Array.isArray(jointAction.actions) ||
      !jointAction.actions.every(machineAction) || !Array.isArray(observation.machines) ||
      !record(observation.inventory) || !text(observation.observation_id)) {
      throw malformedProductApiResponse("Product API returned malformed CNC recommendation data.");
    }
    const recommendationId = value.id as string;
    const known = input.knownStatuses?.get(recommendationId);
    for (const action of jointAction.actions) {
      const machine = observation.machines.find(
        (candidate) => record(candidate) && candidate.machine_id === action.machine_id,
      );
      if (!record(machine)) {
        throw malformedProductApiResponse("Recommendation action has no matching machine.");
      }
      const severity = text(machine.severity) ?? text(recommendation.severity);
      const failureRisk = number(machine.failure_risk) ?? number(machine.failureRisk);
      const predictedCost = number(recommendation.estimated_expected_cost);
      const deferConsequence = text(machine.defer_consequence) ?? text(recommendation.defer_consequence);
      rows.push({
        rowId: `${recommendationId}:${action.machine_id}`,
        recommendationId,
        ...(known ? { decisionId: known.decisionId } : {}),
        experimentId: input.experimentId,
        experimentName: input.experimentName,
        episodeId: input.episodeId,
        attempt: input.attempt,
        step: typeof value.step === "number" ? value.step : (observation.step as number),
        machineId: action.machine_id,
        ...(text(machine.tool_id) ? { toolId: text(machine.tool_id) } : {}),
        recommendedAction: action.action,
        ...(severity ? { severity } : {}),
        ...(failureRisk !== undefined ? { failureRisk } : {}),
        ...(predictedCost !== undefined ? { predictedCost } : {}),
        ...(deferConsequence ? { deferConsequence } : {}),
        status: known?.status ?? "NOT_OPENED",
        policyId: text(recommendation.policy_id) ?? "Not provided",
        observationKey: text(observationEvent.observationKey) ?? (observation.observation_id as string),
        observation: observation as unknown as FleetObservation,
        recommendation: recommendation as unknown as PolicyRecommendation,
        environmentConfig: input.environmentConfig,
        ...(text(value.createdAt) ? { createdAt: text(value.createdAt) } : {}),
      });
    }
  }
  return rows;
}

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function sortDecisionQueue(rows: DecisionQueueItem[]): DecisionQueueItem[] {
  return [...rows].sort((a, b) => {
    const severity = (SEVERITY_ORDER[a.severity?.toUpperCase() ?? ""] ?? 4) -
      (SEVERITY_ORDER[b.severity?.toUpperCase() ?? ""] ?? 4);
    if (severity) return severity;
    const risk = (b.failureRisk ?? -1) - (a.failureRisk ?? -1);
    if (risk) return risk;
    const cost = (b.predictedCost ?? -1) - (a.predictedCost ?? -1);
    if (cost) return cost;
    return a.machineId.localeCompare(b.machineId) || a.recommendationId.localeCompare(b.recommendationId);
  });
}
