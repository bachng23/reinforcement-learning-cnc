import type {
  EnvironmentConfig,
  EpisodeSummary,
  FleetObservation,
  PolicyRecommendation,
  StepResult,
} from "@/types/cnc";
import type {
  EpisodeCounts,
  EpisodeDetail,
  EpisodeFailureInformation,
  EpisodeListItem,
  EpisodeStatus,
  EpisodeStepRecord,
  ExperimentDetail,
  ExperimentListItem,
  ExperimentOwner,
  ExperimentStatus,
  JsonObject,
  JsonValue,
  PaginatedResponse,
  PolicyCatalogItem,
  PolicyReference,
} from "@/types/product-api";
import { malformedProductApiResponse } from "@/lib/product-api/errors";

type UnknownRecord = Record<string, unknown>;

const EPISODE_STATUSES: ReadonlySet<string> = new Set([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

const EXPERIMENT_STATUSES: ReadonlySet<string> = new Set([
  "DRAFT",
  "READY",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function first(record: UnknownRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredString(value: unknown, label: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw malformedProductApiResponse(`Product API response is missing ${label}.`);
  }
  return normalized;
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requiredNumber(value: unknown, label: string): number {
  const normalized = optionalNumber(value);
  if (normalized === undefined || normalized === null) {
    throw malformedProductApiResponse(`Product API response is missing ${label}.`);
  }
  return normalized;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function requiredRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw malformedProductApiResponse(`Product API response is missing ${label}.`);
  }
  return value;
}

function payloadFrom(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return first(value, "payload_json", "payloadJson", "payload") ?? value;
}

function unwrapResource(payload: unknown, ...resourceKeys: string[]): unknown {
  if (!isRecord(payload)) return payload;

  let candidate: unknown = payload;
  if (payload.data !== undefined) candidate = payload.data;
  if (!isRecord(candidate)) return candidate;

  for (const key of resourceKeys) {
    if (candidate[key] !== undefined) return candidate[key];
  }
  return candidate;
}

function normalizeEpisodeStatus(value: unknown): EpisodeStatus {
  const status = requiredString(value, "episode status");
  if (!EPISODE_STATUSES.has(status)) {
    throw malformedProductApiResponse(`Unknown episode status: ${status}.`);
  }
  return status as EpisodeStatus;
}

function normalizeExperimentStatus(value: unknown): ExperimentStatus {
  const status = requiredString(value, "experiment status");
  if (!EXPERIMENT_STATUSES.has(status)) {
    throw malformedProductApiResponse(`Unknown experiment status: ${status}.`);
  }
  return status as ExperimentStatus;
}

function normalizePolicySource(record: UnknownRecord): UnknownRecord {
  const nested = first(record, "policy", "selected_policy", "selectedPolicy");
  if (isRecord(nested)) return nested;
  return {
    id: first(record, "policy_id", "policyId"),
    key: first(record, "policy_key", "policyKey"),
    name: first(record, "policy_name", "policyName"),
    version: first(record, "policy_version", "policyVersion"),
  };
}

export function normalizePolicyReference(value: unknown): PolicyReference {
  const record = requiredRecord(value, "policy");
  const id = requiredString(
    first(record, "id", "policy_id", "policyId", "policy_key", "policyKey", "key"),
    "policy id",
  );
  const key = optionalString(first(record, "key", "policy_key", "policyKey"));
  return {
    id,
    name:
      optionalString(first(record, "name", "display_name", "displayName", "policy_name", "policyName")) ??
      key ??
      id,
    version: requiredString(first(record, "version", "policy_version", "policyVersion"), "policy version"),
    ...(key ? { key } : {}),
  };
}

export function normalizePolicyCatalogItem(value: unknown): PolicyCatalogItem {
  const record = requiredRecord(value, "policy catalog item");
  const reference = normalizePolicyReference(record);
  const description = first(record, "description");
  const config = first(record, "config", "config_json", "configJson");

  return {
    ...reference,
    ...(description === null || typeof description === "string" ? { description } : {}),
    ...(config === null || isRecord(config) ? { config: config as JsonObject | null } : {}),
    ...(optionalBoolean(first(record, "available", "is_available", "isAvailable", "active")) !== undefined
      ? { available: optionalBoolean(first(record, "available", "is_available", "isAvailable", "active")) }
      : {}),
    ...(optionalString(first(record, "created_at", "createdAt"))
      ? { created_at: optionalString(first(record, "created_at", "createdAt")) }
      : {}),
    ...(optionalString(first(record, "updated_at", "updatedAt"))
      ? { updated_at: optionalString(first(record, "updated_at", "updatedAt")) }
      : {}),
  };
}

export function normalizePolicyCatalog(payload: unknown): PolicyCatalogItem[] {
  const candidate = unwrapResource(payload, "policies", "items");
  const items = isRecord(candidate)
    ? first(candidate, "items", "policies")
    : candidate;
  if (!Array.isArray(items)) {
    throw malformedProductApiResponse("Product API policy response is not a list.");
  }
  return items.map(normalizePolicyCatalogItem);
}

function normalizeOwner(value: unknown): ExperimentOwner | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && value.trim()) return { display_name: value };
  if (!isRecord(value)) return undefined;

  const id = optionalString(value.id);
  const username = optionalString(value.username);
  const displayName = optionalString(first(value, "display_name", "displayName", "full_name", "fullName", "name"));
  if (!id && !username && !displayName) return undefined;
  return {
    ...(id ? { id } : {}),
    ...(username ? { username } : {}),
    ...(displayName ? { display_name: displayName } : {}),
  };
}

function countValue(record: UnknownRecord, ...keys: string[]): number | undefined {
  return optionalInteger(first(record, ...keys));
}

function normalizeEpisodeCounts(
  value: unknown,
  totalFallback?: number,
): EpisodeCounts | undefined {
  if (!isRecord(value) && totalFallback === undefined) return undefined;
  const record = isRecord(value) ? value : {};
  const total = countValue(record, "total", "total_episodes", "totalEpisodes") ?? totalFallback;
  if (total === undefined) return undefined;

  const pending = countValue(record, "pending", "pending_count", "pendingCount");
  const running = countValue(record, "running", "running_count", "runningCount");
  const completed = countValue(record, "completed", "completed_count", "completedCount");
  const failed = countValue(record, "failed", "failed_count", "failedCount");
  const cancelled = countValue(record, "cancelled", "cancelled_count", "cancelledCount");
  return {
    total,
    ...(pending !== undefined ? { pending } : {}),
    ...(running !== undefined ? { running } : {}),
    ...(completed !== undefined ? { completed } : {}),
    ...(failed !== undefined ? { failed } : {}),
    ...(cancelled !== undefined ? { cancelled } : {}),
  };
}

function normalizeFailure(value: unknown): EpisodeFailureInformation | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && value.trim()) return { message: value };
  if (!isRecord(value)) return undefined;
  const message = optionalString(first(value, "message", "reason", "error_message", "errorMessage"));
  if (!message) return undefined;
  const details = first(value, "details", "detail");
  return {
    message,
    ...(optionalString(value.code) ? { code: optionalString(value.code) } : {}),
    ...(optionalString(first(value, "occurred_at", "occurredAt", "timestamp"))
      ? { occurred_at: optionalString(first(value, "occurred_at", "occurredAt", "timestamp")) }
      : {}),
    ...(details !== undefined ? { details: details as JsonValue } : {}),
  };
}

