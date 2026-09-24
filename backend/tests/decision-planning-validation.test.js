const { validatePayload } = require('../src/services/operations-contract.service');

test.each([null, {}, { schema_version: '3.0', candidate_plans: [null] }])(
  'malformed AI recommendation %j is a validation error, not a validator outage', async recommendation => {
    await expect(validatePayload({ case_id: 'case-test', snapshot: {}, recommendation }, 'recommendation'))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_OPERATIONS_SCHEMA' });
  },
);
