import { AuthRedirectError, authFetch, endpoint } from "@/lib/auth";
import {
  ProductApiError,
  malformedProductApiResponse,
  productApiErrorFromPayload,
} from "@/lib/product-api/errors";
import {
  normalizeEpisodeDetail,
  normalizeExperimentDetail,
  normalizeExperimentPage,
  normalizePolicyCatalog,
} from "@/lib/product-api/normalize";
import type {
  CreateExperimentRequest,
  EpisodeDetail,
  ExperimentDetail,
  ExperimentListItem,
  ListExperimentsParams,
  PaginatedResponse,
  PolicyCatalogItem,
  ProductApiClient,
  ProductApiRequestOptions,
} from "@/types/product-api";

type AuthFetcher = typeof authFetch;

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
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

/** Real REST client for the Product API. Components should depend on the interface. */
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
      page_size: String(pageSize),
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

  async getExperiment(
    id: string,
    options: ProductApiRequestOptions = {},
  ): Promise<ExperimentDetail> {
    const payload = await this.request(
      `/api/v1/experiments/${encodeURIComponent(id)}`,
      { method: "GET", signal: options.signal },
    );
    return normalizeExperimentDetail(payload);
  }

  async getEpisode(
    id: string,
    options: ProductApiRequestOptions = {},
  ): Promise<EpisodeDetail> {
    const payload = await this.request(`/api/v1/episodes/${encodeURIComponent(id)}`, {
      method: "GET",
      signal: options.signal,
    });
    return normalizeEpisodeDetail(payload);
  }
}

export function createHttpProductApiClient(
  fetcher: AuthFetcher = authFetch,
): ProductApiClient {
  return new HttpProductApiClient(fetcher);
}
