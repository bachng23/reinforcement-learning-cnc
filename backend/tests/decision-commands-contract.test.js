const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { commandSchema, humanRequest } = require('../src/services/decision-command.service');
const { validatePayload } = require('../src/services/operations-contract.service');
const examples = require('../examples/decision-commands.json');
const api = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '../openapi.yaml'), 'utf8'));

test.each(['APPROVE', 'REJECT', 'COMMIT'])('%s OpenAPI and checked-in examples satisfy the strict write contract', command => {
  const post = api.paths['/decision-cases/{id}/decision'].post;
  expect(commandSchema.parse(examples.requests[command])).toEqual(examples.requests[command]);
  expect(post.requestBody.content['application/json'].examples[command].value).toEqual(examples.requests[command]);
  expect(post.responses[200].content['application/json'].examples[command].value).toEqual(examples.responses[command]);
  expect(post.parameters.find(p => p.name === 'Idempotency-Key')).toMatchObject({ required: true });
  expect(post.responses[200].headers).toHaveProperty('Idempotency-Replayed');
});
test.each(['APPROVE', 'REJECT'])('%s maps to canonical HumanDecisionRequest without confusing head and candidate version', async command => {
  const mapped = humanRequest(examples.requests[command]);
  expect((await validatePayload(mapped, 'human-decision')).decision).toBe(command);
  if (command === 'APPROVE') {
    expect(mapped.expected_plan_version).toBe(17);
    expect(examples.requests[command].expected_plan_version).toBe(0);
  } else expect(mapped).not.toHaveProperty('candidate_plan_id');
});
test.each(['APPROVE', 'REJECT', 'COMMIT'])('%s response data preserves canonical status DTO', async command => {
  const parsed = await validatePayload(examples.responses[command].data, 'case-status');
  expect(parsed).toMatchObject({ status: examples.responses[command].data.status,
    committed_schedule_id: examples.responses[command].data.committed_schedule_id });
  expect(new Date(parsed.updated_at)).toEqual(new Date(examples.responses[command].data.updated_at));
});
test('rejects ambiguous old client DTO, MODIFY, server-owned fields and omitted tokens', () => {
  expect(commandSchema.safeParse({ command: 'APPROVE', expected_snapshot_id: 'snapshot', expected_plan_version: 0,
    expected_case_revision: 6, candidate_revision: 1 }).success).toBe(false);
  for (const field of ['decision_case_id', 'recommendation_id', 'expected_case_revision', 'expected_plan_version', 'candidate_plan_id', 'candidate_version']) {
    const body = { ...examples.requests.APPROVE }; delete body[field];
    expect(commandSchema.safeParse(body).success).toBe(false);
  }
  for (const change of [{ command: 'MODIFY' }, { actor_id: 'someone' }, { candidate_revision: 1 }, { reason: 'why' }, { expected_plan_version: -1 }])
    expect(commandSchema.safeParse({ ...examples.requests.APPROVE, ...change }).success).toBe(false);
});
test('read endpoints document decision provenance without modifying canonical enums', () => {
  const meta = api.components.schemas.DecisionCaseResponse.properties.meta.properties;
  for (const field of ['approved_candidate', 'human_decision', 'available_commands', 'commit']) expect(meta).toHaveProperty(field);
  const commit = api.paths['/schedules/current'].get.responses[200].content['application/json'].schema.properties.data.properties.commit;
  expect(commit.anyOf[0].$ref).toBe('#/components/schemas/DecisionCommitMetadata');
  const canonical = require('../../contracts/v3/operations-domain.schema.json').$defs;
  expect(canonical.HumanDecisionType.enum).not.toContain('COMMIT');
});
