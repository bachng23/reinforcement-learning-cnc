import { createOperationsApiClient, type OperationsApiClient } from "@/lib/operations-api/client";
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import type { OperationsApiMode } from "@/lib/operations-api";

// Presentation routing/adapter selection only. HTTP DTOs and read hooks remain
// owned by OperationsApiClient; production never inherits an implicit mock mode.
const clients: Partial<Record<OperationsApiMode, OperationsApiClient>> = {};
export function operationsUiClient(mode: OperationsApiMode): OperationsApiClient {
  return clients[mode] ??= mode === "real" ? createOperationsApiClient() : createMockOperationsApiClient({ persist: true });
}
export function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
export function productionMode(demo?: string | string[]): OperationsApiMode {
  return firstParam(demo) === "1" ? "mock" : "real";
}
export function operationsHref(path: string, factoryId?: string, options: { demo?: boolean; caseId?: string; status?: string; mode?: string; plan_version?: string; schedule_id?: string; schedule_revision?: string; assignment_id?: string } = {}): string {
  const url = new URL(path, "https://operations.local");
  if (factoryId) url.searchParams.set("factory_id", factoryId);
  if (options.demo) url.searchParams.set("demo", "1");
  for (const [key, value] of Object.entries(options)) {
    if (key !== "demo" && typeof value === "string") url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
