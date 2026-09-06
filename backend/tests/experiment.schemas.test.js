const {
  createExperimentSchema,
  environmentConfigSchema,
  episodeListQuerySchema,
  experimentListQuerySchema,
  idempotencyKeySchema,
  paginationSchema,
} = require('../src/validation/experiment.schemas');
const canonicalContract = require('../../contracts/v2/cnc-domain.schema.json');

const POSTGRES_INT_MAX = 2_147_483_647;

const makeEnvironmentConfig = (overrides = {}) => ({
  environment_id: 'cnc-fleet-v0.1',
  number_of_machines: 4,
  spare_capacity: 3,
  initial_spares: 2,
  horizon_steps: 480,
  failure_threshold_um: 300,
  seed: 42,
  costs: {
    replacement_cost: 100,
    failure_cost: 5_000,
    waiting_cost_per_step: 20,
    unused_life_cost_per_step: 2,
  },
  risk: {
    objective: 'CVAR',
  },
  ...overrides,
});

const makeCreateRequest = (overrides = {}) => ({
  name: 'CNC baseline',
  description: 'Four-machine CVaR baseline',
  policyKey: 'threshold-uncertainty',
  policyVersion: '1.0.0',
  episodeCount: 3,
  environmentConfig: makeEnvironmentConfig(),
  ...overrides,
});

describe('environmentConfigSchema', () => {
  test('tracks the canonical CNC v2 EnvironmentConfig field catalog', () => {
    const canonical = canonicalContract.$defs.EnvironmentConfig;

    expect(canonical.additionalProperties).toBe(false);
    expect(Object.keys(environmentConfigSchema.shape).sort()).toEqual(
      Object.keys(canonical.properties).sort(),
    );
    expect(canonical.required.sort()).toEqual([
      'costs',
      'environment_id',
      'failure_threshold_um',
      'horizon_steps',
      'initial_spares',
      'number_of_machines',
      'risk',
      'seed',
      'spare_capacity',
    ]);
    expect(canonical.properties.schema_version).toMatchObject({ const: '2.0', default: '2.0' });
  });

  test('accepts CNC v2 and materializes contract defaults', () => {
    const parsed = environmentConfigSchema.parse(makeEnvironmentConfig({
      environment_id: '  cnc-fleet-v0.1  ',
    }));

    expect(parsed).toMatchObject({
      schema_version: '2.0',
      environment_id: 'cnc-fleet-v0.1',
      seed: 42,
      risk: {
        objective: 'CVAR',
        cvar_alpha: 0.95,
      },
    });
  });

  test('accepts the explicit no-spares baseline', () => {
    const result = environmentConfigSchema.safeParse(makeEnvironmentConfig({
      spare_capacity: 0,
      initial_spares: 0,
    }));

    expect(result.success).toBe(true);
    expect(result.data.spare_capacity).toBe(0);
    expect(result.data.initial_spares).toBe(0);
  });

  test.each([
    ['top-level environment field', () => ({ ...makeEnvironmentConfig(), latent_wear_um: 151 })],
    ['nested cost field', () => ({
      ...makeEnvironmentConfig(),
      costs: { ...makeEnvironmentConfig().costs, currency: 'USD' },
    })],
    ['nested risk field', () => ({
      ...makeEnvironmentConfig(),
      risk: { ...makeEnvironmentConfig().risk, beta: 0.5 },
    })],
  ])('rejects an unknown %s', (_label, payload) => {
    expect(environmentConfigSchema.safeParse(payload()).success).toBe(false);
  });

  test('rejects initial inventory above spare capacity with a field-level issue', () => {
    const result = environmentConfigSchema.safeParse(makeEnvironmentConfig({
      spare_capacity: 2,
      initial_spares: 3,
    }));

    expect(result.success).toBe(false);
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ['initial_spares'],
        message: 'initial_spares cannot exceed spare_capacity',
      }),
    ]));
  });

  test.each([
    ['schema version', { schema_version: '1.0' }],
    ['risk objective', { risk: { objective: 'AVERAGE_COST' } }],
    ['zero CVaR alpha', { risk: { objective: 'CVAR', cvar_alpha: 0 } }],
    ['one CVaR alpha', { risk: { objective: 'CVAR', cvar_alpha: 1 } }],
    ['negative CVaR alpha', { risk: { objective: 'EXPECTED_COST', cvar_alpha: -0.1 } }],
  ])('rejects an invalid %s', (_label, overrides) => {
    expect(environmentConfigSchema.safeParse(makeEnvironmentConfig(overrides)).success).toBe(false);
  });

  test.each([
    ['zero machine count', { number_of_machines: 0 }],
    ['fractional machine count', { number_of_machines: 1.5 }],
    ['zero horizon', { horizon_steps: 0 }],
    ['fractional horizon', { horizon_steps: 1.5 }],
    ['zero failure threshold', { failure_threshold_um: 0 }],
    ['infinite failure threshold', { failure_threshold_um: Number.POSITIVE_INFINITY }],
    ['negative seed', { seed: -1 }],
    ['fractional seed', { seed: 1.25 }],
    ['numeric string seed', { seed: '42' }],
    ['negative cost', {
      costs: { ...makeEnvironmentConfig().costs, replacement_cost: -1 },
    }],
    ['NaN cost', {
      costs: { ...makeEnvironmentConfig().costs, failure_cost: Number.NaN },
    }],
    ['infinite cost', {
      costs: { ...makeEnvironmentConfig().costs, waiting_cost_per_step: Number.POSITIVE_INFINITY },
    }],
  ])('rejects numeric contract violation: %s', (_label, overrides) => {
    expect(environmentConfigSchema.safeParse(makeEnvironmentConfig(overrides)).success).toBe(false);
  });
});