export function normalizeEpisodeListItem(
  value: unknown,
  context: { experimentId?: string; policy?: PolicyReference } = {},
): EpisodeListItem {
  const record = requiredRecord(value, "episode");
  const nestedExperiment = isRecord(record.experiment) ? record.experiment : {};
  const policy = (() => {
    try {
      return normalizePolicyReference(normalizePolicySource(record));
    } catch (error) {
      if (context.policy) return context.policy;
      throw error;
    }
  })();
  const totalCost = optionalNumber(first(record, "total_cost", "totalCost"));
  const failureCount = optionalNumber(first(record, "failure_count", "failureCount"));
  const replacementCount = optionalNumber(first(record, "replacement_count", "replacementCount"));
  const waitingSteps = optionalNumber(first(record, "waiting_steps", "waitingSteps"));
  const normalizedFailure = normalizeFailure(first(record, "failure", "failure_info", "failureInfo", "error"));
  const failedAt = optionalString(first(record, "failed_at", "failedAt"));
  const failure = normalizedFailure && !normalizedFailure.occurred_at && failedAt
    ? { ...normalizedFailure, occurred_at: failedAt }
    : normalizedFailure;

  return {
    id: requiredString(first(record, "id", "episode_id", "episodeId", "episode_key", "episodeKey"), "episode id"),
    experiment_id: requiredString(
      first(record, "experiment_id", "experimentId") ?? nestedExperiment.id ?? context.experimentId,
      "experiment id",
    ),
    status: normalizeEpisodeStatus(record.status),
    seed: requiredNumber(record.seed, "episode seed"),
    ...(optionalInteger(record.attempt) !== undefined
      ? { attempt: optionalInteger(record.attempt) }
      : {}),
    policy,
    ...(optionalString(first(record, "key", "episode_key", "episodeKey"))
      ? { key: optionalString(first(record, "key", "episode_key", "episodeKey")) }
      : {}),
    ...(optionalInteger(first(record, "steps_completed", "stepsCompleted")) !== undefined
      ? { steps_completed: optionalInteger(first(record, "steps_completed", "stepsCompleted")) }
      : {}),
    ...(totalCost !== undefined ? { total_cost: totalCost } : {}),
    ...(failureCount !== undefined ? { failure_count: failureCount } : {}),
    ...(replacementCount !== undefined ? { replacement_count: replacementCount } : {}),
    ...(waitingSteps !== undefined ? { waiting_steps: waitingSteps } : {}),
    ...(failure !== undefined ? { failure } : {}),
    ...normalizeOptionalTimestamps(record),
  };
}

