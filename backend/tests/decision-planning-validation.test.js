const { validatePayload } = require('../src/services/operations-contract.service');

test.each([null, {}, { schema_version: '3.0', candidate_plans: [null] }])(
  'malformed AI recommendation %j is a validation error, not a validator outage', async recommendation => {
    await expect(validatePayload({ case_id: 'case-test', snapshot: {}, recommendation }, 'persisted-recommendation'))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_OPERATIONS_SCHEMA' });
  },
);

test('raw planner recommendations and persisted recommendations have separate validation modes', async () => {
  const snapshot = structuredClone(require('../../contracts/v3/fixtures/demo-health-alert.json').factory_snapshot);
  const candidate = structuredClone(require('../../contracts/v3/examples/demo-scenario.json').candidate_plans[0]);
  candidate.schema_version = '3.0';
  candidate.decision_case_id = 'case-mode-regression';
  candidate.snapshot_id = snapshot.snapshot_id;
  candidate.schedule = structuredClone(snapshot.current_schedule);
  candidate.validation = { schema_version: '3.0', validation_id: 'validation-mode-test',
    candidate_plan_id: candidate.candidate_plan_id, validator_version: 'operations-validator-v1',
    verdict: 'VALID', validated_at: candidate.generated_at, violations: [] };
  const raw = { schema_version: '3.0', recommendation_id: 'rec-mode-test', decision_case_id: candidate.decision_case_id,
    snapshot_id: snapshot.snapshot_id, generated_at: candidate.generated_at, recommended_plan_id: candidate.candidate_plan_id,
    candidate_plans: [candidate], explanation: { summary: 'Valid plan', primary_reasons: ['Feasible'],
      tradeoffs: ['No changes'], residual_risks: [], evidence_refs: [snapshot.snapshot_id] } };
  const wire = await validatePayload(raw, 'recommendation');
  const wrapped = { case_id: raw.decision_case_id, snapshot, recommendation: raw };
  expect(await validatePayload(wrapped, 'persisted-recommendation')).toEqual(wire);
  await expect(validatePayload(wrapped, 'recommendation')).rejects.toMatchObject({ statusCode: 400 });
  await expect(validatePayload(raw, 'persisted-recommendation')).rejects.toMatchObject({ statusCode: 400 });
  await expect(validatePayload({ ...wrapped, case_id: 'wrong-case' }, 'persisted-recommendation')).rejects.toMatchObject({ statusCode: 400 });
  const invalid = structuredClone(raw);
  invalid.candidate_plans[0].schedule.assignments[0].machine_id = 'unknown-machine';
  // Wire contract validation remains backward compatible; persistence additionally checks semantics.
  expect((await validatePayload(invalid, 'recommendation')).recommendation_id).toBe(raw.recommendation_id);
  await expect(validatePayload({ ...wrapped, recommendation: invalid }, 'persisted-recommendation')).rejects.toMatchObject({ statusCode: 400 });
});
