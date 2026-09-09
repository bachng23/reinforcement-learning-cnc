import { ProductApiError } from "@/lib/product-api/errors";
import {
  MOCK_EPISODE_DETAILS,
  MOCK_EXPERIMENT_DETAILS,
  MOCK_POLICY_CATALOG,
  createPendingEpisodeFixture,
} from "@/lib/product-api/fixtures";
import type { EnvironmentConfig } from "@/types/cnc";
import type {
  ApiErrorDetail,
  CreateExperimentRequest,
  EpisodeDetail,
  EpisodeListItem,
  EpisodeMutationResult,
  ExperimentDetail,
  ExperimentListItem,
  FieldErrors,
  GetEpisodeOptions,
  ListExperimentsParams,
  PaginatedResponse,
  PolicyCatalogItem,
  PolicyReference,
  ProductApiClient,
  ProductApiRequestOptions,
} from "@/types/product-api";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

export interface MockProductApiClientOptions {
  latencyMs?: number;
  /** Advance unfinished episode states when experiment detail is polled. */
  simulatePolling?: boolean;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

async function waitForMockLatency(
  latencyMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError();
  if (latencyMs <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, latencyMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    setTimeout(() => signal?.removeEventListener("abort", onAbort), latencyMs);
  });
}

function asEpisodeListItem(detail: EpisodeDetail): EpisodeListItem {
  const {
    environment_config: _environmentConfig,
    summary: _summary,
    steps: _steps,
    ...item
  } = detail;
  return item;
}

function countsFor(episodes: EpisodeDetail[]) {
  return {
    total: episodes.length,
    pending: episodes.filter((episode) => episode.status === "PENDING").length,
    running: episodes.filter((episode) => episode.status === "RUNNING").length,
    completed: episodes.filter((episode) => episode.status === "COMPLETED").length,
    failed: episodes.filter((episode) => episode.status === "FAILED").length,
    cancelled: episodes.filter((episode) => episode.status === "CANCELLED").length,
  };
}

function experimentStatusFor(
  episodes: EpisodeDetail[],
  currentStatus: ExperimentDetail["status"],
): ExperimentDetail["status"] {
  if (episodes.some((episode) => episode.status === "RUNNING")) return "RUNNING";
  if (episodes.some((episode) => episode.status === "PENDING")) return "RUNNING";
  if (episodes.some((episode) => episode.status === "FAILED")) return "FAILED";
  if (episodes.length > 0 && episodes.every((episode) => episode.status === "CANCELLED")) {
    return "CANCELLED";
  }
  if (episodes.length > 0) return "COMPLETED";
  return currentStatus === "READY" ? "READY" : "DRAFT";
}

function policyReference(policy: PolicyCatalogItem): PolicyReference {
  return {
    id: policy.id,
    name: policy.name,
    version: policy.version,
    ...(policy.key ? { key: policy.key } : {}),
  };
}

function validationError(
  message: string,
  fieldErrors: FieldErrors,
  details: ApiErrorDetail[],
): ProductApiError {
  return new ProductApiError(message, {
    status: 422,
    statusText: "Unprocessable Entity",
    code: "VALIDATION_ERROR",
    fieldErrors,
    details,
  });
}

function validateCreatePayload(payload: CreateExperimentRequest): void {
  const fieldErrors: FieldErrors = {};
  const details: ApiErrorDetail[] = [];
  const add = (field: string, message: string) => {
    fieldErrors[field] = [...(fieldErrors[field] ?? []), message];
    details.push({ field, path: [field], code: "invalid", message });
  };

  if (!payload.name.trim()) add("name", "Experiment name is required.");
  if (!payload.policyKey.trim()) add("policyKey", "A policy is required.");
  if (!Number.isInteger(payload.episodeCount) || payload.episodeCount < 1) {
    add("episodeCount", "Number of episodes must be a positive integer.");
  }
  if (!Number.isInteger(payload.environmentConfig.number_of_machines) || payload.environmentConfig.number_of_machines < 1) {
    add("environmentConfig.number_of_machines", "Number of machines must be at least 1.");
  }
  if (!Number.isInteger(payload.environmentConfig.horizon_steps) || payload.environmentConfig.horizon_steps < 1) {
    add("environmentConfig.horizon_steps", "Simulation horizon must be at least 1 step.");
  }
  if (!Number.isInteger(payload.environmentConfig.seed) || payload.environmentConfig.seed < 0) {
    add("environmentConfig.seed", "Seed must be a non-negative integer.");
  }
  if (!(payload.environmentConfig.failure_threshold_um > 0)) {
    add("environmentConfig.failure_threshold_um", "Failure threshold must be greater than 0.");
  }
  if (details.length) {
    throw validationError("Please correct the highlighted fields.", fieldErrors, details);
  }
}