function normalizeOptionalTimestamps(record: UnknownRecord): Partial<EpisodeListItem> {
  const createdAt = optionalString(first(record, "created_at", "createdAt"));
  const updatedAt = optionalString(first(record, "updated_at", "updatedAt"));
  const startedRaw = first(record, "started_at", "startedAt");
  const completedRaw = first(record, "completed_at", "completedAt");
  const startedAt = startedRaw === null ? null : optionalString(startedRaw);
  const completedAt = completedRaw === null ? null : optionalString(completedRaw);
  return {
    ...(createdAt ? { created_at: createdAt } : {}),
    ...(updatedAt ? { updated_at: updatedAt } : {}),
    ...(startedAt !== undefined ? { started_at: startedAt } : {}),
    ...(completedAt !== undefined ? { completed_at: completedAt } : {}),
  };
}

function inferExperimentPolicy(record: UnknownRecord): PolicyReference {
  try {
    return normalizePolicyReference(normalizePolicySource(record));
  } catch (error) {
    const episodes = first(record, "episodes", "episode_items", "episodeItems");
    if (Array.isArray(episodes) && episodes.length && isRecord(episodes[0])) {
      return normalizePolicyReference(normalizePolicySource(episodes[0]));
    }
    throw error;
  }
}

export function normalizeExperimentListItem(value: unknown): ExperimentListItem {
  const record = requiredRecord(value, "experiment");
  const episodes = first(record, "episodes", "episode_items", "episodeItems");
  const numberOfEpisodes = optionalInteger(
    first(
      record,
      "number_of_episodes",
      "numberOfEpisodes",
      "episodeCount",
      "requested_episode_count",
      "requestedEpisodeCount",
    ),
  );
  const counts = normalizeEpisodeCounts(
    first(record, "episode_counts", "episodeCounts", "counts"),
    numberOfEpisodes ?? (Array.isArray(episodes) ? episodes.length : undefined),
  );
  const owner = normalizeOwner(first(record, "owner", "created_by", "createdBy", "createdById"));
  const description = record.description;
  const updatedAt = optionalString(first(record, "updated_at", "updatedAt"));
  const key = optionalString(first(record, "key", "experiment_key", "experimentKey"));

  return {
    id: requiredString(first(record, "id", "experiment_id", "experimentId", "experiment_key", "experimentKey"), "experiment id"),
    name: requiredString(record.name, "experiment name"),
    status: normalizeExperimentStatus(record.status),
    policy: inferExperimentPolicy(record),
    created_at: requiredString(first(record, "created_at", "createdAt"), "experiment creation time"),
    ...(key ? { key } : {}),
    ...(description === null || typeof description === "string" ? { description } : {}),
    ...(updatedAt ? { updated_at: updatedAt } : {}),
    ...(owner !== undefined ? { owner } : {}),
    ...(numberOfEpisodes !== undefined ? { number_of_episodes: numberOfEpisodes } : {}),
    ...(counts ? { episode_counts: counts } : {}),
  };
}

