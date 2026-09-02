const { z } = require('zod');

const POSTGRES_INT_MAX = 2_147_483_647;

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, {
    message: 'Must be a valid CNC identifier',
  });

const nonNegativeFiniteNumberSchema = z.number().finite().min(0);
const nonNegativeIntegerSchema = z.number().finite().int().min(0);

const costConfigSchema = z
  .object({
    replacement_cost: nonNegativeFiniteNumberSchema,
    failure_cost: nonNegativeFiniteNumberSchema,
    waiting_cost_per_step: nonNegativeFiniteNumberSchema,
    unused_life_cost_per_step: nonNegativeFiniteNumberSchema,
  })
  .strict();

const riskConfigSchema = z
  .object({
    objective: z.enum(['EXPECTED_COST', 'CVAR']),
    cvar_alpha: z.number().finite().gt(0).lt(1).default(0.95),
  })
  .strict();

const environmentConfigSchema = z
  .object({
    schema_version: z.literal('2.0').default('2.0'),
    environment_id: identifierSchema,
    number_of_machines: z.number().finite().int().min(1),
    spare_capacity: nonNegativeIntegerSchema,
    initial_spares: nonNegativeIntegerSchema,
    horizon_steps: z.number().finite().int().min(1),
    failure_threshold_um: z.number().finite().gt(0),
    seed: nonNegativeIntegerSchema,
    costs: costConfigSchema,
    risk: riskConfigSchema,
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.initial_spares > config.spare_capacity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['initial_spares'],
        message: 'initial_spares cannot exceed spare_capacity',
      });
    }
  });

const createExperimentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2_000).nullable().optional(),
    policyKey: identifierSchema,
    policyVersion: identifierSchema,
    episodeCount: z.number().finite().int().min(1).max(1_000),
    environmentConfig: environmentConfigSchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    // Episodes use PostgreSQL INTEGER. Deterministic seeds are base seed + episode index.
    const largestEpisodeSeed = POSTGRES_INT_MAX - (request.episodeCount - 1);
    if (request.environmentConfig.seed > largestEpisodeSeed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['environmentConfig', 'seed'],
        message:
          `seed through seed + episodeCount - 1 must fit PostgreSQL INTEGER ` +
          `(maximum ${POSTGRES_INT_MAX})`,
      });
    }
  });

const pageSchema = z.coerce.number().finite().int().min(1).default(1);
const limitSchema = z.coerce.number().finite().int().min(1).max(100).default(20);

const paginationSchema = z
  .object({
    page: pageSchema,
    limit: limitSchema,
  })
  .strict();

const experimentStatusSchema = z.enum([
  'DRAFT',
  'READY',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const episodeStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const experimentListQuerySchema = paginationSchema.extend({
  status: experimentStatusSchema.optional(),
});

const episodeListQuerySchema = paginationSchema.extend({
  status: episodeStatusSchema.optional(),
});

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, {
    message: 'Idempotency key must contain only letters, numbers, dots, underscores, colons, or hyphens',
  });

const parseIdempotencyKey = (value) => idempotencyKeySchema.parse(value);

module.exports = {
  environmentConfigSchema,
  createExperimentSchema,
  paginationSchema,
  experimentStatusSchema,
  episodeStatusSchema,
  experimentListQuerySchema,
  episodeListQuerySchema,
  idempotencyKeySchema,
  parseIdempotencyKey,
};