/** In-memory Product API implementation backed exclusively by fixture data. */
export class MockProductApiClient implements ProductApiClient {
  private readonly policies = clone(MOCK_POLICY_CATALOG);
  private readonly experiments = new Map<string, ExperimentDetail>();
  private readonly episodes = new Map<string, EpisodeDetail>();
  private readonly pollCounts = new Map<string, number>();
  private readonly runKeys = new Map<string, string>();
  private readonly attemptHistory = new Map<string, Map<number, EpisodeDetail>>();
  private readonly latencyMs: number;
  private readonly simulatePolling: boolean;
  private sequence = 100;

  constructor(options: MockProductApiClientOptions = {}) {
    this.latencyMs = options.latencyMs ?? 120;
    this.simulatePolling = options.simulatePolling ?? true;

    for (const episode of clone(MOCK_EPISODE_DETAILS)) {
      this.episodes.set(episode.id, episode);
    }
    for (const experiment of clone(MOCK_EXPERIMENT_DETAILS)) {
      this.experiments.set(experiment.id, experiment);
      this.refreshExperiment(experiment.id);
    }
  }

  private async wait(options: ProductApiRequestOptions): Promise<void> {
    await waitForMockLatency(this.latencyMs, options.signal);
  }

  private episodesForExperiment(experimentId: string): EpisodeDetail[] {
    return [...this.episodes.values()]
      .filter((episode) => episode.experiment_id === experimentId)
      .sort((a, b) => a.seed - b.seed);
  }