function normalizeEnvironmentConfig(value: unknown): EnvironmentConfig {
  return requiredRecord(value, "environment configuration") as unknown as EnvironmentConfig;
}

export function normalizeExperimentDetail(payload: unknown): ExperimentDetail {
  const value = unwrapResource(payload, "experiment");
  const record = requiredRecord(value, "experiment detail");
  const base = normalizeExperimentListItem(record);
  const rawEpisodes = first(record, "episodes", "episode_items", "episodeItems") ?? [];
  if (!Array.isArray(rawEpisodes)) {
    throw malformedProductApiResponse("Product API experiment episodes are not a list.");
  }
  const episodes = rawEpisodes.map((episode) =>
    normalizeEpisodeListItem(episode, { experimentId: base.id, policy: base.policy }),
  );

  return {
    ...base,
    environment_config: normalizeEnvironmentConfig(
      first(record, "environment_config", "environmentConfig"),
    ),
    episodes,
  };
}

function normalizeRiskValues(
  value: unknown,
): Record<string, number | string | null> | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number | string | null] =>
      entry[1] === null || typeof entry[1] === "number" || typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

export function normalizeEpisodeStepRecord(value: unknown): EpisodeStepRecord {
  const record = requiredRecord(value, "episode step");
  const directObservation =
    first(record, "payload_json", "payloadJson") !== undefined ||
    (record.observation_id !== undefined && Array.isArray(record.machines))
      ? record
      : undefined;
  const observationValue = payloadFrom(
    first(record, "observation", "fleet_observation", "fleetObservation") ?? directObservation,
  );
  const recommendationValue = payloadFrom(
    first(record, "recommendation", "policy_recommendation", "policyRecommendation"),
  );
  const resultValue = payloadFrom(first(record, "result", "step_result", "stepResult"));
  const observation = isRecord(observationValue) ? observationValue : undefined;
  const recommendation = isRecord(recommendationValue) ? recommendationValue : undefined;
  const result = isRecord(resultValue) ? resultValue : undefined;
  const step = requiredNumber(
    first(record, "step") ?? observation?.step ?? result?.step,
    "episode step number",
  );
  const stepCost = optionalNumber(first(record, "step_cost", "stepCost"));
  const cumulativeCost = optionalNumber(first(record, "cumulative_cost", "cumulativeCost"));
  const riskValues = normalizeRiskValues(first(record, "risk_values", "riskValues", "risk"));
  const failure = normalizeFailure(first(record, "failure", "failure_info", "failureInfo", "error"));
  const persistedAt = optionalString(first(record, "persisted_at", "persistedAt", "created_at", "createdAt"));

  return {
    step,
    ...(observationValue === null
      ? { observation: null }
      : observation
        ? { observation: observation as unknown as FleetObservation }
        : {}),
    ...(recommendationValue === null
      ? { recommendation: null }
      : recommendation
        ? { recommendation: recommendation as unknown as PolicyRecommendation }
        : {}),
    ...(resultValue === null
      ? { result: null }
      : result
        ? { result: result as unknown as StepResult }
        : {}),
    ...(persistedAt ? { persisted_at: persistedAt } : {}),
    ...(stepCost !== undefined ? { step_cost: stepCost } : {}),
    ...(cumulativeCost !== undefined ? { cumulative_cost: cumulativeCost } : {}),
    ...(riskValues !== undefined ? { risk_values: riskValues } : {}),
    ...(failure !== undefined ? { failure } : {}),
  };
}

