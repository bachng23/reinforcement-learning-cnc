const { z } = require('zod');

const identifier = z.string().trim().min(1).max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();
const nonNegativeInteger = z.number().int().nonnegative();
const schemaVersion = z.literal('2.0');

const rulDistributionSchema = z.object({
  support_steps: z.array(nonNegativeInteger).min(2),
  probability_mass: z.array(finiteNumber.min(0).max(1)).min(2),
  survival_beyond_horizon: finiteNumber.min(0).max(1),
  model_version: identifier,
}).strict().superRefine((value, ctx) => {
  if (value.support_steps.length !== value.probability_mass.length) {
    ctx.addIssue({ code: 'custom', message: 'RUL support and probability mass must have equal length' });
  }
  if (value.support_steps[0] !== 0
    || value.support_steps.some((step, index) => index > 0 && step <= value.support_steps[index - 1])) {
    ctx.addIssue({ code: 'custom', message: 'RUL support must start at zero and be strictly increasing' });
  }
  const total = value.probability_mass.reduce((sum, probability) => sum + probability, 0)
    + value.survival_beyond_horizon;
  if (Math.abs(total - 1) > 1e-6) {
    ctx.addIssue({ code: 'custom', message: 'RUL probability mass and survival probability must sum to one' });
  }
});

const inventorySchema = z.object({
  spares_available: nonNegativeInteger,
  capacity: nonNegativeInteger,
}).strict().superRefine((value, ctx) => {
  if (value.spares_available > value.capacity) {
    ctx.addIssue({ code: 'custom', message: 'Available spares cannot exceed capacity' });
  }
});

const machineObservationSchema = z.object({
  machine_id: identifier,
  tool_id: identifier,
  job_id: identifier.nullable().optional().default(null),
  cutting_condition: z.object({
    condition_id: identifier,
    load_class: z.enum(['LIGHT', 'NOMINAL', 'HEAVY']),
  }).strict(),
  tool_state: z.object({
    tool_age_steps: nonNegativeInteger,
    observed_wear_um: nonNegativeNumber,
    posterior_median_wear_um: nonNegativeNumber,
    posterior_std_wear_um: nonNegativeNumber,
    rul_distribution: rulDistributionSchema,
  }).strict(),
}).strict();

const fleetObservationSchema = z.object({
  schema_version: schemaVersion,
  observation_id: identifier,
  episode_id: identifier,
  step: nonNegativeInteger,
  machines: z.array(machineObservationSchema).min(1),
  inventory: inventorySchema,
}).strict().superRefine((value, ctx) => {
  const machineIds = value.machines.map((machine) => machine.machine_id);
  const toolIds = value.machines.map((machine) => machine.tool_id);
  if (new Set(machineIds).size !== machineIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Machine identifiers must be unique' });
  }
  if (new Set(toolIds).size !== toolIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Active tool identifiers must be unique' });
  }
});

const machineActionSchema = z.object({
  machine_id: identifier,
  action: z.enum(['CONTINUE', 'REPLACE']),
}).strict();

const jointActionSchema = z.object({
  schema_version: schemaVersion,
  observation_id: identifier,
  actions: z.array(machineActionSchema).min(1),
}).strict().superRefine((value, ctx) => {
  const machineIds = value.actions.map((action) => action.machine_id);
  if (new Set(machineIds).size !== machineIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Joint actions must contain one action per machine' });
  }
});

const policyRecommendationSchema = z.object({
  schema_version: schemaVersion,
  observation_id: identifier,
  policy_id: identifier,
  policy_version: identifier,
  actions: jointActionSchema,
  estimated_expected_cost: nonNegativeNumber.nullable().optional().default(null),
  estimated_cvar_cost: nonNegativeNumber.nullable().optional().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.actions.observation_id !== value.observation_id) {
    ctx.addIssue({ code: 'custom', message: 'Recommendation and actions must reference the same observation' });
  }
});

