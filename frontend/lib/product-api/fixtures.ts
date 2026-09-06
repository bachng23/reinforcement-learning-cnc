import { CNC_SCHEMA_VERSION } from "@/types/cnc";
import type {
  EnvironmentConfig,
  FleetObservation,
  MachineObservation,
  PolicyRecommendation,
  StepResult,
} from "@/types/cnc";
import type {
  EpisodeDetail,
  EpisodeStepRecord,
  ExperimentDetail,
  PolicyCatalogItem,
  PolicyReference,
} from "@/types/product-api";

export const MOCK_POLICY_CATALOG: PolicyCatalogItem[] = [
  {
    id: "policy-risk-aware-v2",
    key: "risk-aware",
    name: "Risk-aware replacement",
    version: "2.1.0",
    description: "A versioned research policy fixture for the Week 1 workflow.",
    available: true,
    config: { objective: "CVAR" },
    created_at: "2026-08-20T08:00:00.000Z",
    updated_at: "2026-08-30T08:00:00.000Z",
  },
  {
    id: "policy-threshold-v1",
    key: "threshold-baseline",
    name: "Threshold baseline",
    version: "1.0.0",
    description: "A deterministic baseline policy fixture.",
    available: true,
    config: { objective: "EXPECTED_COST" },
    created_at: "2026-08-18T08:00:00.000Z",
    updated_at: "2026-08-18T08:00:00.000Z",
  },
];

export const MOCK_ENVIRONMENT_CONFIG: EnvironmentConfig = {
  schema_version: CNC_SCHEMA_VERSION,
  environment_id: "cnc-fleet-demo",
  number_of_machines: 2,
  spare_capacity: 2,
  initial_spares: 1,
  horizon_steps: 3,
  failure_threshold_um: 300,
  seed: 4100,
  costs: {
    replacement_cost: 35,
    failure_cost: 210,
    waiting_cost_per_step: 8,
    unused_life_cost_per_step: 0.5,
  },
  risk: {
    objective: "CVAR",
    cvar_alpha: 0.95,
  },
};

const RISK_AWARE_POLICY: PolicyReference = {
  id: MOCK_POLICY_CATALOG[0].id,
  key: MOCK_POLICY_CATALOG[0].key,
  name: MOCK_POLICY_CATALOG[0].name,
  version: MOCK_POLICY_CATALOG[0].version,
};

function machineObservation(
  machineId: string,
  toolId: string,
  age: number,
  wear: number,
  probabilityMass: number[],
  survivalBeyondHorizon: number,
): MachineObservation {
  return {
    machine_id: machineId,
    tool_id: toolId,
    job_id: `job-${machineId}`,
    cutting_condition: {
      condition_id: machineId === "machine-01" ? "cut-heavy" : "cut-nominal",
      load_class: machineId === "machine-01" ? "HEAVY" : "NOMINAL",
    },
    tool_state: {
      tool_age_steps: age,
      observed_wear_um: wear,
      posterior_median_wear_um: wear + 3,
      posterior_std_wear_um: 7.5,
      rul_distribution: {
        support_steps: [0, 1, 2, 3],
        probability_mass: probabilityMass,
        survival_beyond_horizon: survivalBeyondHorizon,
        model_version: "m4-compact-2.0",
      },
    },
  };
}

function observation(
  episodeId: string,
  step: number,
  machines: MachineObservation[],
  sparesAvailable: number,
): FleetObservation {
  return {
    schema_version: CNC_SCHEMA_VERSION,
    observation_id: `${episodeId}.observation.${step}`,
    episode_id: episodeId,
    step,
    machines,
    inventory: { spares_available: sparesAvailable, capacity: 2 },
  };
}

function recommendation(
  fleetObservation: FleetObservation,
  actions: PolicyRecommendation["actions"]["actions"],
  expectedCost: number,
  cvarCost: number,
): PolicyRecommendation {
  return {
    schema_version: CNC_SCHEMA_VERSION,
    observation_id: fleetObservation.observation_id,
    policy_id: RISK_AWARE_POLICY.id,
    policy_version: RISK_AWARE_POLICY.version,
    actions: {
      schema_version: CNC_SCHEMA_VERSION,
      observation_id: fleetObservation.observation_id,
      actions,
    },
    estimated_expected_cost: expectedCost,
    estimated_cvar_cost: cvarCost,
  };
}