describe('createExperimentSchema', () => {
  test('accepts and normalizes the camelCase request wrapper', () => {
    const parsed = createExperimentSchema.parse(makeCreateRequest({
      name: '  CNC baseline  ',
      description: '  Research run  ',
      policyKey: '  threshold-uncertainty  ',
    }));

    expect(parsed.name).toBe('CNC baseline');
    expect(parsed.description).toBe('Research run');
    expect(parsed.policyKey).toBe('threshold-uncertainty');
    expect(parsed.environmentConfig.schema_version).toBe('2.0');
    expect(parsed.environmentConfig.risk.cvar_alpha).toBe(0.95);
  });

  test.each([
    ['policyKey', ({ policyKey: _removed, ...request }) => request],
    ['policyVersion', ({ policyVersion: _removed, ...request }) => request],
  ])('rejects a missing %s', (_field, removeField) => {
    expect(createExperimentSchema.safeParse(removeField(makeCreateRequest())).success).toBe(false);
  });

  test.each([
    ['policyId', 'policy-db-id'],
    ['policy', { key: 'threshold-uncertainty', version: '1.0.0' }],
    ['unexpected', true],
  ])('rejects unknown request field %s', (field, value) => {
    expect(createExperimentSchema.safeParse({
      ...makeCreateRequest(),
      [field]: value,
    }).success).toBe(false);
  });

  test.each([0, 1.5, 1_001])('rejects episodeCount %s', (episodeCount) => {
    expect(createExperimentSchema.safeParse(makeCreateRequest({ episodeCount })).success).toBe(false);
  });

  test('allows the maximum PostgreSQL seed for one episode', () => {
    const result = createExperimentSchema.safeParse(makeCreateRequest({
      episodeCount: 1,
      environmentConfig: makeEnvironmentConfig({ seed: POSTGRES_INT_MAX }),
    }));

    expect(result.success).toBe(true);
  });

  test('rejects a base seed whose expanded episode range overflows PostgreSQL INTEGER', () => {
    const result = createExperimentSchema.safeParse(makeCreateRequest({
      episodeCount: 2,
      environmentConfig: makeEnvironmentConfig({ seed: POSTGRES_INT_MAX }),
    }));

    expect(result.success).toBe(false);
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ['environmentConfig', 'seed'],
        message: expect.stringContaining('must fit PostgreSQL INTEGER'),
      }),
    ]));
  });

  test('accepts the largest base seed for the maximum episode count and rejects the next one', () => {
    const largestValidBaseSeed = POSTGRES_INT_MAX - 999;
    const valid = createExperimentSchema.safeParse(makeCreateRequest({
      episodeCount: 1_000,
      environmentConfig: makeEnvironmentConfig({ seed: largestValidBaseSeed }),
    }));
    const invalid = createExperimentSchema.safeParse(makeCreateRequest({
      episodeCount: 1_000,
      environmentConfig: makeEnvironmentConfig({ seed: largestValidBaseSeed + 1 }),
    }));

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });
});

describe('pagination and filter schemas', () => {
  test('applies defaults and coerces HTTP query strings', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationSchema.parse({ page: '3', limit: '100' })).toEqual({ page: 3, limit: 100 });
  });

  test.each([
    { page: '0' },
    { page: '1.5' },
    { page: 'not-a-number' },
    { limit: '0' },
    { limit: '101' },
    { limit: 'Infinity' },
    { page: '1', limit: '20', cursor: 'unexpected' },
  ])('rejects invalid pagination %#', (query) => {
    expect(paginationSchema.safeParse(query).success).toBe(false);
  });

  test('supports separate experiment and episode status filters', () => {
    expect(experimentListQuerySchema.parse({ status: 'READY' })).toEqual({
      page: 1,
      limit: 20,
      status: 'READY',
    });
    expect(episodeListQuerySchema.parse({ status: 'PENDING', page: '2' })).toEqual({
      page: 2,
      limit: 20,
      status: 'PENDING',
    });
    expect(experimentListQuerySchema.safeParse({ status: 'PENDING' }).success).toBe(false);
    expect(episodeListQuerySchema.safeParse({ status: 'READY' }).success).toBe(false);
  });

  test('validates stable idempotency keys', () => {
    expect(idempotencyKeySchema.parse('  run:experiment-01.2  ')).toBe('run:experiment-01.2');
    expect(idempotencyKeySchema.safeParse('bad key').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});