const machineStepOutcomeSchema = z.object({
  machine_id: identifier,
  requested_action: z.enum(['CONTINUE', 'REPLACE']),
  outcome: z.enum(['CONTINUED', 'REPLACED', 'WAITING_FOR_SPARE', 'FAILED']),
  tool_id_before: identifier,
  tool_id_after: identifier.nullable().optional().default(null),
  incurred_cost: nonNegativeNumber,
}).strict().superRefine((value, ctx) => {
  const validOutcome = value.requested_action === 'CONTINUE'
    ? ['CONTINUED', 'FAILED'].includes(value.outcome)
    : ['REPLACED', 'WAITING_FOR_SPARE'].includes(value.outcome);
  if (!validOutcome) ctx.addIssue({ code: 'custom', message: 'Outcome is incompatible with requested action' });
  if (value.outcome === 'REPLACED' && (!value.tool_id_after || value.tool_id_after === value.tool_id_before)) {
    ctx.addIssue({ code: 'custom', message: 'Replacement must provide a new tool identifier' });
  }
  if (value.outcome !== 'REPLACED' && value.tool_id_after !== null) {
    ctx.addIssue({ code: 'custom', message: 'Only replacement may provide a new tool identifier' });
  }
});

const stepResultSchema = z.object({
  schema_version: schemaVersion,
  observation_id: identifier,
  episode_id: identifier,
  step: nonNegativeInteger,
  outcomes: z.array(machineStepOutcomeSchema).min(1),
  inventory_after: inventorySchema,
  total_cost: nonNegativeNumber,
  episode_terminated: z.boolean(),
}).strict().superRefine((value, ctx) => {
  const machineIds = value.outcomes.map((outcome) => outcome.machine_id);
  if (new Set(machineIds).size !== machineIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Step results must contain one outcome per machine' });
  }
});

const episodeSummarySchema = z.object({
  schema_version: schemaVersion,
  episode_id: identifier,
  policy_id: identifier,
  seed: nonNegativeInteger,
  steps_completed: nonNegativeInteger,
  total_cost: nonNegativeNumber,
  failure_count: nonNegativeInteger,
  replacement_count: nonNegativeInteger,
  waiting_steps: nonNegativeInteger,
}).strict();

const environmentConfigSchema = z.object({
  schema_version: schemaVersion,
  environment_id: identifier,
  number_of_machines: z.number().int().min(1),
  spare_capacity: nonNegativeInteger,
  initial_spares: nonNegativeInteger,
  horizon_steps: z.number().int().min(1),
  failure_threshold_um: finiteNumber.positive(),
  seed: nonNegativeInteger,
  costs: z.object({
    replacement_cost: nonNegativeNumber,
    failure_cost: nonNegativeNumber,
    waiting_cost_per_step: nonNegativeNumber,
    unused_life_cost_per_step: nonNegativeNumber,
  }).strict(),
  risk: z.object({
    objective: z.enum(['EXPECTED_COST', 'CVAR']),
    cvar_alpha: finiteNumber.gt(0).lt(1).optional().default(0.95),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.initial_spares > value.spare_capacity) {
    ctx.addIssue({ code: 'custom', message: 'Initial spares cannot exceed capacity' });
  }
});

const engineRequestSchema = z.object({
  episodeId: identifier,
  attempt: z.number().int().positive(),
  environmentConfig: environmentConfigSchema,
  policyId: identifier,
  policyVersion: identifier,
  seed: nonNegativeInteger,
}).strict();

const eventEnvelope = (type, payload) => z.object({
  type: z.literal(type),
  payload,
}).strict();

const engineEventSchema = z.discriminatedUnion('type', [
  eventEnvelope('FleetObservation', fleetObservationSchema),
  eventEnvelope('PolicyRecommendation', policyRecommendationSchema),
  eventEnvelope('StepResult', stepResultSchema),
  eventEnvelope('EpisodeSummary', episodeSummarySchema),
]);

class ContractValidationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'ContractValidationError';
    this.code = 'ENGINE_EVENT_INVALID';
    this.issues = issues;
  }
}

function validateEngineRequest(value) {
  const result = engineRequestSchema.safeParse(value);
  if (!result.success) throw new ContractValidationError('Invalid engine request', result.error.issues);
  return result.data;
}

function validateEngineEvent(value) {
  const result = engineEventSchema.safeParse(value);
  if (!result.success) throw new ContractValidationError('Invalid CNC contract v2 event', result.error.issues);
  return result.data;
}

module.exports = {
  ContractValidationError,
  engineRequestSchema,
  engineEventSchema,
  validateEngineRequest,
  validateEngineEvent,
};
