import type { WorkOrderQuery } from "./client";
import { WORK_ORDER_STATUSES } from "./client";
import type { WorkOrderStatus } from "./client";

export function workOrdersHref(query: WorkOrderQuery): string {
  const params = new URLSearchParams();
  for (const key of ["factory_id", "status", "machine_id", "assignee_user_id", "overdue", "limit", "cursor"] as const) {
    const value = query[key]; if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return `/operations/work-orders?${params}`;
}
export function parseWorkOrderQuery(params: Record<string, string | string[] | undefined>, fallbackFactory: string): WorkOrderQuery {
  const first = (key: string) => Array.isArray(params[key]) ? params[key][0] : params[key];
  const status = first("status"); const overdue = first("overdue"); const limit = Number(first("limit") ?? 25);
  return { factory_id: first("factory_id") ?? fallbackFactory, limit: Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 25,
    ...(status && WORK_ORDER_STATUSES.includes(status) ? { status: status as WorkOrderStatus } : {}),
    ...(first("machine_id") ? { machine_id: first("machine_id") } : {}),
    ...(first("assignee_user_id") ? { assignee_user_id: first("assignee_user_id") } : {}),
    ...(overdue === "true" || overdue === "false" ? { overdue } : {}), ...(first("cursor") ? { cursor: first("cursor") } : {}) };
}
export function workOrderDetailHref(id: string, factory: string, returnTo?: string) {
  const query = new URLSearchParams({ factory_id: factory }); if (returnTo) query.set("returnTo", returnTo);
  return `/operations/work-orders/${encodeURIComponent(id)}?${query}`;
}
export function workOrderReturnHref(value: string | undefined, factory: string) {
  if (value) {
    try {
      const url = new URL(value, "https://work-orders.local");
      if (url.origin === "https://work-orders.local" && url.pathname === "/operations/work-orders" && url.searchParams.get("factory_id") === factory) return `${url.pathname}${url.search}`;
    } catch { /* Malformed return URLs fall back to the exact factory list. */ }
  }
  return workOrdersHref({ factory_id: factory });
}
// Navigation metadata only, never reports/reasons/tokens or authoritative rows.
export const cursorStacks = new Map<string, string[]>();
export const listScroll = new Map<string, { page: number; table: number }>();
let navigationScope: string | undefined;
export function clearWorkOrderNavigation() { cursorStacks.clear(); listScroll.clear(); navigationScope = undefined; }
export function bindWorkOrderNavigation(scope: string) {
  if (navigationScope !== undefined && navigationScope !== scope) clearWorkOrderNavigation();
  navigationScope = scope;
}
export const workOrderTime = (value: string | null | undefined) => value ? `${new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(value))} UTC` : "Not provided";
