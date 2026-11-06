import type {
  CreateDraft,
  EnqueueSensitivity,
  PlanningConfig,
  BaselineEntities,
} from "@/types/generated/scenario-planning";
import { matchesScenarioSchema, ScenarioError } from "./client";
export const weightNames = [
  "production",
  "reliability",
  "maintenance",
  "workforce",
  "schedule_stability",
] as const;
export type Override = CreateDraft["overrides"][number];
export type Weights = CreateDraft["objective_weights"];
export function defaultPlanningConfig(): PlanningConfig {
  return {
    horizon_minutes: 720,
    candidate_limit: 3,
    solver_timeout_seconds: 30,
    simulation_runs: 100,
    base_seed: 17,
    objective_weights: {
      production: 1,
      reliability: 1,
      maintenance: 1,
      workforce: 1,
      schedule_stability: 0.25,
    },
    allowed_strategy_ids: [
      "PRODUCTION_PRIORITY",
      "BALANCED",
      "RELIABILITY_PRIORITY",
    ],
  };
}
export function validateWeights(weights: Partial<Weights>) {
  if (
    weightNames.some(
      (name) =>
        weights[name] === undefined ||
        !Number.isFinite(weights[name]) ||
        weights[name]! < 0 ||
        weights[name]! > 1e6,
    ) ||
    weightNames.reduce((sum, name) => sum + weights[name]!, 0) <= 1e-12
  )
    throw new ScenarioError(400, "INVALID_WEIGHTS");
}
export function validateDraft(
  input: CreateDraft,
  snapshot: BaselineEntities,
): CreateDraft {
  const draft = { ...input, name: input.name.trim(), note: input.note.trim() };
  if (!matchesScenarioSchema(draft, "CreateDraft"))
    throw new ScenarioError(400, "INVALID_INPUT");
  validateWeights(draft.objective_weights);
  const start = Date.parse(snapshot.planning_window.start_at),
    end = Date.parse(snapshot.planning_window.end_at);
  const seen = new Set<string>();
  for (const item of draft.overrides) {
    const target =
      item.type === "TECHNICIAN_UNAVAILABLE"
        ? item.technician_id
        : item.maintenance_request_id;
    const key = `${item.type}:${target}`;
    if (seen.has(key)) throw new ScenarioError(400, "DUPLICATE_OVERRIDE");
    seen.add(key);
    if (item.type === "TECHNICIAN_UNAVAILABLE") {
      if (!snapshot.technicians?.some((t) => t.technician_id === target))
        throw new ScenarioError(400, "INVALID_TARGET");
      if (
        Date.parse(item.start_at) < start ||
        Date.parse(item.end_at) > end ||
        Date.parse(item.start_at) >= Date.parse(item.end_at)
      )
        throw new ScenarioError(400, "INVALID_WINDOW");
    } else {
      if (
        !snapshot.maintenance_requests?.some(
          (r) =>
            r.maintenance_request_id === target &&
            !["COMPLETED", "CANCELLED"].includes(r.status),
        )
      )
        throw new ScenarioError(400, "INVALID_TARGET");
      if (
        item.type === "DEFER_MAINTENANCE" &&
        (Date.parse(item.earliest_start_at) < start ||
          Date.parse(item.earliest_start_at) >= end)
      )
        throw new ScenarioError(400, "INVALID_WINDOW");
    }
  }
  // Preserve the requested values. Canonical ordering, effective transforms,
  // hash, constraints, normalized weights and scoring belong to the server.
  return draft;
}
export function validateSweep(
  axis: EnqueueSensitivity["axis"],
  snapshot?: BaselineEntities,
) {
  if (
    !axis.values.length ||
    axis.values.length > 7 ||
    new Set(axis.values).size !== axis.values.length ||
    axis.values.some(
      (v) =>
        !Number.isFinite(v) ||
        (axis.type === "MAINTENANCE_DURATION" && !Number.isInteger(v)) ||
        v < (axis.type === "MAINTENANCE_DURATION" ? 1 : 0) ||
        v > (axis.type === "MAINTENANCE_DURATION" ? 43200 : 1e6),
    )
  )
    throw new ScenarioError(400, "INVALID_INPUT");
  if (
    axis.type === "MAINTENANCE_DURATION" &&
    !snapshot?.maintenance_requests?.some(
      (r) =>
        r.maintenance_request_id === axis.maintenance_request_id &&
        !["COMPLETED", "CANCELLED"].includes(r.status),
    )
  )
    throw new ScenarioError(400, "INVALID_INPUT");
}
export function requestedChanges(
  draft: CreateDraft,
  snapshot: BaselineEntities,
) {
  return draft.overrides.map((item) => {
    if (item.type === "TECHNICIAN_UNAVAILABLE") {
      const technician = snapshot.technicians?.find(
        (t) => t.technician_id === item.technician_id,
      );
      return {
        label: "Technician unavailable",
        target: technician?.display_name ?? item.technician_id,
        before:
          technician?.availability
            ?.map((window) => `${window.start_at} → ${window.end_at}`)
            .join("; ") || "Availability not provided",
        after: `${item.start_at} → ${item.end_at}`,
      };
    }
    const request = snapshot.maintenance_requests?.find(
      (r) => r.maintenance_request_id === item.maintenance_request_id,
    );
    return {
      label:
        item.type === "MAINTENANCE_DURATION"
          ? "Maintenance duration"
          : "Earliest maintenance start",
      target: `${request?.machine_id ?? ""} · ${item.maintenance_request_id}`,
      before:
        item.type === "MAINTENANCE_DURATION"
          ? `${request?.expected_duration_minutes ?? "Not provided"} min`
          : (request?.earliest_start_at ?? "Not provided"),
      after:
        item.type === "MAINTENANCE_DURATION"
          ? `${item.expected_duration_minutes} min`
          : item.earliest_start_at,
    };
  });
}
