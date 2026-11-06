import { authFetch, endpoint, type TokenUser } from "@/lib/auth";
import contract from "@/types/generated/work-orders.schema.json";
import type { WorkOrderEligibleAssigneesResponse, WorkOrderOriginResponse, WorkOrderCommandRequest, WorkOrderCreateRequest, WorkOrderEventsResponse, WorkOrderListResponse, WorkOrderLookupResponse, WorkOrderResponse, WorkOrderSummary } from "@/types/generated/work-orders";

export const WORK_ORDER_STATUSES = contract.definitions.WorkOrderSummary.properties.status.enum;
export type WorkOrderStatus = WorkOrderSummary["status"];
// Query DTO is derived from merged OpenAPI parameters, not a domain projection.
export type WorkOrderQuery = { factory_id: string; status?: WorkOrderStatus; machine_id?: string; assignee_user_id?: string; overdue?: "true" | "false"; limit?: number; cursor?: string };
export type RequestOptions = { signal?: AbortSignal };
export type WriteOptions = RequestOptions & { key: string };
type JsonSchema = { $ref?: string; type?: string | string[]; enum?: unknown[]; properties?: Record<string, JsonSchema>; required?: string[]; additionalProperties?: boolean; items?: JsonSchema; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string; format?: string };
const schemas = contract.definitions as Record<string, JsonSchema>;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Structural boundary driven by the generated producer schema. No lifecycle,
 * overdue, feasibility, ranking, hash or physical-recovery calculation. */
function matches(value: unknown, schema: JsonSchema): boolean {
  if (schema.$ref) return matches(value, schemas[schema.$ref.split("/").at(-1)!]);
  const types = typeof schema.type === "string" ? [schema.type] : schema.type;
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
  if (types && !types.includes(type) && !(type === "integer" && types.includes("number"))) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (typeof value === "number" && (!Number.isFinite(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return false;
  if (typeof value === "string") {
    if ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength) || (schema.pattern && !new RegExp(schema.pattern).test(value))) return false;
    if (schema.format === "date-time" && (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) return false;
    if (schema.format === "uuid" && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) return false;
  }
  if (Array.isArray(value) && schema.items && !value.every(item => matches(item, schema.items!))) return false;
  if (record(value)) {
    if (schema.required?.some(key => !(key in value))) return false;
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) { if (!matches(child, schema.properties[key])) return false; }
      else if (schema.additionalProperties === false) return false;
    }
  }
  return true;
}

export class WorkOrdersError extends Error {
  constructor(public status: number, public code: string, public requestId?: string) { super(code); this.name = "WorkOrdersError"; }
}
export function workOrderError(error: unknown) {
  if (error instanceof WorkOrdersError) return error;
  if (error instanceof Error && error.name === "AuthRedirectError") return new WorkOrdersError(401, "UNAUTHORIZED");
  return new WorkOrdersError(0, "NETWORK_ERROR");
}
export const errorExplanation = (error: WorkOrdersError) => {
  if (error.status === 401) return "Your session has expired. Sign in again.";
  if (error.status === 403) return "You no longer have permission for this operation. Refresh access before continuing.";
  if (error.status === 404) return "This resource is unavailable or inaccessible. No metadata is disclosed.";
  const codes: Record<string, string> = {
    INVALID_CURSOR: "This cursor is no longer valid for your user, factory or filters. Restart pagination.",
    WORK_ORDER_ORIGIN_EXISTS: "An order already exists for this exact publication assignment. Open the existing order using the exact publication origin.",
    ACTIVE_MAINTENANCE_REQUEST_EXISTS: "An active order already exists for this maintenance request. Review existing work; nothing was cancelled or bypassed.",
    WORK_ORDER_OVERLAP: "The planned window overlaps existing work. Review the source and explicitly provide an override reason for a new intent, if authorized.",
    SOURCE_PLAN_CHANGED: "The source publication/head changed. Review this original source against the refreshed context; it will not be replaced with a newer assignment.",
    INVALID_WORK_ORDER_SOURCE: "This source is not eligible for work-order creation. No candidate, seed, simulation or cancelled assignment is substituted.",
    ASSIGNEE_UNAVAILABLE: "The assignee is no longer eligible. Use manager hold/reassignment or independent reassignment for rework, not access restoration.",
    WORK_ORDER_INDEPENDENT_VERIFICATION_REQUIRED: "A different authorized user must verify this completion or request rework.",
    INVALID_RESPONSE: "The response could not be verified against the Work Order contract. No replacement data is shown.",
    SESSION_CHANGED: "The signed-in user changed. Previous data and drafts have been cleared. Reload the workspace.",
  };
  if (codes[error.code]) return codes[error.code];
  if (error.status === 409) return "This order changed or the command is no longer allowed. Refresh and review before a new intent. The previous request will not be rebased or resubmitted.";
  if (error.status === 503 || error.status >= 500) return "The service is unavailable. A write may already have committed; recover with the same key/body and reconcile authoritative reads.";
  if (error.status === 0) return "The service could not be reached. Check your connection. An unconfirmed write may already have committed.";
  return "The request was rejected. Review the form and authoritative state before a new intent.";
};