const completedEpisodeId = "episode-week1-001";

const completedObservation0 = observation(
  completedEpisodeId,
  0,
  [
    machineObservation("machine-01", "tool-01-a", 7, 218, [0.02, 0.08, 0.2, 0.35], 0.35),
    machineObservation("machine-02", "tool-02-a", 5, 171, [0.01, 0.04, 0.15, 0.3], 0.5),
  ],
  1,
);
const completedRecommendation0 = recommendation(
  completedObservation0,
  [
    { machine_id: "machine-01", action: "CONTINUE" },
    { machine_id: "machine-02", action: "CONTINUE" },
  ],
  52,
  83,
);
const completedResult0: StepResult = {
  schema_version: CNC_SCHEMA_VERSION,
  observation_id: completedObservation0.observation_id,
  episode_id: completedEpisodeId,
  step: 0,
  outcomes: [
    {
      machine_id: "machine-01",
      requested_action: "CONTINUE",
      outcome: "CONTINUED",
      tool_id_before: "tool-01-a",
      tool_id_after: "tool-01-a",
      incurred_cost: 0,
    },
    {
      machine_id: "machine-02",
      requested_action: "CONTINUE",
      outcome: "CONTINUED",
      tool_id_before: "tool-02-a",
      tool_id_after: "tool-02-a",
      incurred_cost: 0,
    },
  ],
  inventory_after: { spares_available: 1, capacity: 2 },
  total_cost: 0,
  episode_terminated: false,
};

const completedObservation1 = observation(
  completedEpisodeId,
  1,
  [
    machineObservation("machine-01", "tool-01-a", 8, 274, [0.2, 0.35, 0.25, 0.1], 0.1),
    machineObservation("machine-02", "tool-02-a", 6, 239, [0.1, 0.25, 0.3, 0.2], 0.15),
  ],
  1,
);
const completedRecommendation1 = recommendation(
  completedObservation1,
  [
    { machine_id: "machine-01", action: "REPLACE" },
    { machine_id: "machine-02", action: "REPLACE" },
  ],
  118,
  172,
);
const completedResult1: StepResult = {
  schema_version: CNC_SCHEMA_VERSION,
  observation_id: completedObservation1.observation_id,
  episode_id: completedEpisodeId,
  step: 1,
  outcomes: [
    {
      machine_id: "machine-01",
      requested_action: "REPLACE",
      outcome: "REPLACED",
      tool_id_before: "tool-01-a",
      tool_id_after: "tool-01-b",
      incurred_cost: 35,
    },
    {
      machine_id: "machine-02",
      requested_action: "REPLACE",
      outcome: "WAITING_FOR_SPARE",
      tool_id_before: "tool-02-a",
      tool_id_after: "tool-02-a",
      incurred_cost: 8,
    },
  ],
  inventory_after: { spares_available: 0, capacity: 2 },
  total_cost: 43,
  episode_terminated: false,
};

const completedObservation2 = observation(
  completedEpisodeId,
  2,
  [
    machineObservation("machine-01", "tool-01-b", 0, 22, [0.01, 0.02, 0.05, 0.12], 0.8),
    machineObservation("machine-02", "tool-02-a", 7, 306, [0.7, 0.2, 0.05, 0.02], 0.03),
  ],
  0,
);
const completedRecommendation2 = recommendation(
  completedObservation2,
  [
    { machine_id: "machine-01", action: "CONTINUE" },
    { machine_id: "machine-02", action: "CONTINUE" },
  ],
  210,
  210,
);
const completedResult2: StepResult = {
  schema_version: CNC_SCHEMA_VERSION,
  observation_id: completedObservation2.observation_id,
  episode_id: completedEpisodeId,
  step: 2,
  outcomes: [
    {
      machine_id: "machine-01",
      requested_action: "CONTINUE",
      outcome: "CONTINUED",
      tool_id_before: "tool-01-b",
      tool_id_after: "tool-01-b",
      incurred_cost: 0,
    },
    {
      machine_id: "machine-02",
      requested_action: "CONTINUE",
      outcome: "FAILED",
      tool_id_before: "tool-02-a",
      tool_id_after: null,
      incurred_cost: 210,
    },
  ],
  inventory_after: { spares_available: 0, capacity: 2 },
  total_cost: 210,
  episode_terminated: true,
};