export function normalizeEpisodeDetail(payload: unknown): EpisodeDetail {
  const value = unwrapResource(payload, "episode");
  const record = requiredRecord(value, "episode detail");
  const base = normalizeEpisodeListItem(record);
  const experiment = isRecord(record.experiment) ? record.experiment : {};
  const rawSteps = first(record, "steps", "step_records", "stepRecords", "events", "observations") ?? [];
  if (!Array.isArray(rawSteps)) {
    throw malformedProductApiResponse("Product API episode steps are not a list.");
  }
  const rawSummary = payloadFrom(first(record, "summary", "episode_summary", "episodeSummary"));

  return {
    ...base,
    environment_config: normalizeEnvironmentConfig(
      first(record, "environment_config", "environmentConfig") ??
        first(experiment, "environment_config", "environmentConfig"),
    ),
    ...(rawSummary === null
      ? { summary: null }
      : isRecord(rawSummary)
        ? { summary: rawSummary as unknown as EpisodeSummary }
        : {}),
    steps: rawSteps.map(normalizeEpisodeStepRecord).sort((a, b) => a.step - b.step),
  };
}

function listCandidate(payload: unknown): { items: unknown[]; metadata: UnknownRecord } {
  if (Array.isArray(payload)) return { items: payload, metadata: {} };
  const root = requiredRecord(payload, "experiment list");
  const data = root.data;
  if (Array.isArray(data)) {
    const pagination = first(root, "pagination", "meta");
    return {
      items: data,
      metadata: isRecord(pagination) ? { ...root, ...pagination } : root,
    };
  }
  const dataRecord = isRecord(data) ? data : {};
  const items = first(dataRecord, "items", "experiments") ?? first(root, "items", "experiments");
  if (!Array.isArray(items)) {
    throw malformedProductApiResponse("Product API experiment response is not a list.");
  }
  const pagination = first(dataRecord, "pagination", "meta") ?? first(root, "pagination", "meta");
  return { items, metadata: isRecord(pagination) ? { ...root, ...pagination } : root };
}

export function normalizeExperimentPage(
  payload: unknown,
  requested: { page: number; pageSize: number },
): PaginatedResponse<ExperimentListItem> {
  const { items: rawItems, metadata } = listCandidate(payload);
  const items = rawItems.map(normalizeExperimentListItem);
  const page = optionalInteger(first(metadata, "page", "current_page", "currentPage")) ?? requested.page;
  const pageSize =
    optionalInteger(first(metadata, "page_size", "pageSize", "limit", "per_page", "perPage")) ??
    requested.pageSize;
  const totalItems =
    optionalInteger(first(metadata, "total_items", "totalItems", "total", "count")) ?? items.length;
  const totalPages =
    optionalInteger(first(metadata, "total_pages", "totalPages", "pages")) ??
    Math.max(1, Math.ceil(totalItems / Math.max(pageSize, 1)));
  const hasNext =
    optionalBoolean(first(metadata, "has_next", "hasNext")) ?? page < totalPages;
  const hasPrevious =
    optionalBoolean(first(metadata, "has_previous", "hasPrevious")) ?? page > 1;

  return {
    items,
    page,
    page_size: pageSize,
    total_items: totalItems,
    total_pages: totalPages,
    has_next: hasNext,
    has_previous: hasPrevious,
  };
}
