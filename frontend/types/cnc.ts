/**
 * TypeScript representation of the generated CNC domain contract v2.
 *
 * Source of truth: contracts/v2/cnc-domain.schema.json. Keep wire field names in
 * snake_case and do not add Product API metadata to these domain models.
 */

export const CNC_SCHEMA_VERSION = "2.0" as const;

export type CncSchemaVersion = typeof CNC_SCHEMA_VERSION;

export type ToolAction = "CONTINUE" | "REPLACE";

export type ExecutionOutcome =
  | "CONTINUED"
  | "REPLACED"
  | "WAITING_FOR_SPARE"
  | "FAILED";

export type RiskObjective = "EXPECTED_COST" | "CVAR";

export type LoadClass = "LIGHT" | "NOMINAL" | "HEAVY";

export interface CostConfig {
  replacement_cost: number;
  failure_cost: number;
  waiting_cost_per_step: number;
  unused_life_cost_per_step: number;
}

export interface RiskConfig {
  objective: RiskObjective;
  /** Contract default: 0.95. Valid values are greater than 0 and less than 1. */
  cvar_alpha?: number;
}

export interface EnvironmentConfig {
  /** Optional on input because the contract supplies the constant default. */
  schema_version?: CncSchemaVersion;
  environment_id: string;
  number_of_machines: number;
  spare_capacity: number;
  initial_spares: number;
  horizon_steps: number;
  failure_threshold_um: number;
  seed: number;
  costs: CostConfig;
  risk: RiskConfig;
}

export interface SharedInventoryState {
  spares_available: number;
  capacity: number;
}

/** A discrete RUL distribution measured in simulator steps. */
export interface RULDistribution {
  support_steps: number[];
  probability_mass: number[];
  survival_beyond_horizon: number;
  model_version: string;
}

export interface ToolBeliefState {
  tool_age_steps: number;
  observed_wear_um: number;
  posterior_median_wear_um: number;
  posterior_std_wear_um: number;
  rul_distribution: RULDistribution;
}

export interface CuttingCondition {
  condition_id: string;
  load_class: LoadClass;
}

export interface MachineObservation {
  machine_id: string;
  tool_id: string;
  cutting_condition: CuttingCondition;
  tool_state: ToolBeliefState;
  /** Optional on input; the contract default is null. */
  job_id?: string | null;
}

export interface FleetObservation {
  /** Optional on input because the contract supplies the constant default. */
  schema_version?: CncSchemaVersion;
  observation_id: string;
  episode_id: string;
  step: number;
  machines: MachineObservation[];
  inventory: SharedInventoryState;
}

export interface MachineAction {
  machine_id: string;
  action: ToolAction;
}

export interface JointAction {
  /** Optional on input because the contract supplies the constant default. */
  schema_version?: CncSchemaVersion;
  observation_id: string;
  actions: MachineAction[];
}

export interface PolicyRecommendation {
  /** Optional on input because the contract supplies the constant default. */
  schema_version?: CncSchemaVersion;
  observation_id: string;
  policy_id: string;
  policy_version: string;
  actions: JointAction;
  /** Optional on input; the contract default is null. */
  estimated_expected_cost?: number | null;
  /** Optional on input; the contract default is null. */
  estimated_cvar_cost?: number | null;
}

export interface MachineStepOutcome {
  machine_id: string;
  requested_action: ToolAction;
  outcome: ExecutionOutcome;
  tool_id_before: string;
  /** Optional on input; the contract default is null. */
  tool_id_after?: string | null;
  incurred_cost: number;
}

export interface StepResult {
  /** Optional on input because the contract supplies the constant default. */
  schema_version?: CncSchemaVersion;
  observation_id: string;
  episode_id: string;
  step: number;
  outcomes: MachineStepOutcome[];
  inventory_after: SharedInventoryState;
  total_cost: number;
  episode_terminated: boolean;
}

export interface EpisodeSummary {
  /** Optional on input because the contract supplies the constant default. */
  schema_version?: CncSchemaVersion;
  episode_id: string;
  policy_id: string;
  seed: number;
  steps_completed: number;
  total_cost: number;
  failure_count: number;
  replacement_count: number;
  waiting_steps: number;
}
