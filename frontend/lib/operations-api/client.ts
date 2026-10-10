import { authFetch, endpoint } from "@/lib/auth";
import type {
  DecisionCaseStatusResponse, DecisionEvent, ErrorResponse, FactorySnapshot,
  PlanningConfig, RecommendationPackage, RunDecisionCaseRequest, Schedule,
} from "@/types/generated/operations";

export interface OperationsRequestOptions { signal?: AbortSignal }
export interface OperationsWriteOptions extends OperationsRequestOptions { idempotencyKey: string }
type ClientTrigger<T> = T extends { type?: infer K } ? Omit<T, "event_id" | "occurred_at" | "requested_by_user_id" | "type"> & { type: NonNullable<K> } : never;
export type OperationsCreateDecisionCaseRequest = {
  factory_id: string;
  schema_version: "3.0";
  expected_snapshot_id: string;
  expected_plan_version: number;
  request: {
    mode: RunDecisionCaseRequest["mode"];
    trigger: ClientTrigger<RunDecisionCaseRequest["trigger"]>;
    planning_config: PlanningConfig;
  };
};
type DecisionCommandBasis = {
  schema_version: "3.0";
  decision_case_id: string;
  recommendation_id: string;
  expected_snapshot_id: string;
  expected_plan_version: number;
  expected_case_revision: number;
};
export type OperationsDecisionCommand = DecisionCommandBasis & (
  | { command: "APPROVE"; candidate_plan_id: string; candidate_version: number; note?: string }
  | { command: "REJECT"; note: string }
  | { command: "COMMIT"; candidate_plan_id: string; candidate_version: number }
);
export type OperationsApprovedCandidate = {
  recommendation_id: string;
  candidate_plan_id: string;
  candidate_version: number;
  candidate_hash: string;
  schedule_hash: string;
};
export type OperationsHumanDecision = {
  decision: "APPROVE" | "REJECT";
  recommendation_id: string;
  candidate_plan_id: string | null;
  candidate_version: number | null;
  candidate_hash: string | null;
  schedule_hash: string | null;
  note: string | null;
  actor_id: string;
  decided_at: string;
};
export type OperationsCommitMetadata = {
  decision_case_id: string;
  factory_id: string;
  snapshot_id: string;
  schedule_id: string;
  schedule_revision: number;
  schedule_hash: string;
  plan_version: number;
  actor_id: string;
  committed_at: string;
};
export type OperationsSnapshotResponse = {
  factory_id: string;
  snapshot_id: string;
  schema_version: "3.0";
  captured_at: string;
  plan_version: number;
  current_schedule_id?: string | null;
  snapshot: FactorySnapshot;
};
export type OperationsCurrentScheduleResponse = {
  factory_id: string;
  snapshot_id: string;
  plan_version: number;
  schedule: Schedule | null;
  basis_snapshot: FactorySnapshot | null;
  commit?: OperationsCommitMetadata | null;
};
export type OperationsDecisionCaseProcessing = {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  attempt: number;
  error_code: string | null;
};
export type OperationsDecisionCaseMeta = {
  factory_id: string;
  base_plan_version: number;
  case_revision: number;
  current_context: { snapshot_id: string; plan_version: number } | null;
  stale: boolean;
  processing?: OperationsDecisionCaseProcessing;
  approved_candidate?: OperationsApprovedCandidate | null;
  human_decision?: OperationsHumanDecision | null;
  available_commands?: OperationsDecisionCommand["command"][];
  commit?: OperationsCommitMetadata | null;
};
export type OperationsDecisionCaseReadResponse = {
  caseStatus: DecisionCaseStatusResponse;
  meta?: OperationsDecisionCaseMeta;
};
export type OperationsDecisionCommandResponse = OperationsDecisionCaseReadResponse;
export type OperationsDecisionCaseRecommendationResponse = {
  recommendation: RecommendationPackage;
  snapshot: FactorySnapshot;
};
type SuccessEnvelope<T, TMeta = Record<string, unknown>> = { success: true; data: T; request_id?: string; meta?: TMeta };
type FailureEnvelope = { success: false; error?: { code?: string; message?: string; details?: unknown }; request_id?: string };

