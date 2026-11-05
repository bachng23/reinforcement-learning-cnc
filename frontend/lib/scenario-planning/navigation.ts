import type { PageQuery } from "./client";
export type ScenarioSelection = {
  factory_id: string;
  scenario_id?: string;
  run_id?: string;
  compare?: string[];
  sensitivity_id?: string;
  candidate_id?: string;
  point?: string;
  metric?: string;
  draft_cursor?: string;
  run_cursor?: string;
};
export function scenarioHref(
  factoryId: string,
  workspaceId?: string,
  selection: Partial<Omit<ScenarioSelection, "factory_id">> & PageQuery = {},
) {
  const query = new URLSearchParams({ factory_id: factoryId });
  for (const [key, value] of Object.entries(selection))
    if (
      value !== undefined &&
      value !== "" &&
      (!Array.isArray(value) || value.length)
    )
      query.set(key, Array.isArray(value) ? value.join(",") : String(value));
  return `/operations/scenarios${workspaceId ? `/${encodeURIComponent(workspaceId)}` : ""}?${query}`;
}
export function parseScenarioSelection(
  params: Record<string, string | string[] | undefined>,
  fallback: string,
): ScenarioSelection {
  const first = (key: string) =>
    Array.isArray(params[key]) ? params[key][0] : params[key];
  return {
    factory_id: first("factory_id") ?? fallback,
    scenario_id: first("scenario_id"),
    run_id: first("run_id"),
    compare: first("compare")?.split(",").filter(Boolean),
    sensitivity_id: first("sensitivity_id"),
    candidate_id: first("candidate_id"),
    point: first("point"),
    metric: first("metric"),
    draft_cursor: first("draft_cursor"),
    run_cursor: first("run_cursor"),
  };
}