export const MOCK_COMPLETED_STEPS: EpisodeStepRecord[] = [
  {
    step: 0,
    observation: completedObservation0,
    recommendation: completedRecommendation0,
    result: completedResult0,
    persisted_at: "2026-08-31T09:01:00.000Z",
    step_cost: 0,
    cumulative_cost: 0,
    risk_values: { expected_cost: 52, cvar_cost: 83, cvar_alpha: 0.95 },
  },
  {
    step: 1,
    observation: completedObservation1,
    recommendation: completedRecommendation1,
    result: completedResult1,
    persisted_at: "2026-08-31T09:01:02.000Z",
    step_cost: 43,
    cumulative_cost: 43,
    risk_values: { expected_cost: 118, cvar_cost: 172, cvar_alpha: 0.95 },
  },
  {
    step: 2,
    observation: completedObservation2,
    recommendation: completedRecommendation2,
    result: completedResult2,
    persisted_at: "2026-08-31T09:01:04.000Z",
    step_cost: 210,
    cumulative_cost: 253,
    risk_values: { expected_cost: 210, cvar_cost: 210, cvar_alpha: 0.95 },
    failure: {
      code: "TOOL_FAILURE",
      message: "The engine reported a tool failure for machine-02.",
      occurred_at: "2026-08-31T09:01:04.000Z",
      details: { machine_id: "machine-02", tool_id: "tool-02-a" },
    },
  },
];

const completedEpisode: EpisodeDetail = {
  id: completedEpisodeId,
  key: "week1.seed-4100",
  experiment_id: "experiment-week1-001",
  status: "COMPLETED",
  seed: 4100,
  policy: RISK_AWARE_POLICY,
  environment_config: MOCK_ENVIRONMENT_CONFIG,
  steps_completed: 3,
  total_cost: 253,
  failure_count: 1,
  replacement_count: 1,
  waiting_steps: 1,
  created_at: "2026-08-31T09:00:00.000Z",
  updated_at: "2026-08-31T09:01:04.000Z",
  started_at: "2026-08-31T09:00:30.000Z",
  completed_at: "2026-08-31T09:01:04.000Z",
  summary: {
    schema_version: CNC_SCHEMA_VERSION,
    episode_id: completedEpisodeId,
    policy_id: RISK_AWARE_POLICY.id,
    seed: 4100,
    steps_completed: 3,
    total_cost: 253,
    failure_count: 1,
    replacement_count: 1,
    waiting_steps: 1,
  },
  steps: MOCK_COMPLETED_STEPS,
};

const runningEpisodeId = "episode-week1-002";
const runningObservation = observation(
  runningEpisodeId,
  0,
  [
    machineObservation("machine-01", "tool-01-r", 2, 82, [0.01, 0.02, 0.08, 0.19], 0.7),
    machineObservation("machine-02", "tool-02-r", 1, 46, [0.01, 0.01, 0.04, 0.14], 0.8),
  ],
  1,
);
const runningRecommendation = recommendation(
  runningObservation,
  [
    { machine_id: "machine-01", action: "CONTINUE" },
    { machine_id: "machine-02", action: "CONTINUE" },
  ],
  24,
  39,
);

