jest.mock('../src/services/factory-access.service', () => ({ authorizeFactory: jest.fn() }));
jest.mock('../src/services/operations-contract.service', () => ({
  ...jest.requireActual('../src/services/operations-contract.service'),
  validatePayload: jest.fn(async value => value),
}));
const { authorizeFactory } = require('../src/services/factory-access.service');
const { contentHash } = require('../src/services/operations-contract.service');
const { projectSource } = require('../src/services/incident-source.service');
const evidence = require('../examples/incidents.json').evidence_examples.case_health_alert;
let tx, row, basis;
beforeEach(() => {
  jest.clearAllMocks();
  authorizeFactory.mockResolvedValue({ id: 'actor' });
  basis = { factory_id: evidence.factory_id, snapshot_id: evidence.basis_snapshot_id,
    machines: [{ machine_id: evidence.machine_id }], health_snapshots: evidence.health_samples };
  row = { id: evidence.case_id, factoryId: evidence.factory_id, snapshotId: evidence.basis_snapshot_id,
    createdAt: new Date(evidence.case_created_at), mode: 'LIVE',
    requestJson: { request: { mode: 'LIVE', trigger: { ...evidence.trigger, machine_id: evidence.machine_id } } } };
  row.requestHash = contentHash(row.requestJson);
  tx = { decisionCase: { findUnique: jest.fn(async () => row) },
    factorySnapshot: { findUnique: jest.fn(async () => ({ payloadJson: basis, contentHash: contentHash(basis) })) } };
});
const run = () => projectSource(tx, { id: 'actor' }, evidence.factory_id,
  { source: { type: 'case_health_alert', case_id: evidence.case_id } });
test('uses the reviewed evidence projector after source validation', async () => {
  expect((await run()).evidence).toEqual({ ...evidence, case_created_at: new Date(evidence.case_created_at).toISOString() });
});
test('denies scope before accessing immutable sources', async () => {
  authorizeFactory.mockRejectedValue({ statusCode: 404 });
  await expect(run()).rejects.toMatchObject({ statusCode: 404 });
  expect(tx.decisionCase.findUnique).not.toHaveBeenCalled();
});
test('tampered request cannot reach projection', async () => {
  row.requestJson.request.trigger.failure_probability = 0;
  await expect(run()).rejects.toMatchObject({ code: 'INCIDENT_INTEGRITY_ERROR' });
  expect(tx.factorySnapshot.findUnique).not.toHaveBeenCalled();
});
test('simulation is not an incident source', async () => {
  row.mode = 'SIMULATION_ONLY';
  await expect(run()).rejects.toMatchObject({ code: 'INCIDENT_SOURCE_INVALID' });
});
test('missing health samples stay empty and no sensor event time is invented', async () => {
  delete basis.health_snapshots;
  const result = (await run()).evidence;
  expect(result.health_samples).toEqual([]);
  expect(result.trigger).not.toHaveProperty('occurred_at');
  expect(result.trigger).not.toHaveProperty('event_id');
});
test('manual evidence is a report, not a physical recovery assertion', async () => {
  const body = { source: { type: 'manual', source_event_id: evidence.case_id }, description: 'Inspect equipment' };
  expect((await projectSource(tx, {}, evidence.factory_id, body)).evidence)
    .toEqual({ kind: 'manual', report_text: 'Inspect equipment' });
});
