import { AuthRedirectError, authFetch, endpoint } from "@/lib/auth";
import { rowsFromEvents, record, sortDecisionQueue, text } from "@/lib/decision-api/normalize";
import { ProductApiError, isProductApiError, malformedProductApiResponse, productApiErrorFromPayload } from "@/lib/product-api/errors";
import { createHttpProductApiClient } from "@/lib/product-api/client";
import type { DecisionApiClient, DecisionHistory, DecisionQueueItem, DecisionStatus, MaintenanceDecision, MaintenanceDecisionAction, ReviewAction, ReviewInput } from "@/types/decision";
import type { ProductApiClient, ProductApiRequestOptions } from "@/types/product-api";

type AuthFetcher = typeof authFetch;
const STORAGE_KEY = "cnc-decision-review-ids-v1";
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

async function batches<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(...await Promise.all(items.slice(index, index + size).map(worker)));
  }
  return output;
}

/** Read-only queue composition until the backend exposes a list-decisions endpoint. */
export class HttpDecisionApiClient implements DecisionApiClient {
  private readonly known = new Map<string, { decisionId: string; status: DecisionStatus }>();

  constructor(
    private readonly fetcher: AuthFetcher = authFetch,
    private readonly productApi: ProductApiClient = createHttpProductApiClient(fetcher),
  ) {
    if (typeof window !== "undefined") {
      try {
        const saved: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "{}");
        if (record(saved)) {
          for (const [recommendationId, decisionId] of Object.entries(saved)) {
            if (text(recommendationId) && text(decisionId)) {
              this.known.set(recommendationId, { decisionId: text(decisionId)!, status: "PENDING_REVIEW" });
            }
          }
        }
      } catch { /* Storage may be unavailable; the API remains usable. */ }
    }
  }

  private remember(decision: MaintenanceDecision): void {
    this.known.set(decision.recommendationId, {
      decisionId: decision.id,
      status: decision.status,
    });
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Object.fromEntries(
          [...this.known].map(([recommendationId, value]) => [recommendationId, value.decisionId]),
        )),
      );
    } catch { /* Browsers can disable session storage. */ }
  }

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
    // Only previously opened IDs can be recovered. The backend has no read-only list endpoint.
    await batches([...this.known.values()], 4, async ({ decisionId }) => {
      try {
        await this.getHistory(decisionId, options);
      } catch (error) {
        if (!isProductApiError(error) || error.status !== 404) throw error;
      }
    });

    const experiments = [];
    let page = 1;
    let totalPages = 1;
    do {
      const response = await this.productApi.listExperiments({ page, pageSize: 100 }, options);
      experiments.push(...response.items);
      totalPages = response.total_pages;
      page += 1;
    } while (page <= totalPages);

    const details = await batches(experiments, 4, (experiment) =>
      this.productApi.getExperiment(experiment.id, options));
    const groups = await batches(details.flatMap((experiment) =>
      experiment.episodes.map((episode) => ({ experiment, episode }))), 4, async ({ experiment, episode }) => {
      const attempt = episode.attempt ?? 1;
      const base = `/api/v1/episodes/${encodeURIComponent(episode.id)}`;
      const [observations, recommendations] = await Promise.all([
        this.allEvents(`${base}/observations?attempt=${attempt}`, options),
        this.allEvents(`${base}/recommendations?attempt=${attempt}`, options),
      ]);
      return rowsFromEvents({
        experimentId: experiment.id,
        experimentName: experiment.name,
        episodeId: episode.id,
        attempt,
        environmentConfig: experiment.environment_config,
        observations,
        recommendations,
        knownStatuses: this.known,
      });
    });
    return sortDecisionQueue(groups.flat());
  }

  async openReview(recommendationId: string, options: ProductApiRequestOptions = {}): Promise<MaintenanceDecision> {
    const payload = await this.request("/api/v1/maintenance/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recommendationId }),
      signal: options.signal,
    });
    const decision = decisionFrom(dataRecord(payload, "decision response"));
    this.remember(decision);
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
    this.remember(decision);
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
    for (const [recommendationId, known] of this.known) {
      if (known.decisionId === decisionId) {
        this.known.set(recommendationId, { ...known, status: result.status as DecisionStatus });
      }
    }
    return review;
  }
}
