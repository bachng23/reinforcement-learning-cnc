import { authFetch, endpoint } from "@/lib/auth";
import type {
  AgentMessage, AgentRunTrace, DecisionCaseStatusResponse, ErrorResponse,
  HumanDecisionRequest, Machine, MaintenanceRequest, ProductionJob,
  RunDecisionCaseRequest, Schedule, Technician, ToolCallTrace,
} from "@/types/generated/operations";

export interface OperationsRequestOptions { signal?: AbortSignal }
export class OperationsApiError extends Error {
  constructor(public readonly status: number, public readonly payload: unknown) {
    super(`Operations API request failed (${status})`);
    this.name = "OperationsApiError";
  }
  get contractError(): ErrorResponse | undefined {
    const value = this.payload as Partial<ErrorResponse> | null;
    return value && value.schema_version === "3.0" && typeof value.code === "string"
      && typeof value.message === "string" && typeof value.error_id === "string"
      && typeof value.correlation_id === "string" && typeof value.retryable === "boolean"
      ? value as ErrorResponse : undefined;
  }
}

/** Proposed v3 HTTP boundary: bare resources/arrays, not the legacy success/data envelope.
 * Types describe wire payloads, not runtime validation. Backend must validate with v3.
 * Inject fetcher/baseUrl to use a mock server while backend routes are implemented.
 */
export function createOperationsApiClient({
  fetcher = authFetch,
  baseUrl = endpoint("/api/v1"),
}: { fetcher?: typeof fetch; baseUrl?: string } = {}) {
  const base = baseUrl.replace(/\/+$/, "");
  const id = encodeURIComponent;
  async function request<T>(path: string, options: OperationsRequestOptions = {}, body?: unknown): Promise<T> {
    const response = await fetcher(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include", cache: "no-store", signal: options.signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw new OperationsApiError(response.status, payload);
    }
    return await response.json() as T;
  }
  return {
    listMachines: (factoryId: string, options?: OperationsRequestOptions) => request<Machine[]>(`/factories/${id(factoryId)}/machines`, options),
    listTechnicians: (factoryId: string, options?: OperationsRequestOptions) => request<Technician[]>(`/factories/${id(factoryId)}/technicians`, options),
    listProductionOrders: (options?: OperationsRequestOptions) => request<ProductionJob[]>("/production-orders", options),
    listMaintenanceRequests: (options?: OperationsRequestOptions) => request<MaintenanceRequest[]>("/maintenance-requests", options),
    getCurrentSchedule: (factoryId: string, options?: OperationsRequestOptions) => request<Schedule>(`/schedules/current?factory_id=${id(factoryId)}`, options),
    getSchedule: (scheduleId: string, options?: OperationsRequestOptions) => request<Schedule>(`/schedules/${id(scheduleId)}`, options),
    listDecisionCases: (options?: OperationsRequestOptions) => request<DecisionCaseStatusResponse[]>("/decision-cases", options),
    getDecisionCase: (caseId: string, options?: OperationsRequestOptions) => request<DecisionCaseStatusResponse>(`/decision-cases/${id(caseId)}`, options),
    // Provisional create DTO reuses the canonical request until backend owns snapshot creation.
    createDecisionCase: (body: RunDecisionCaseRequest, options?: OperationsRequestOptions) => request<DecisionCaseStatusResponse>("/decision-cases", options, body),
    runDecisionCase: (caseId: string, options?: OperationsRequestOptions) => request<DecisionCaseStatusResponse>(`/decision-cases/${id(caseId)}/run`, options, {}),
    submitHumanDecision: (body: HumanDecisionRequest, options?: OperationsRequestOptions) => request<DecisionCaseStatusResponse>(`/decision-cases/${id(body.decision_case_id)}/${body.decision.toLowerCase()}`, options, body),
    listAgentRuns: (caseId: string, options?: OperationsRequestOptions) => request<AgentRunTrace[]>(`/decision-cases/${id(caseId)}/agent-runs`, options),
    listMessages: (caseId: string, options?: OperationsRequestOptions) => request<AgentMessage[]>(`/decision-cases/${id(caseId)}/messages`, options),
    listToolCalls: (caseId: string, options?: OperationsRequestOptions) => request<ToolCallTrace[]>(`/decision-cases/${id(caseId)}/tool-calls`, options),
    eventsUrl: (caseId: string) => `${base}/decision-cases/${id(caseId)}/events`,
  };
}

export type OperationsApiClient = ReturnType<typeof createOperationsApiClient>;
