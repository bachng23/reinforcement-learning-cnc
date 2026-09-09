import { createHttpProductApiClient } from "@/lib/product-api/client";
import { createMockProductApiClient } from "@/lib/product-api/mock-client";
import type { ProductApiClient } from "@/types/product-api";

export type ProductApiMode = "mock" | "real";

let client: ProductApiClient | undefined;
let activeMode: ProductApiMode | undefined;

export function getProductApiMode(): ProductApiMode {
  const configured = process.env.NEXT_PUBLIC_PRODUCT_API_MODE?.trim().toLowerCase();
  if (!configured || configured === "real") return "real";
  if (configured === "mock") return "mock";
  throw new Error(
    `Unsupported NEXT_PUBLIC_PRODUCT_API_MODE "${configured}". Use "mock" or "real".`,
  );
}

/** Returns one stable client instance for the configured frontend API mode. */
export function getProductApiClient(): ProductApiClient {
  const mode = getProductApiMode();
  if (!client || activeMode !== mode) {
    client = mode === "real"
      ? createHttpProductApiClient()
      : createMockProductApiClient();
    activeMode = mode;
  }
  return client;
}

/** Test helper; production callers should use getProductApiClient(). */
export function resetProductApiClient(): void {
  client = undefined;
  activeMode = undefined;
}

export { HttpProductApiClient, createHttpProductApiClient } from "@/lib/product-api/client";
export {
  ProductApiError,
  isProductApiError,
  malformedProductApiResponse,
  productApiErrorMessage,
  productApiErrorFromPayload,
} from "@/lib/product-api/errors";
export {
  MOCK_COMPLETED_STEPS,
  MOCK_ENVIRONMENT_CONFIG,
  MOCK_EPISODE_DETAILS,
  MOCK_EXPERIMENT_DETAILS,
  MOCK_POLICY_CATALOG,
} from "@/lib/product-api/fixtures";
export {
  MockProductApiClient,
  createMockProductApiClient,
} from "@/lib/product-api/mock-client";

export type {
  ApiErrorDetail,
  CreateExperimentRequest,
  EpisodeCounts,
  EpisodeDetail,
  EpisodeFailureInformation,
  EpisodeListItem,
  EpisodeMutationResult,
  EpisodeStatus,
  EpisodeStepRecord,
  ExperimentDetail,
  ExperimentListItem,
  ExperimentOwner,
  ExperimentStatus,
  FieldErrors,
  GetEpisodeOptions,
  ListExperimentsParams,
  PaginatedResponse,
  PaginationMetadata,
  PolicyCatalogItem,
  PolicyReference,
  ProductApiClient,
  ProductApiRequestOptions,
} from "@/types/product-api";
