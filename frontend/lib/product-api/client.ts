import { AuthRedirectError, authFetch, endpoint } from "@/lib/auth";
import {
  ProductApiError,
  isProductApiError,
  malformedProductApiResponse,
  productApiErrorFromPayload,
} from "@/lib/product-api/errors";
import {
  normalizeEpisodeDetail,
  normalizeEpisodeListItem,
  normalizeExperimentDetail,
  normalizeExperimentPage,
  normalizePolicyCatalog,
} from "@/lib/product-api/normalize";
import type {
  CreateExperimentRequest,
  EpisodeDetail,
  EpisodeMutationResult,
  EpisodeStatus,
  ExperimentDetail,
  ExperimentListItem,
  GetEpisodeOptions,
  ListExperimentsParams,
  PaginatedResponse,
  PolicyCatalogItem,
  ProductApiClient,
  ProductApiRequestOptions,
} from "@/types/product-api";

type AuthFetcher = typeof authFetch;
type UnknownRecord = Record<string, unknown>;

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const EPISODE_STATUSES: ReadonlySet<EpisodeStatus> = new Set([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function responseData(payload: unknown, label: string): unknown {
  if (!isRecord(payload) || payload.success !== true || payload.data === undefined) {
    throw malformedProductApiResponse(`Product API returned malformed ${label}.`);
  }
  return payload.data;
}

function responseRecord(payload: unknown, label: string): UnknownRecord {
  const data = responseData(payload, label);
  if (!isRecord(data)) {
    throw malformedProductApiResponse(`Product API returned malformed ${label}.`);
  }
  return data;
}

function responseList(payload: unknown, label: string): unknown[] {
  const data = responseData(payload, label);
  if (!Array.isArray(data)) {
    throw malformedProductApiResponse(`Product API returned malformed ${label}.`);
  }
  return data;
}

function episodeMutationResult(
  payload: unknown,
  label: string,
): EpisodeMutationResult {
  const data = responseRecord(payload, label);
  if (
    typeof data.id !== "string" ||
    !data.id ||
    typeof data.attempt !== "number" ||
    !Number.isInteger(data.attempt) ||
    data.attempt < 1 ||
    typeof data.status !== "string" ||
    !EPISODE_STATUSES.has(data.status as EpisodeStatus)
  ) {
    throw malformedProductApiResponse(`Product API returned malformed ${label}.`);
  }
  return {
    id: data.id,
    attempt: data.attempt,
    status: data.status as EpisodeStatus,
  };
}

function responseTotalPages(payload: unknown): number {
  if (!isRecord(payload) || !isRecord(payload.meta)) return 1;
  const totalPages = payload.meta.totalPages;
  return typeof totalPages === "number" && Number.isInteger(totalPages) && totalPages > 0
    ? totalPages
    : 1;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (!response.ok) return { message: text };
    throw malformedProductApiResponse(
      "Product API returned a non-JSON success response.",
      error,
    );
  }
}

export class HttpProductApiClient implements ProductApiClient {
  constructor(private readonly fetcher: AuthFetcher = authFetch) {}

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      if (!headers.has("Accept")) headers.set("Accept", "application/json");
      response = await this.fetcher(endpoint(path), {
        cache: "no-store",
        ...init,
        headers,
      });
    } catch (error) {
      if (error instanceof AuthRedirectError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (error instanceof ProductApiError) throw error;
      throw new ProductApiError("Unable to reach the Product API.", {
        status: 0,
        code: "NETWORK_ERROR",
        cause: error,
      });
    }

    const payload = await readPayload(response);
    if (!response.ok) {
      throw productApiErrorFromPayload(payload, response.status, response.statusText);
    }
    if (payload === undefined) {
      throw malformedProductApiResponse("Product API returned an empty success response.");
    }
    return payload;
  }

  private async requestAll(
    path: string,
    options: ProductApiRequestOptions,
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const separator = path.includes("?") ? "&" : "?";
      const payload = await this.request(
        `${path}${separator}page=${page}&limit=${MAX_PAGE_SIZE}`,
        { method: "GET", signal: options.signal },
      );
      items.push(...responseList(payload, "paginated response"));
      totalPages = responseTotalPages(payload);
      page += 1;
    } while (page <= totalPages);
    return items;
  }

  async listPolicies(
    options: ProductApiRequestOptions = {},
  ): Promise<PolicyCatalogItem[]> {
    const payload = await this.request("/api/v1/policies", {
      method: "GET",
      signal: options.signal,
    });
    return normalizePolicyCatalog(payload);
  }

  async listExperiments(
    params: ListExperimentsParams = {},
    options: ProductApiRequestOptions = {},
  ): Promise<PaginatedResponse<ExperimentListItem>> {
    const page = positiveInteger(params.page, DEFAULT_PAGE);
    const pageSize = positiveInteger(params.pageSize, DEFAULT_PAGE_SIZE);
    const query = new URLSearchParams({
      page: String(page),
      limit: String(pageSize),
    });
    const payload = await this.request(`/api/v1/experiments?${query.toString()}`, {
      method: "GET",
      signal: options.signal,
    });
    return normalizeExperimentPage(payload, { page, pageSize });
  }

  async createExperiment(
    payload: CreateExperimentRequest,
    options: ProductApiRequestOptions = {},
  ): Promise<ExperimentDetail> {
    const response = await this.request("/api/v1/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options.signal,
    });
    return normalizeExperimentDetail(response);
  }

  async runExperiment(
    id: string,
    idempotencyKey: string,
    options: ProductApiRequestOptions = {},
  ): Promise<void> {
    await this.request(`/api/v1/experiments/${encodeURIComponent(id)}/run`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      signal: options.signal,
    });
  }

  async getExperiment(
    id: string,
    options: ProductApiRequestOptions = {},
  ): Promise<ExperimentDetail> {
    const encodedId = encodeURIComponent(id);
    const [experimentPayload, episodes] = await Promise.all([
      this.request(`/api/v1/experiments/${encodedId}`, {
        method: "GET",
        signal: options.signal,
      }),
      this.requestAll(`/api/v1/experiments/${encodedId}/episodes`, options),
    ]);
    const experiment = responseRecord(experimentPayload, "experiment response");
    return normalizeExperimentDetail({
      success: true,
      data: { ...experiment, episodes },
    });
  }

  async getEpisode(
    id: string,
    options: GetEpisodeOptions = {},
  ): Promise<EpisodeDetail> {
    const encodedId = encodeURIComponent(id);
    const episodePayload = await this.request(`/api/v1/episodes/${encodedId}`, {
      method: "GET",
      signal: options.signal,
    });
    const episodeRecord = responseRecord(episodePayload, "episode response");
    const episode = normalizeEpisodeListItem(episodeRecord);
    const experimentPayload = await this.request(
      `/api/v1/experiments/${encodeURIComponent(episode.experiment_id)}`,
      { method: "GET", signal: options.signal },
    );
    const experiment = responseRecord(experimentPayload, "experiment response");
    const environmentConfig = experiment.environmentConfig;
    if (!isRecord(environmentConfig)) {
      throw malformedProductApiResponse(
        "Product API experiment response is missing environmentConfig.",
      );
    }

    const currentAttempt = episode.attempt;
    if (!currentAttempt) {
      throw malformedProductApiResponse("Product API episode response is missing attempt.");
    }
    const attempt = options.attempt ?? currentAttempt;
    const attemptQuery = `?attempt=${attempt}`;
    const summaryRequest = this.request(
      `/api/v1/episodes/${encodedId}/summary${attemptQuery}`,
      { method: "GET", signal: options.signal },
    ).then((payload) => responseRecord(payload, "episode summary response").payload)
      .catch((error: unknown) => {
        if (
          isProductApiError(error) &&
          error.status === 409 &&
          error.code === "SUMMARY_NOT_AVAILABLE"
        ) {
          return null;
        }
        throw error;
      });
    const [observations, recommendations, results, summary] = await Promise.all([
      this.requestAll(`/api/v1/episodes/${encodedId}/observations${attemptQuery}`, options),
      this.requestAll(`/api/v1/episodes/${encodedId}/recommendations${attemptQuery}`, options),
      this.requestAll(`/api/v1/episodes/${encodedId}/results${attemptQuery}`, options),
      summaryRequest,
    ]);
    const byStep = new Map<number, UnknownRecord>();
    const mergeRecords = (records: unknown[], key: "observation" | "recommendation" | "result") => {
      for (const value of records) {
        if (!isRecord(value) || typeof value.step !== "number" || !isRecord(value.payload)) {
          throw malformedProductApiResponse("Product API returned a malformed episode event.");
        }
        const current = byStep.get(value.step) ?? { step: value.step };
        current[key] = value.payload;
        if (typeof value.createdAt === "string" && current.persisted_at === undefined) {
          current.persisted_at = value.createdAt;
        }
        if (key === "result" && typeof value.totalCost === "number") {
          current.cumulative_cost = value.totalCost;
        }
        byStep.set(value.step, current);
      }
    };
    mergeRecords(observations, "observation");
    mergeRecords(recommendations, "recommendation");
    mergeRecords(results, "result");
    const steps = [...byStep.values()].sort(
      (left, right) => Number(left.step) - Number(right.step),
    );

    return normalizeEpisodeDetail({
      success: true,
      data: {
        ...episodeRecord,
        environmentConfig,
        summary,
        steps,
      },
    });
  }

  async retryEpisode(
    id: string,
    options: ProductApiRequestOptions = {},
  ): Promise<EpisodeMutationResult> {
    const payload = await this.request(
      `/api/v1/episodes/${encodeURIComponent(id)}/retry`,
      { method: "POST", signal: options.signal },
    );
    return episodeMutationResult(payload, "episode retry response");
  }

  async cancelEpisode(
    id: string,
    options: ProductApiRequestOptions = {},
  ): Promise<EpisodeMutationResult> {
    const payload = await this.request(
      `/api/v1/episodes/${encodeURIComponent(id)}/cancel`,
      { method: "POST", signal: options.signal },
    );
    return episodeMutationResult(payload, "episode cancellation response");
  }
}

export function createHttpProductApiClient(
  fetcher: AuthFetcher = authFetch,
): ProductApiClient {
  return new HttpProductApiClient(fetcher);
}