export class OperationsApiError extends Error {
  constructor(public readonly status: number, public readonly payload: unknown) {
    super(`Operations API request failed (${status})`);
    this.name = "OperationsApiError";
  }
  get apiError(): FailureEnvelope["error"] | undefined {
    const value = this.payload as FailureEnvelope | null;
    return value && value.success === false && value.error && typeof value.error.code === "string"
      ? value.error : undefined;
  }
  get contractError(): ErrorResponse | undefined {
    const value = this.payload as Partial<ErrorResponse> | null;
    return value && value.schema_version === "3.0" && typeof value.code === "string"
      && typeof value.message === "string" && typeof value.error_id === "string"
      && typeof value.correlation_id === "string" && typeof value.retryable === "boolean"
      ? value as ErrorResponse : undefined;
  }
}

/** Backend HTTP DTO envelopes around generated canonical payloads.
 * Types describe wire payloads, not runtime validation. Backend must validate with v3.
 * Inject fetcher/baseUrl to use a mock server while backend routes are implemented.
 */
export function createOperationsApiClient({
  fetcher = authFetch,
  baseUrl = endpoint("/api/v1"),
}: { fetcher?: typeof fetch; baseUrl?: string } = {}) {
  const base = baseUrl.replace(/\/+$/, "");
  const id = encodeURIComponent;
  async function requestEnvelope<T, TMeta = Record<string, unknown>>(path: string, options: OperationsRequestOptions & Partial<OperationsWriteOptions> = {}, body?: unknown): Promise<SuccessEnvelope<T, TMeta>> {
    if (body !== undefined && (!options.idempotencyKey || !/^[\x21-\x7e]{1,128}$/.test(options.idempotencyKey))) {
      throw new Error("A valid Idempotency-Key is required for operations writes.");
    }
    const response = await fetcher(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include", cache: "no-store", signal: options.signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json", "Idempotency-Key": options.idempotencyKey! }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw new OperationsApiError(response.status, payload);
    }
    const payload: unknown = await response.json();
    const envelope = payload as Partial<SuccessEnvelope<T, TMeta>> | null;
    if (!envelope || envelope.success !== true || !("data" in envelope)) {
      throw new OperationsApiError(response.status, payload);
    }
    return envelope as SuccessEnvelope<T, TMeta>;
  }
  async function request<T>(path: string, options: OperationsRequestOptions = {}, body?: unknown): Promise<T> {
    return (await requestEnvelope<T>(path, options, body)).data;
  }
  async function caseRequest(path: string, options: OperationsRequestOptions, body?: unknown): Promise<OperationsDecisionCaseReadResponse> {
    const envelope = await requestEnvelope<DecisionCaseStatusResponse, OperationsDecisionCaseMeta>(path, options, body);
    return { caseStatus: envelope.data, meta: envelope.meta };
  }
  return {
    getOperationsSnapshot: (factoryId: string, options?: OperationsRequestOptions) => request<OperationsSnapshotResponse>(`/operations/snapshot?factory_id=${id(factoryId)}`, options),
    getCurrentSchedule: (factoryId: string, options?: OperationsRequestOptions) => request<OperationsCurrentScheduleResponse>(`/schedules/current?factory_id=${id(factoryId)}`, options),
    getDecisionCase: async (caseId: string, options?: OperationsRequestOptions): Promise<OperationsDecisionCaseReadResponse> => {
      return caseRequest(`/decision-cases/${id(caseId)}`, options ?? {});
    },
    getDecisionCaseRecommendation: (caseId: string, options?: OperationsRequestOptions) => request<OperationsDecisionCaseRecommendationResponse>(`/decision-cases/${id(caseId)}/recommendation`, options),
    createDecisionCase: (body: OperationsCreateDecisionCaseRequest, options: OperationsWriteOptions) => caseRequest("/decision-cases", options, body),
    submitDecisionCommand: (caseId: string, body: OperationsDecisionCommand, options: OperationsWriteOptions) => caseRequest(`/decision-cases/${id(caseId)}/decision`, options, body),
    listEvents: (caseId: string, afterSequence = 0, options?: OperationsRequestOptions) => request<DecisionEvent[]>(`/decision-cases/${id(caseId)}/events?after_sequence=${afterSequence}`, options),
    eventsUrl: (caseId: string) => `${base}/decision-cases/${id(caseId)}/events`,
  };
}

export type OperationsApiClient = ReturnType<typeof createOperationsApiClient>;