export function createWorkOrdersClient({ fetcher = authFetch, baseUrl = endpoint("/api/v1") }: { fetcher?: typeof fetch; baseUrl?: string } = {}) {
  const base = baseUrl.replace(/\/+$/, "");
  async function read<T>(path: string, schema: string, options: RequestOptions = {}, body?: unknown, key?: string): Promise<T> {
    if (body !== undefined && (!key || !/^[\x21-\x7e]{1,128}$/.test(key))) throw new WorkOrdersError(400, "INVALID_IDEMPOTENCY_KEY");
    const response = await fetcher(`${base}${path}`, { method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store", signal: options.signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json", "Idempotency-Key": key! }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload: unknown = await response.json().catch(() => null);
    const reference = response.headers.get("X-Request-Id") ?? (record(payload) && typeof payload.requestId === "string" ? payload.requestId : undefined);
    if (!response.ok) throw new WorkOrdersError(response.status, record(payload) && record(payload.error) && typeof payload.error.code === "string" ? payload.error.code : "REQUEST_FAILED", reference);
    if (!matches(payload, schemas[schema])) throw new WorkOrdersError(502, "INVALID_RESPONSE", reference);
    return payload as T;
  }
  const queryString = (query: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string | number] => entry[1] !== undefined).map(([key, value]) => [key, String(value)])).toString();
  return {
    eligibleAssignees: (factoryId: string, query = "", after?: string, options?: RequestOptions) => read<WorkOrderEligibleAssigneesResponse>(`/work-orders/eligible-assignees?${queryString({ factory_id: factoryId, query, after })}`, "WorkOrderEligibleAssigneesResponse", options),
    byOrigin: (factoryId: string, scheduleId: string, scheduleRevision: number, assignmentId: string, options?: RequestOptions) => read<WorkOrderOriginResponse>(`/work-orders/by-origin?${queryString({ factory_id: factoryId, schedule_id: scheduleId, schedule_revision: scheduleRevision, assignment_id: assignmentId })}`, "WorkOrderOriginResponse", options),
    async identity(options: RequestOptions = {}): Promise<TokenUser> {
      const response = await fetcher(`${base}/auth/me`, { signal: options.signal, credentials: "include", cache: "no-store" });
      if (!response.ok) throw new WorkOrdersError(response.status, "SESSION_UNAVAILABLE", response.headers.get("X-Request-Id") ?? undefined);
      const payload: unknown = await response.json();
      if (!record(payload) || !record(payload.user) || typeof payload.user.id !== "string" || typeof payload.user.role !== "string") throw new WorkOrdersError(502, "INVALID_RESPONSE");
      return { id: payload.user.id, role: payload.user.role, ...(typeof payload.user.username === "string" ? { username: payload.user.username } : {}) };
    },
    async list(query: WorkOrderQuery, options?: RequestOptions) {
      const response = await read<WorkOrderListResponse>(`/work-orders?${queryString(query)}`, "WorkOrderListResponse", options);
      if (response.data.some(row => row.factory_id !== query.factory_id || row.basis_snapshot_id !== row.source.basis_snapshot_id
        || (query.status && row.status !== query.status) || (query.machine_id && row.machine_id !== query.machine_id)
        || (query.assignee_user_id && row.assignee?.user_id !== query.assignee_user_id) || (query.overdue && row.overdue !== (query.overdue === "true")))
        || new Set(response.data.map(row => row.id)).size !== response.data.length || response.meta.has_more !== Boolean(response.meta.next_cursor)
        || (response.meta.has_more && !response.data.length)) throw new WorkOrdersError(502, "INVALID_RESPONSE");
      return response;
    },
    async detail(id: string, options?: RequestOptions) {
      const response = await read<WorkOrderResponse>(`/work-orders/${encodeURIComponent(id)}`, "WorkOrderResponse", options);
      if (response.data.id !== id || response.data.basis_snapshot_id !== response.data.source.basis_snapshot_id) throw new WorkOrdersError(502, "INVALID_RESPONSE");
      return response;
    },
    async events(id: string, after = 0, limit = 100, options?: RequestOptions) {
      const response = await read<WorkOrderEventsResponse>(`/work-orders/${encodeURIComponent(id)}/events?${queryString({ after_sequence: after, limit })}`, "WorkOrderEventsResponse", options);
      if (response.data.some((row, index) => row.work_order_id !== id || row.sequence !== after + index + 1) || new Set(response.data.map(row => row.id)).size !== response.data.length
        || (response.meta.has_more && (!response.data.length || response.meta.next_after_sequence !== response.data.at(-1)?.sequence))) throw new WorkOrdersError(502, "INVALID_RESPONSE");
      return response;
    },
    async summaries(factoryId: string, ids: string[], options?: RequestOptions) {
      const response = await read<WorkOrderLookupResponse>(`/work-orders/summaries?${queryString({ factory_id: factoryId, ids: ids.join(",") })}`, "WorkOrderLookupResponse", options);
      const uniqueIds = [...new Set(ids)];
      if (response.data.length !== uniqueIds.length || response.data.some((row, index) => row.id !== uniqueIds[index] || row.factory_id !== factoryId || row.basis_snapshot_id !== row.source.basis_snapshot_id)) throw new WorkOrdersError(502, "INVALID_RESPONSE");
      return response;
    },
    create: (body: WorkOrderCreateRequest, options: WriteOptions) => read<WorkOrderResponse>("/work-orders", "WorkOrderResponse", options, body, options.key),
    command: (id: string, body: WorkOrderCommandRequest, options: WriteOptions) => read<WorkOrderResponse>(`/work-orders/${encodeURIComponent(id)}/commands`, "WorkOrderResponse", options, body, options.key),
  };
}
export type WorkOrdersClient = ReturnType<typeof createWorkOrdersClient>;
export const workOrdersApi = createWorkOrdersClient();
