/** Historical M0 proposal only. Current consumer types are generated in
 * frontend/types/generated/scenario-planning.ts from the integrated OpenAPI.
 * Do not use UnfrozenEngineResult below as the current result contract. */
export type UUID = string;
export type Hash = string;
export type Timestamp = string;
export type Weights = {
  production: number;
  reliability: number;
  maintenance: number;
  workforce: number;
  schedule_stability: number;
};
export type Override =
  | { type: 'TECHNICIAN_UNAVAILABLE'; technician_id: string; start_at: Timestamp; end_at: Timestamp }
  | { type: 'MAINTENANCE_DURATION'; maintenance_request_id: string; expected_duration_minutes: number }
  | { type: 'DEFER_MAINTENANCE'; maintenance_request_id: string; earliest_start_at: Timestamp };
export interface PlanningConfig {
  horizon_minutes: number;
  candidate_limit: number;
  solver_timeout_seconds: number;
  simulation_runs: number;
  base_seed: number;
  objective_weights: Weights;
  allowed_strategy_ids: string[];
}
export interface HeadFence { snapshot_id: string; plan_version: number; revision: number }
export interface BaselineEntities {
  workspace_id: UUID;
  baseline: BaselineIdentity;
  planning_window: { start_at: Timestamp; end_at: Timestamp };
  technicians: { technician_id: string; display_name: string; availability: { start_at: Timestamp; end_at: Timestamp }[] }[];
  maintenance_requests: { maintenance_request_id: string; machine_id: string; expected_duration_minutes: number;
    earliest_start_at: Timestamp | null; latest_start_at: Timestamp | null; mandatory: boolean; priority: string; status: string }[];
}
export interface CreateWorkspace {
  factory_id: string;
  name: string;
  expected_head: HeadFence;
  planning_config: PlanningConfig;
}
export interface CreateDraft { name: string; note: string; overrides: Override[]; objective_weights: Weights }
export interface UpdateDraft extends CreateDraft { expected_revision: number }
export type EnqueueRun =
  | { kind: 'BASELINE' }
  | { kind: 'SCENARIO'; scenario_id: UUID; expected_revision: number };
export type SweepAxis =
  | { type: 'MAINTENANCE_DURATION'; maintenance_request_id: string; values: number[] }
  | { type: 'OBJECTIVE_WEIGHT'; weight: keyof Weights; values: number[] };
export interface EnqueueSensitivity { source_run_id: UUID; axis: SweepAxis }
export interface LiveEvaluation { source_run_id: UUID; confirmation: true; expected_head: HeadFence }
export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type PointStatus = 'QUEUED' | 'RUNNING' | 'FEASIBLE' | 'NO_FEASIBLE_PLAN' | 'FAILED' | 'TIMEOUT';
export type SweepOutcome = 'COMPLETE' | 'PARTIAL_FAILED' | 'FAILED';
/** Pending joint Flex schema; consumers must not infer metric/scoring fields. */
export type UnfrozenEngineResult = Record<string, unknown>;
export interface Point {
  point_index: number;
  value: number | null;
  status: PointStatus;
  error_code: string | null;
  result: UnfrozenEngineResult | null;
}
export interface Job {
  workspace_id: UUID;
  job_id: UUID;
  kind: 'RUN' | 'SENSITIVITY';
  status: JobStatus;
  input_hash: Hash;
  source_scenario_id: UUID | null;
  source_revision: number | null;
  source_run_id: UUID | null;
  engine_version: string;
  contract_version: string;
  attempt: number;
  created_at: Timestamp;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  deadline_at: Timestamp;
  error_code: string | null;
  result: UnfrozenEngineResult | null;
  points: Point[];
}
export interface BaselineIdentity {
  factory_id: string;
  snapshot_id: string;
  snapshot_hash: Hash;
  plan_version: number;
  publication: null | { schedule_id: string; schedule_revision: number; schedule_hash: Hash };
}
export interface Workspace {
  workspace_id: UUID;
  name: string;
  baseline: BaselineIdentity;
  planning_config: PlanningConfig;
  engine_version: string;
  contract_version: string;
  created_by: UUID;
  created_at: Timestamp;
  current_head: HeadFence | null;
  stale: boolean;
}
export interface Draft extends CreateDraft {
  workspace_id: UUID;
  scenario_id: UUID;
  revision: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}
export interface Page<T> { items: T[]; next_cursor: string | null }
export interface Success<T> { success: true; data: T }
export interface Failure { success: false; error: { code: string; message: string }; requestId: string }
