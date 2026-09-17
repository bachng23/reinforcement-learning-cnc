import { AuthRedirectError, authFetch, endpoint } from "@/lib/auth";
import { record, text } from "@/lib/decision-api/normalize";
import { ProductApiError, isProductApiError, malformedProductApiResponse, productApiErrorFromPayload } from "@/lib/product-api/errors";
import { createHttpProductApiClient } from "@/lib/product-api/client";
import type { DecisionApiClient, DecisionContext, DecisionHistory, DecisionQueueItem, MaintenanceDecision, MaintenanceDecisionAction, ReviewAction, ReviewInput } from "@/types/decision";
import type { ProductApiClient, ProductApiRequestOptions } from "@/types/product-api";

type AuthFetcher = typeof authFetch;
const FINAL_STATUSES: ReadonlySet<string> = new Set(["APPROVED", "REJECTED", "OVERRIDDEN"]);

function dataRecord(payload: unknown, label: string): Record<string, unknown> {
  if (!record(payload) || payload.success !== true || !record(payload.data)) {
    throw malformedProductApiResponse(`Maintenance API returned malformed ${label}.`);
  }
  return payload.data;
}

function dataList(payload: unknown, label: string): { items: unknown[]; totalPages: number } {
  if (!record(payload) || payload.success !== true || !Array.isArray(payload.data)) {
    throw malformedProductApiResponse(`Product API returned malformed ${label}.`);
  }
  const pages = record(payload.meta) ? payload.meta.totalPages : undefined;
  return {
    items: payload.data,
    totalPages: typeof pages === "number" && Number.isInteger(pages) ? Math.max(1, pages) : 1,
  };
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function candidateFrom(value: unknown): DecisionQueueItem {
  if (!record(value) || !record(value.source) || !record(value.risk) || !record(value.resources) ||
    !record(value.predictedCost) || !record(value.costOfDelay) || !record(value.result) ||
    !text(value.id) || !text(value.machineId) || !text(value.recommendedAction) || !text(value.status) ||
    !text(value.source.experimentId) || !text(value.source.episodeId) || !text(value.source.observationId) ||
    !text(value.source.recommendationId) || typeof value.source.attempt !== "number" || typeof value.source.step !== "number" ||
    typeof value.risk.failureProbabilityNextStep !== "number" || typeof value.risk.observedWearUm !== "number" ||
    typeof value.risk.posteriorMedianWearUm !== "number" || typeof value.risk.failureThresholdUm !== "number" ||
    typeof value.resources.sparesAvailable !== "number" || typeof value.resources.inventoryCapacity !== "number" ||
    typeof value.result.outcome !== "string" || typeof value.result.incurredCost !== "number") {
    throw malformedProductApiResponse("Maintenance API returned a malformed queue candidate.");
  }
  if (!["PENDING_REVIEW", "APPROVED", "REJECTED", "OVERRIDDEN"].includes(String(value.status)) ||
    !["REPLACE_NOW", "SCHEDULE_REPLACEMENT", "DEFER"].includes(String(value.recommendedAction)) ||
    !["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(String(value.severity)) ||
    !record(value.risk.condition) || !["LIGHT", "NOMINAL", "HEAVY"].includes(String(value.risk.condition.loadClass))) {
    throw malformedProductApiResponse("Maintenance API returned an invalid queue candidate.");
  }
  return {
    rowId: value.id as string,
    recommendationId: value.source.recommendationId as string,
    ...(text(value.decisionId) ? { decisionId: text(value.decisionId) } : {}),
    experimentId: value.source.experimentId as string,
    episodeId: value.source.episodeId as string,
    observationId: value.source.observationId as string,
    attempt: value.source.attempt as number,
    step: value.source.step as number,
    machineId: value.machineId as string,
    ...(text(value.toolId) ? { toolId: text(value.toolId) } : {}),
    ...(text(value.jobId) ? { jobId: text(value.jobId) } : {}),
    recommendedAction: value.recommendedAction as DecisionQueueItem["recommendedAction"],
    severity: value.severity as DecisionQueueItem["severity"],
    failureRisk: value.risk.failureProbabilityNextStep as number,
    predictedRulSteps: numberValue(value.risk.predictedRulSteps),
    observedWearUm: value.risk.observedWearUm as number,
    posteriorMedianWearUm: value.risk.posteriorMedianWearUm as number,
    failureThresholdUm: value.risk.failureThresholdUm as number,
    loadClass: value.risk.condition.loadClass as DecisionQueueItem["loadClass"],
    sparesAvailable: value.resources.sparesAvailable as number,
    inventoryCapacity: value.resources.inventoryCapacity as number,
    predictedExpectedCost: numberValue(value.predictedCost.expected),
    predictedCvarCost: numberValue(value.predictedCost.cvar),
    costOfDelay: numberValue(value.costOfDelay.amount),
    rationale: text(value.rationale) ?? "Not provided",
    result: { outcome: value.result.outcome, incurredCost: value.result.incurredCost as number },
    status: value.status as DecisionQueueItem["status"],
    ...(text(value.createdAt) ? { createdAt: text(value.createdAt) } : {}),
  };
}

function decisionFrom(value: unknown): MaintenanceDecision {
  if (!record(value) || !text(value.id) || !text(value.recommendationId) ||
    !["PENDING_REVIEW", "APPROVED", "REJECTED", "OVERRIDDEN"].includes(String(value.status))) {
    throw malformedProductApiResponse("Maintenance API returned a malformed decision.");
  }
  return {
    id: value.id as string,
    recommendationId: value.recommendationId as string,
    status: value.status as MaintenanceDecision["status"],
    ...(text(value.createdAt) ? { createdAt: text(value.createdAt) } : {}),
  };
}

function actionFrom(value: unknown): MaintenanceDecisionAction {
  if (!record(value) || !text(value.id) || !text(value.decisionId) ||
    !text(value.actorUserId) || !FINAL_STATUSES.has(String(value.toStatus)) ||
    !record(value.recommendationSnapshot) || !record(value.riskSnapshot) ||
    !text(value.createdAt)) {
    throw malformedProductApiResponse("Maintenance API returned a malformed review action.");
  }
  return {
    id: value.id as string,
    decisionId: value.decisionId as string,
    actorUserId: value.actorUserId as string,
    fromStatus: "PENDING_REVIEW",
    toStatus: value.toStatus as MaintenanceDecisionAction["toStatus"],
    reason: text(value.reason) ?? null,
    selectedAction: record(value.selectedAction) ? value.selectedAction as unknown as MaintenanceDecisionAction["selectedAction"] : null,
    recommendationSnapshot: value.recommendationSnapshot,
    riskSnapshot: value.riskSnapshot,
    createdAt: value.createdAt as string,
  };
}

export class HttpDecisionApiClient implements DecisionApiClient {
  constructor(
    private readonly fetcher: AuthFetcher = authFetch,
    private readonly productApi: ProductApiClient = createHttpProductApiClient(fetcher),
  ) {}

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(endpoint(path), {
        cache: "no-store",
        ...init,
        headers: { Accept: "application/json", ...init.headers },
      });
    } catch (error) {
      if (error instanceof AuthRedirectError ||
        (error instanceof Error && error.name === "AbortError") ||
        isProductApiError(error)) throw error;
      throw new ProductApiError("Unable to reach the Product API.", {
        status: 0,
        code: "NETWORK_ERROR",
        cause: error,
      });
    }
    const raw = await response.text();
    let payload: unknown;
    try {
      payload = raw ? JSON.parse(raw) as unknown : undefined;
    } catch {
      if (response.ok) throw malformedProductApiResponse("API returned a non-JSON success response.");
      payload = { message: raw };
    }
    if (!response.ok) throw productApiErrorFromPayload(payload, response.status, response.statusText);
    if (payload === undefined) throw malformedProductApiResponse("API returned an empty success response.");
    return payload;
  }

  private async allEvents(path: string, options: ProductApiRequestOptions): Promise<unknown[]> {
    const events: unknown[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const separator = path.includes("?") ? "&" : "?";
      const payload = await this.request(`${path}${separator}page=${page}&limit=100`, {
        method: "GET",
        signal: options.signal,
      });
      const batch = dataList(payload, "event list");
      events.push(...batch.items);
      totalPages = batch.totalPages;
      page += 1;
    }
    return events;
  }

  async listQueue(options: ProductApiRequestOptions = {}): Promise<DecisionQueueItem[]> {
    const items: DecisionQueueItem[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const payload = await this.request(`/api/v1/maintenance/decisions?page=${page}&limit=100`, {
        method: "GET",
        signal: options.signal,
      });
      const batch = dataList(payload, "decision queue");
      items.push(...batch.items.map(candidateFrom));
      totalPages = batch.totalPages;
      page += 1;
    } while (page <= totalPages);
    return items;
  }

  async getContext(item: DecisionQueueItem, options: ProductApiRequestOptions = {}): Promise<DecisionContext> {
    const [experiment, observations, recommendations] = await Promise.all([
      this.productApi.getExperiment(item.experimentId, options),
      this.allEvents(`/api/v1/episodes/${encodeURIComponent(item.episodeId)}/observations?attempt=${item.attempt}`, options),
      this.allEvents(`/api/v1/episodes/${encodeURIComponent(item.episodeId)}/recommendations?attempt=${item.attempt}`, options),
    ]);
    const observation = observations.find((event) => record(event) && event.id === item.observationId);
    const recommendation = recommendations.find((event) => record(event) && event.id === item.recommendationId);
    if (!record(observation) || !record(observation.payload) || !text(observation.observationKey) ||
      !record(recommendation) || !record(recommendation.payload)) {
      throw malformedProductApiResponse("Maintenance API could not load the selected decision context.");
    }
    return {
      experimentName: experiment.name,
      observationKey: text(observation.observationKey)!,
      observation: observation.payload as unknown as DecisionContext["observation"],
      recommendation: recommendation.payload as unknown as DecisionContext["recommendation"],
      environmentConfig: experiment.environment_config,
    };
  }

  async openReview(recommendationId: string, options: ProductApiRequestOptions = {}): Promise<MaintenanceDecision> {
    const payload = await this.request("/api/v1/maintenance/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recommendationId }),
      signal: options.signal,
    });
    const decision = decisionFrom(dataRecord(payload, "decision response"));
    return decision;
  }

  async getHistory(decisionId: string, options: ProductApiRequestOptions = {}): Promise<DecisionHistory> {
    const payload = await this.request(
      `/api/v1/maintenance/decisions/${encodeURIComponent(decisionId)}/history`,
      { method: "GET", signal: options.signal },
    );
    const value = dataRecord(payload, "decision history");
    const decision = decisionFrom(value);
    if (!Array.isArray(value.actions)) {
      throw malformedProductApiResponse("Maintenance API returned malformed action history.");
    }
    return {
      ...decision,
      actions: value.actions.map(actionFrom),
    };
  }

  async submitReview(
    decisionId: string,
    action: ReviewAction,
    input: ReviewInput,
    options: ProductApiRequestOptions = {},
  ): Promise<MaintenanceDecisionAction> {
    const payload = await this.request(
      `/api/v1/maintenance/decisions/${encodeURIComponent(decisionId)}/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: options.signal,
      },
    );
    const result = dataRecord(payload, "review response");
    if (!record(result.action) || !text(result.id) || !FINAL_STATUSES.has(String(result.status))) {
      throw malformedProductApiResponse("Maintenance API returned malformed review response.");
    }
    const review = actionFrom(result.action);
    return review;
  }
}