const runningEpisode: EpisodeDetail = {
  id: runningEpisodeId,
  key: "week1.seed-4101",
  experiment_id: "experiment-week1-001",
  status: "RUNNING",
  seed: 4101,
  policy: RISK_AWARE_POLICY,
  environment_config: { ...MOCK_ENVIRONMENT_CONFIG, seed: 4101 },
  steps_completed: 0,
  total_cost: 0,
  created_at: "2026-08-31T09:00:00.000Z",
  updated_at: "2026-08-31T09:03:00.000Z",
  started_at: "2026-08-31T09:03:00.000Z",
  completed_at: null,
  summary: null,
  steps: [
    {
      step: 0,
      observation: runningObservation,
      recommendation: runningRecommendation,
      result: null,
      persisted_at: "2026-08-31T09:03:02.000Z",
      risk_values: { expected_cost: 24, cvar_cost: 39, cvar_alpha: 0.95 },
    },
  ],
};

const pendingEpisode: EpisodeDetail = {
  id: "episode-week1-003",
  key: "week1.seed-4102",
  experiment_id: "experiment-week1-001",
  status: "PENDING",
  seed: 4102,
  policy: RISK_AWARE_POLICY,
  environment_config: { ...MOCK_ENVIRONMENT_CONFIG, seed: 4102 },
  steps_completed: 0,
  total_cost: null,
  created_at: "2026-08-31T09:00:00.000Z",
  updated_at: "2026-08-31T09:00:00.000Z",
  started_at: null,
  completed_at: null,
  summary: null,
  steps: [],
};

const failedEpisode: EpisodeDetail = {
  id: "episode-week1-004",
  key: "week1.seed-4103",
  experiment_id: "experiment-week1-001",
  status: "FAILED",
  seed: 4103,
  policy: RISK_AWARE_POLICY,
  environment_config: { ...MOCK_ENVIRONMENT_CONFIG, seed: 4103 },
  steps_completed: 0,
  total_cost: null,
  failure: {
    code: "WORKER_ERROR",
    message: "The worker stopped before the first step result was persisted.",
    occurred_at: "2026-08-31T09:02:12.000Z",
  },
  created_at: "2026-08-31T09:00:00.000Z",
  updated_at: "2026-08-31T09:02:12.000Z",
  started_at: "2026-08-31T09:02:00.000Z",
  completed_at: "2026-08-31T09:02:12.000Z",
  summary: null,
  steps: [],
};

export const MOCK_EPISODE_DETAILS: EpisodeDetail[] = [
  completedEpisode,
  runningEpisode,
  pendingEpisode,
  failedEpisode,
];

export const MOCK_EXPERIMENT_DETAILS: ExperimentDetail[] = [
  {
    id: "experiment-week1-001",
    key: "week1-risk-aware-demo",
    name: "Risk-aware fleet demonstration",
    description: "Mixed lifecycle fixture with complete and partial episode results.",
    status: "RUNNING",
    policy: RISK_AWARE_POLICY,
    environment_config: MOCK_ENVIRONMENT_CONFIG,
    created_at: "2026-08-31T09:00:00.000Z",
    updated_at: "2026-08-31T09:03:02.000Z",
    owner: {
      id: "user-engineer-001",
      username: "frontend.engineer",
      display_name: "Frontend Engineer",
    },
    number_of_episodes: 4,
    episode_counts: {
      total: 4,
      completed: 1,
      running: 1,
      pending: 1,
      failed: 1,
      cancelled: 0,
    },
    episodes: MOCK_EPISODE_DETAILS.map(({ environment_config: _config, summary: _summary, steps: _steps, ...episode }) => episode),
  },
];

export function createPendingEpisodeFixture(input: {
  id: string;
  experimentId: string;
  seed: number;
  policy: PolicyReference;
  environmentConfig: EnvironmentConfig;
  createdAt: string;
}): EpisodeDetail {
  return {
    id: input.id,
    key: `${input.experimentId}.seed-${input.seed}`,
    experiment_id: input.experimentId,
    status: "PENDING",
    seed: input.seed,
    policy: input.policy,
    environment_config: { ...input.environmentConfig, seed: input.seed },
    steps_completed: 0,
    total_cost: null,
    created_at: input.createdAt,
    updated_at: input.createdAt,
    started_at: null,
    completed_at: null,
    summary: null,
    steps: [],
  };
}
