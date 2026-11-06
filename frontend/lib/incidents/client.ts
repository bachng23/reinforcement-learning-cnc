import { authFetch, endpoint } from "@/lib/auth";
import { OperationsApiError, type OperationsWriteOptions } from "@/lib/operations-api/client";

export const statuses = ["OPEN", "ACKNOWLEDGED", "INVESTIGATING", "RESOLVED", "CLOSED"] as const;
export const severities = ["INFO", "WARNING", "CRITICAL"] as const;
export type Severity = typeof severities[number];
export type Source = { type: "manual"; source_event_id: string } | { type: "case_health_alert"; case_id: string };
export type Machine = { machine_id: string; basis_snapshot_id: string };
export type Incident = {
  id: string; factory_id: string; title: string; category: string; machine: Machine | null;
  source: Source["type"]; severity: Severity | null; proposed_severity: Severity | null;
  status: typeof statuses[number]; owner_user_id: string | null; revision: number;
  occurrence_count: number; first_occurred_at: string; last_occurred_at: string; created_at: string; updated_at: string;
};
export type Report = {
  factory_id: string; source: Source; title: string; description: string;
  category: "EQUIPMENT" | "PROCESS" | "SAFETY" | "OTHER"; machine?: Machine;
  proposed_severity?: Severity; severity?: Severity; related_incident_reason?: string;
};
export type Resolution = { code: "FIXED" | "FALSE_POSITIVE" | "NO_ACTION_REQUIRED"; summary: string; evidence: string };
export type Command = { expected_revision: number } & (
  | { command: "ASSIGN"; owner_user_id: string }
  | { command: "REASSIGN"; owner_user_id: string; reason: string }
  | { command: "ACKNOWLEDGE" | "START_INVESTIGATION" }
  | { command: "CHANGE_SEVERITY"; severity: Severity; reason: string }
  | { command: "APPEND_OCCURRENCE"; source: Source; reason: string }
  | { command: "MARK_RESOLVED"; resolution: Resolution; work_order_override_reason?: string }
  | { command: "CLOSE"; verification: { resolution_code: Resolution["code"]; note: string }; work_order_override_reason?: string }
  | { command: "REOPEN"; reason: string }
);
export type Link = { id: string; type: "case" | "work_order"; target_id: string;
  association_scope: "case" | "machine"; created_by: string; created_at: string; availability: string };
export type WorkOrder = { id: string; factory_id: string; machine_id: string; status: string; revision: number;
  source: { decision_case_id: string; published_plan_version: number; assignment_id: string }; source_is_current: boolean };
export type Detail = {
  incident: Incident; description: string;
  acknowledgment: { actor_id: string; occurred_at: string } | null;
  resolution: { actor_id: string; occurred_at: string; report: Resolution } | null;
  closure: { actor_id: string; occurred_at: string; verification: { resolution_code: string; note: string } } | null;
  links: Link[]; work_orders: WorkOrder[]; available_commands: Command["command"][];
};
export type Counts = { factory_id: string; total: number; by_status: Record<string, number>; by_severity: Record<string, number>;
  unconfirmed_severity: number; unassigned: number; awaiting_verification: number };
export type Query = { factory_id: string; status?: string; severity?: string; owner_user_id?: string; machine_id?: string; q?: string; cursor?: string; limit?: string };
export type Envelope<T> = { success: true; data: T; meta: { read_at: string; has_more?: boolean; next_cursor?: string | null; next_after_sequence?: number } };
export type Event = { id: string; sequence: number; command: string; actor_id: string; occurred_at: string; payload: Record<string, unknown> };
export type Evidence = { kind: "manual"; report_text: string } | {
  kind: "case_health_alert"; case_id: string; factory_id: string; basis_snapshot_id: string; machine_id: string; case_created_at: string;
  trigger: { type: "HEALTH_ALERT"; failure_probability: number; alert_threshold: number };
  health_samples: { health_snapshot_id: string; observed_at: string; source_model_version: string; failure_probability_horizon_minutes: number; failure_probability: number; health_index: number; confidence: string }[];
};
export type Occurrence = { id: string; sequence: number; actor_id: string; recorded_at: string; evidence: Evidence; source: Source; machine: Machine | null };
export type Mutation = { operation: "report"; body: Report }
  | { operation: "command"; body: Command }
  | { operation: "link"; body: { expected_revision: number; target: { type: "case" | "work_order"; id: string } } }
  | { operation: "unlink"; linkId: string; body: { expected_revision: number; reason: string } };

export async function incidentRequest<T>(path: string, options: { signal?: AbortSignal; method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<Envelope<T>> {
  const response = await authFetch(endpoint("/api/v1" + path), {
    method: options.method ?? "GET", signal: options.signal, cache: "no-store",
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  let body;
  try { body = await response.json(); } catch { throw new OperationsApiError(502, { success: false, error: { code: "INVALID_RESPONSE", message: "The server returned unreadable data." } }); }
  if (!response.ok) throw new OperationsApiError(response.status, body);
  if (body?.success !== true || body.data === undefined || typeof body.meta?.read_at !== "string") {
    throw new OperationsApiError(502, { success: false, error: { code: "INVALID_RESPONSE", message: "The server response is incomplete." } });
  }
  return body;
}
export function assertScope(rows: Incident[], factoryId: string) {
  if (!Array.isArray(rows) || rows.some(row => row.factory_id !== factoryId || typeof row.id !== "string"
    || !Number.isInteger(row.revision) || row.revision < 1 || !statuses.includes(row.status))) {
    throw new OperationsApiError(502, { success: false, error: { code: "INCIDENT_INTEGRITY_ERROR", message: "Incident scope or identity could not be verified." } });
  }
}
export async function list(query: Query, signal?: AbortSignal) {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => Boolean(value)) as [string, string][]);
  const result = await incidentRequest<Incident[]>("/incidents?" + params, { signal });
  assertScope(result.data, query.factory_id);
  return result;
}
export async function detail(id: string, factoryId: string, signal?: AbortSignal) {
  const result = await incidentRequest<Detail>("/incidents/" + encodeURIComponent(id), { signal });
  assertScope([result.data.incident], factoryId);
  if (result.data.incident.id !== id) throw new OperationsApiError(502, null);
  return result;
}
export async function mutate(id: string | undefined, factoryId: string, action: Mutation, options: OperationsWriteOptions) {
  const base = "/incidents" + (id ? "/" + encodeURIComponent(id) : "");
  const suffix = action.operation === "command" ? "/commands" : action.operation === "link" ? "/links"
    : action.operation === "unlink" ? "/links/" + encodeURIComponent(action.linkId) : "";
  const result = await incidentRequest<Detail>(base + suffix, { ...options, method: action.operation === "unlink" ? "DELETE" : "POST", body: action.body });
  assertScope([result.data.incident], factoryId);
  return result;
}
export function readError(error: unknown): string {
  if (error instanceof OperationsApiError) {
    if ([401, 403].includes(error.status)) return "Permission required. Your account cannot access this action.";
    if (error.status === 404) return "Not found in your authorized factory scope.";
    return error.apiError?.message ?? "Incident service unavailable. No fixture data is shown.";
  }
  return "Incident service unavailable. Check your connection and retry.";
}
