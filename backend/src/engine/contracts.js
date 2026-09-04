const { z } = require('zod');

const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();

const engineRequestSchema = z.object({
  episodeId: z.string().min(1),
  environmentConfig: z.record(z.string(), z.unknown()),
  policyId: z.string().min(1),
  policyVersion: z.string().min(1),
  seed: z.number().int(),
}).strict();

const rulDistributionSchema = z.object({
  bins: z.array(z.number().int().nonnegative()).min(2),
  probabilities: z.array(nonNegativeNumber).min(2),
}).strict().superRefine((value, ctx) => {
  if (value.bins.length !== value.probabilities.length) {
    ctx.addIssue({ code: 'custom', message: 'RUL bins and probabilities must have equal length' });
  }
  const total = value.probabilities.reduce((sum, probability) => sum + probability, 0);
  if (Math.abs(total - 1) > 1e-6) {
    ctx.addIssue({ code: 'custom', message: 'RUL probabilities must sum to 1' });
  }
});

const fleetObservationSchema = z.object({
  type: z.literal('FleetObservation'),
  schemaVersion: z.literal('2.0'),
  episodeId: z.string().min(1),
  step: z.number().int().nonnegative(),
  fixture: z.literal(true),
  machines: z.array(z.object({
    machineId: z.string().min(1),
    toolAge: z.number().int().nonnegative(),
    risk: z.number().min(0).max(1),
    waitingForSpare: z.boolean(),
    rulDistribution: rulDistributionSchema,
  }).strict()).min(2),
}).strict();

const recommendationSchema = z.object({
  type: z.literal('PolicyRecommendation'),
  schemaVersion: z.literal('2.0'),
  episodeId: z.string().min(1),
  step: z.number().int().nonnegative(),
  fixture: z.literal(true),
  recommendations: z.array(z.object({
    machineId: z.string().min(1),
    action: z.enum(['CONTINUE', 'REPLACE']),
    estimatedRisk: z.number().min(0).max(1),
    estimatedCost: nonNegativeNumber,
  }).strict()).min(2),
}).strict();

const stepResultSchema = z.object({
  type: z.literal('StepResult'),
  schemaVersion: z.literal('2.0'),
  episodeId: z.string().min(1),
  step: z.number().int().nonnegative(),
  fixture: z.literal(true),
  outcomes: z.array(z.object({
    machineId: z.string().min(1),
    outcome: z.enum(['CONTINUED', 'REPLACED', 'WAITING_FOR_SPARE', 'FAILED']),
    cost: nonNegativeNumber,
    failed: z.boolean(),
  }).strict()).min(2),
  stepCost: nonNegativeNumber,
  episodeTerminated: z.boolean(),
}).strict();

const episodeSummarySchema = z.object({
  type: z.literal('EpisodeSummary'),
  schemaVersion: z.literal('2.0'),
  episodeId: z.string().min(1),
  fixture: z.literal(true),
  stepsCompleted: z.number().int().positive(),
  totalCost: nonNegativeNumber,
  failureCount: z.number().int().nonnegative(),
  replacementCount: z.number().int().nonnegative(),
  waitingSteps: z.number().int().nonnegative(),
}).strict();

const engineEventSchema = z.discriminatedUnion('type', [
  fleetObservationSchema,
  recommendationSchema,
  stepResultSchema,
  episodeSummarySchema,
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
