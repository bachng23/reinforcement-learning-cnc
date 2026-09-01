import type {
  EnvironmentConfig,
  EpisodeSummary,
  FleetObservation,
  PolicyRecommendation,
  StepResult,
} from "@/types/cnc";

export type EpisodeStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

/**
 * Integration assumption: these values mirror the current persistence model.
 * The Product API contract must confirm them before they become a hard backend
 * compatibility guarantee.
 */
export type ExperimentStatus =
  | "DRAFT"
  | "READY"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ApiErrorDetail {
  message: string;
  code?: string;
  field?: string;
  path?: Array<number | string>;
  value?: unknown;
}

/** Normalized field name to one or more backend validation messages. */
export type FieldErrors = Record<string, string[]>;

export interface PaginationMetadata {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface PaginatedResponse<T> extends PaginationMetadata {
  items: T[];
}

/**
 * Product API integration model. `id`, `name`, and `version` are the minimum
 * fields needed by the policy selector; the remaining catalog metadata is
 * optional until the Product API response contract is finalized.
 */
export interface PolicyCatalogItem {
  id: string;
  name: string;
  version: string;
  key?: string;
  description?: string | null;
  config?: JsonObject | null;
  available?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PolicyReference {
  id: string;
  name: string;
  version: string;
  key?: string;
}

/** Owner fields are optional because an experiment can be system-owned. */
export interface ExperimentOwner {
  id?: string;
  username?: string;
  display_name?: string;
}

export interface EpisodeCounts {
  total: number;
  pending?: number;
  running?: number;
  completed?: number;
  failed?: number;
  cancelled?: number;
}

export interface EpisodeFailureInformation {
  message: string;
  code?: string;
  occurred_at?: string;
  details?: JsonValue;
}

/**
 * Experiment resource fields are a frontend integration model, not an
 * extension of CNC contract v2. Optional fields tolerate partial list rows.
 */
export interface ExperimentListItem {
  id: string;
  name: string;
  status: ExperimentStatus;
  policy: PolicyReference;
  created_at: string;
  key?: string;
  description?: string | null;
  updated_at?: string;
  owner?: ExperimentOwner | null;
  number_of_episodes?: number;
  episode_counts?: EpisodeCounts;
}

export interface EpisodeListItem {
  id: string;
  experiment_id: string;
  status: EpisodeStatus;
  seed: number;
  policy: PolicyReference;
  key?: string;
  steps_completed?: number;
  total_cost?: number | null;
  failure_count?: number | null;
  replacement_count?: number | null;
  waiting_steps?: number | null;
  failure?: EpisodeFailureInformation | null;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ExperimentDetail extends ExperimentListItem {
  environment_config: EnvironmentConfig;
  episodes: EpisodeListItem[];
}

/**
 * All payload fragments are optional to represent a step that has only been
 * partially persisted. Consumers must not reconstruct a missing fragment.
 */
export interface EpisodeStepRecord {
  step: number;
  observation?: FleetObservation | null;
  recommendation?: PolicyRecommendation | null;
  result?: StepResult | null;
  persisted_at?: string;
  /** Product API metadata; display only and never derive when it is absent. */
  step_cost?: number | null;
  /** Product API metadata; display only and never derive when it is absent. */
  cumulative_cost?: number | null;
  /** Product API metadata; keys and values are preserved as returned. */
  risk_values?: Record<string, number | string | null> | null;
  failure?: EpisodeFailureInformation | null;
}

export interface EpisodeDetail extends EpisodeListItem {
  environment_config: EnvironmentConfig;
  summary?: EpisodeSummary | null;
  steps: EpisodeStepRecord[];
}

/**
 * Integration assumption for POST /api/v1/experiments. The CNC seed remains
 * inside EnvironmentConfig; the frontend does not invent separate seed modes.
 */
export interface CreateExperimentRequest {
  name: string;
  policy_id: string;
  number_of_episodes: number;
  environment_config: EnvironmentConfig;
  description?: string;
  policy_version?: string;
}

export interface ListExperimentsParams {
  page?: number;
  pageSize?: number;
}

export interface ProductApiRequestOptions {
  signal?: AbortSignal;
}

export interface ProductApiClient {
  listPolicies(
    options?: ProductApiRequestOptions,
  ): Promise<PolicyCatalogItem[]>;
  listExperiments(
    params?: ListExperimentsParams,
    options?: ProductApiRequestOptions,
  ): Promise<PaginatedResponse<ExperimentListItem>>;
  createExperiment(
    payload: CreateExperimentRequest,
    options?: ProductApiRequestOptions,
  ): Promise<ExperimentDetail>;
  getExperiment(
    id: string,
    options?: ProductApiRequestOptions,
  ): Promise<ExperimentDetail>;
  getEpisode(
    id: string,
    options?: ProductApiRequestOptions,
  ): Promise<EpisodeDetail>;
}
