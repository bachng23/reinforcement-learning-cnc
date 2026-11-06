const { evidenceSchema, projectCaseEvidence } = require('../src/services/incident-evidence');
const examples = require('../examples/incidents.json').evidence_examples;
const fs = require('fs'), yaml = require('js-yaml'), path = require('path');
const api = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '../docs/incidents.openapi.yaml'), 'utf8'));
const e = examples.case_health_alert;
const source = () => ({ caseId: e.case_id, factoryId: e.factory_id, mode: 'LIVE', createdAt: e.case_created_at,
  trigger: { ...e.trigger, machine_id: e.machine_id, private_note: 'SECRET' },
  snapshot: { factory_id: e.factory_id, snapshot_id: e.basis_snapshot_id, machines: [{ machine_id: e.machine_id }],
    health_snapshots: [{ ...e.health_samples[0], raw: 'SECRET' }, { ...e.health_samples[0], machine_id: 'OTHER' }] } });
test('examples match strict evidence schemas and OpenAPI field sets', () => {
  for (const [key, schema] of [['manual','ManualIncidentEvidence'], ['case_health_alert','CaseHealthAlertEvidence']]) {
    evidenceSchema.parse(examples[key]);
    expect(Object.keys(examples[key]).sort()).toEqual(api.components.schemas[schema].required.slice().sort());
    expect(api.components.schemas[schema].additionalProperties).toBe(false);
  }
  expect(Object.keys(e.health_samples[0]).sort()).toEqual(api.components.schemas.IncidentHealthEvidence.required.slice().sort());
});
test('projection retains actual provenance but excludes raw and unrelated-machine values', () => {
  const input = source(), before = structuredClone(input);
  expect(projectCaseEvidence(input)).toEqual(e);
  expect(input).toEqual(before);
  expect(JSON.stringify(projectCaseEvidence(input))).not.toContain('SECRET');
});
test('missing health stays empty, never fabricated healthy/zero values or timestamps', () => {
  const input = source(); input.snapshot.health_snapshots = [];
  const result = projectCaseEvidence(input);
  expect(result.health_samples).toEqual([]);
  expect(result.trigger).not.toHaveProperty('occurred_at'); expect(result.trigger).not.toHaveProperty('event_id');
});
test.each(['simulation','factory','machine','trigger','threshold'])('rejects invalid %s source', kind => {
  const input = source();
  if (kind === 'simulation') input.mode = 'SIMULATION_ONLY';
  if (kind === 'factory') input.snapshot.factory_id = 'another';
  if (kind === 'machine') input.snapshot.machines = [];
  if (kind === 'trigger') input.trigger.type = 'MANUAL_REPLAN';
  if (kind === 'threshold') input.trigger.failure_probability = 0.1;
  expect(() => projectCaseEvidence(input)).toThrow(expect.objectContaining({ code: 'INCIDENT_SOURCE_INVALID' }));
});
test('strict evidence refuses arbitrary fields and invalid probabilities', () => {
  expect(() => evidenceSchema.parse({ ...examples.manual, raw_request: {} })).toThrow();
  expect(() => evidenceSchema.parse({ ...e, trigger: { ...e.trigger, failure_probability: 2 } })).toThrow();
});