  private refreshExperiment(experimentId: string): ExperimentDetail {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new ProductApiError("Experiment not found.", {
        status: 404,
        statusText: "Not Found",
        code: "EXPERIMENT_NOT_FOUND",
      });
    }
    const episodes = this.episodesForExperiment(experimentId);
    experiment.episodes = episodes.map(asEpisodeListItem);
    experiment.number_of_episodes ??= episodes.length;
    experiment.episode_counts = countsFor(episodes);
    experiment.status = experimentStatusFor(episodes, experiment.status);
    return experiment;
  }

  private markRunning(episode: EpisodeDetail, timestamp: string): void {
    episode.status = "RUNNING";
    episode.started_at = episode.started_at ?? timestamp;
    episode.updated_at = timestamp;
  }

  private markCompleted(episode: EpisodeDetail, timestamp: string): void {
    episode.status = "COMPLETED";
    episode.completed_at = timestamp;
    episode.updated_at = timestamp;
    // Lifecycle progression is mock-service behavior. Research outputs remain
    // exactly as fixture data supplied them; a missing summary/cost stays
    // missing so components exercise the partially-persisted state.
  }

  private advancePolling(experimentId: string): void {
    if (!this.simulatePolling) return;
    const episodes = this.episodesForExperiment(experimentId);
    if (!episodes.some((episode) => episode.status === "PENDING" || episode.status === "RUNNING")) {
      return;
    }

    const pollCount = (this.pollCounts.get(experimentId) ?? 0) + 1;
    this.pollCounts.set(experimentId, pollCount);
    const timestamp = new Date(Date.parse("2026-09-01T08:00:00.000Z") + pollCount * 1_000).toISOString();

    // The first response exposes the initial fixture state. Later responses
    // complete one running episode and start one pending episode per poll.
    if (pollCount === 1) return;
    const running = episodes.find((episode) => episode.status === "RUNNING");
    if (running) this.markCompleted(running, timestamp);
    const pending = episodes.find((episode) => episode.status === "PENDING");
    if (pending) this.markRunning(pending, timestamp);
    this.refreshExperiment(experimentId).updated_at = timestamp;
  }

  async listPolicies(
    options: ProductApiRequestOptions = {},
  ): Promise<PolicyCatalogItem[]> {
    await this.wait(options);
    return clone(this.policies);
  }

  async listExperiments(
    params: ListExperimentsParams = {},
    options: ProductApiRequestOptions = {},
  ): Promise<PaginatedResponse<ExperimentListItem>> {
    await this.wait(options);
    const page = Number.isInteger(params.page) && (params.page ?? 0) > 0
      ? (params.page as number)
      : DEFAULT_PAGE;
    const pageSize = Number.isInteger(params.pageSize) && (params.pageSize ?? 0) > 0
      ? (params.pageSize as number)
      : DEFAULT_PAGE_SIZE;
    const all = [...this.experiments.values()]
      .map((experiment) => this.refreshExperiment(experiment.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize).map((detail) => {
      const { environment_config: _config, episodes: _episodes, ...item } = detail;
      return item;
    });
    const totalPages = Math.max(1, Math.ceil(all.length / pageSize));

    return clone({
      items,
      page,
      page_size: pageSize,
      total_items: all.length,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_previous: page > 1,
    });
  }

  async createExperiment(
    payload: CreateExperimentRequest,
    options: ProductApiRequestOptions = {},
  ): Promise<ExperimentDetail> {
    await this.wait(options);
    validateCreatePayload(payload);
    const selectedPolicy = this.policies.find((policy) => (
      (policy.key ?? policy.id) === payload.policyKey
      && policy.version === payload.policyVersion
    ));
    if (!selectedPolicy) {
      throw validationError(
        "The selected policy is not available.",
        { policy_id: ["Select a policy from the current catalog."] },
        [{
          field: "policy_id",
          path: ["policy_id"],
          code: "not_found",
          message: "Select a policy from the current catalog.",
        }],
      );
    }
    this.sequence += 1;
    const id = `mock-experiment-${this.sequence}`;
    const createdAt = new Date().toISOString();
    const policy = policyReference(selectedPolicy);
    const environmentConfig: EnvironmentConfig = clone(payload.environmentConfig);
    const experiment: ExperimentDetail = {
      id,
      key: id,
      name: payload.name.trim(),
      ...(payload.description?.trim() ? { description: payload.description.trim() } : {}),
      status: "READY",
      policy,
      environment_config: environmentConfig,
      created_at: createdAt,
      updated_at: createdAt,
      owner: {
        username: "mock.engineer",
        display_name: "Mock Engineer",
      },
      number_of_episodes: payload.episodeCount,
      episode_counts: { total: 0, pending: 0 },
      episodes: [],
    };
    this.experiments.set(id, experiment);
    return clone(this.refreshExperiment(id));
  }

  async runExperiment(
    id: string,
    idempotencyKey: string,
    options: ProductApiRequestOptions = {},
  ): Promise<void> {
    await this.wait(options);
    const experiment = this.experiments.get(id);
    if (!experiment) {
      throw new ProductApiError("Experiment not found.", {
        status: 404,
        statusText: "Not Found",
        code: "EXPERIMENT_NOT_FOUND",
      });
    }
    const priorKey = this.runKeys.get(id);
    if (priorKey && priorKey !== idempotencyKey) {
      throw new ProductApiError("The experiment has already been run.", {
        status: 409,
        statusText: "Conflict",
        code: "EXPERIMENT_ALREADY_RUN",
      });
    }
    if (priorKey === idempotencyKey) return;

    this.runKeys.set(id, idempotencyKey);
    const episodeCount = experiment.number_of_episodes ?? 0;
    for (let index = 0; index < episodeCount; index += 1) {
      const episode = createPendingEpisodeFixture({
        id: `${id}.episode-${index + 1}`,
        experimentId: id,
        seed: experiment.environment_config.seed + index,
        policy: experiment.policy,
        environmentConfig: experiment.environment_config,
        createdAt: experiment.created_at,
      });
      this.episodes.set(episode.id, episode);
    }
    experiment.status = "RUNNING";
    this.refreshExperiment(id);
  }

  async getExperiment(
    id: string,
    options: ProductApiRequestOptions = {},
  ): Promise<ExperimentDetail> {
    await this.wait(options);
    if (!this.experiments.has(id)) {
      throw new ProductApiError("Experiment not found.", {
        status: 404,
        statusText: "Not Found",
        code: "EXPERIMENT_NOT_FOUND",
      });
    }
    this.advancePolling(id);
    return clone(this.refreshExperiment(id));
  }

  async getEpisode(
    id: string,
    options: GetEpisodeOptions = {},
  ): Promise<EpisodeDetail> {
    await this.wait(options);
    const existing = this.episodes.get(id);
    if (!existing) {
      throw new ProductApiError("Episode not found.", {
        status: 404,
        statusText: "Not Found",
        code: "EPISODE_NOT_FOUND",
      });
    }
    if (existing.status === "PENDING" || existing.status === "RUNNING") {
      this.advancePolling(existing.experiment_id);
    }
    const episode = this.episodes.get(id);
    if (!episode) {
      throw new ProductApiError("Episode not found.", {
        status: 404,
        statusText: "Not Found",
        code: "EPISODE_NOT_FOUND",
      });
    }
    const currentAttempt = episode.attempt ?? 1;
    const requestedAttempt = options.attempt ?? currentAttempt;
    if (requestedAttempt > currentAttempt || requestedAttempt < 1) {
      throw new ProductApiError("Episode attempt not found.", {
        status: 404,
        statusText: "Not Found",
        code: "EPISODE_ATTEMPT_NOT_FOUND",
      });
    }
    if (requestedAttempt < currentAttempt) {
      const historical = this.attemptHistory.get(id)?.get(requestedAttempt);
      if (!historical) {
        throw new ProductApiError("Episode attempt not found.", {
          status: 404,
          statusText: "Not Found",
          code: "EPISODE_ATTEMPT_NOT_FOUND",
        });
      }
      return clone({
        ...historical,
        status: episode.status,
        attempt: currentAttempt,
      });
    }
    return clone(episode);
  }

  async retryEpisode(
    id: string,
    options: ProductApiRequestOptions = {},
  ): Promise<EpisodeMutationResult> {
    await this.wait(options);
    const episode = this.episodes.get(id);
    if (!episode) {
      throw new ProductApiError("Episode not found.", {
        status: 404,
        statusText: "Not Found",
        code: "EPISODE_NOT_FOUND",
      });
    }
    if (episode.status !== "FAILED") {
      throw new ProductApiError(`Episode is ${episode.status}; expected FAILED.`, {
        status: 409,
        statusText: "Conflict",
        code: "INVALID_EPISODE_TRANSITION",
      });
    }

    const currentAttempt = episode.attempt ?? 1;
    const history = this.attemptHistory.get(id) ?? new Map<number, EpisodeDetail>();
    history.set(currentAttempt, clone(episode));
    this.attemptHistory.set(id, history);

    episode.attempt = currentAttempt + 1;
    episode.status = "PENDING";
    episode.steps_completed = 0;
    episode.total_cost = null;
    episode.failure_count = null;
    episode.replacement_count = null;
    episode.waiting_steps = null;
    episode.failure = null;
    episode.started_at = null;
    episode.completed_at = null;
    episode.summary = null;
    episode.steps = [];
    episode.updated_at = new Date().toISOString();
    this.refreshExperiment(episode.experiment_id);
    return { id: episode.id, status: episode.status, attempt: episode.attempt };
  }

  async cancelEpisode(
    id: string,
    options: ProductApiRequestOptions = {},
  ): Promise<EpisodeMutationResult> {
    await this.wait(options);
    const episode = this.episodes.get(id);
    if (!episode) {
      throw new ProductApiError("Episode not found.", {
        status: 404,
        statusText: "Not Found",
        code: "EPISODE_NOT_FOUND",
      });
    }
    if (episode.status !== "PENDING") {
      throw new ProductApiError(`Episode is ${episode.status}; expected PENDING.`, {
        status: 409,
        statusText: "Conflict",
        code: "INVALID_EPISODE_TRANSITION",
      });
    }
    episode.status = "CANCELLED";
    episode.updated_at = new Date().toISOString();
    this.refreshExperiment(episode.experiment_id);
    return { id: episode.id, status: episode.status, attempt: episode.attempt ?? 1 };
  }
}

export function createMockProductApiClient(
  options: MockProductApiClientOptions = {},
): ProductApiClient {
  return new MockProductApiClient(options);
}
