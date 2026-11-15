jest.mock('../src/research/bridge', () => ({ bridge: jest.fn((...args) => require('./helpers/situation-bridge-double').bridge(...args)) }));
const { bridge } = require('../src/research/bridge');
const runtime = require('../src/research/demo-situation-runtime');
const fixture = require('../examples/demo-work-orders-trace.json').snapshots.completed;
const { projectHealth } = require('../src/research/demo-health');
const { rebaseProjection } = require('../src/research/demo-situations');
const orders = require('../src/research/demo-work-orders');
const id = '10000000-0000-4000-8000-000000000001';
const event = { eventId: '10000000-0000-4000-8000-000000000002', machineIndex: 2, componentIndex: 1,
  scheduledTick: 7, status: 'SCHEDULED', appliedTick: null, reason: null, requestedReason: 'Test',
  createdBy: id, createdAt: '2026-11-16T00:00:00.000Z' };
beforeEach(() => bridge.mockImplementation((...args) => require('./helpers/situation-bridge-double').bridge(...args)));
test('restore rejects any physical/counter mutation and maps unavailable bridge', async () => {
  const p = structuredClone(fixture); p.primary.state.components[0][0].age++;
  bridge.mockResolvedValueOnce({ protocol: runtime.protocol, session: p });
  await expect(runtime.restore({ runtime: fixture })).rejects.toMatchObject({ code: 'DEMO_SCENARIO_INVALID_OUTPUT' });
  bridge.mockRejectedValueOnce({ code: 'JCST_VALIDATION_FAILED' });
  await expect(runtime.restore({ runtime: fixture })).rejects.toMatchObject({ statusCode: 503 });
});
test('structured missing release stays coded; malformed output never accepted', async () => {
  bridge.mockResolvedValueOnce({ protocol: runtime.protocol, error: { code: 'DEMO_RELEASE_UNAVAILABLE' } });
  await expect(runtime.restore({ runtime: fixture })).rejects.toMatchObject({ code: 'DEMO_RELEASE_UNAVAILABLE', statusCode: 409 });
  bridge.mockResolvedValueOnce({ session: fixture });
  await expect(runtime.restore({ runtime: fixture })).rejects.toMatchObject({ statusCode: 502 });
});
test('zero-time intervention does not rewrite natural trace and health reports its own provenance', async () => {
  const r = await runtime.incident(fixture, event);
  expect(r.event.status).toBe('APPLIED'); expect(r.session.primary.records).toEqual(fixture.primary.records);
  const health = projectHealth({ id, revision: 1, payloadJson: r.session }, 2);
  expect(health.machineStatus).toBe('BREAKDOWN'); expect(health.components[1].failureRisk).toBeNull();
  expect(health.history.events.find(e => e.eventId === event.eventId)).toMatchObject({ provenance: 'CONTROLLED_INCIDENT', tick: 7 });
});
test('incident cannot mutate baseline, age, tick, IDs or pretend to skip a healthy target', async () => {
  const good = await runtime.incident(fixture, event);
  for (const mutate of [r => r.session.baseline.state.tick++, r => r.session.primary.state.components[0][0].age++,
    r => r.event.createdBy = '10000000-0000-4000-8000-000000000003', r => r.event.status = 'SKIPPED']) {
    const r = structuredClone({ protocol: runtime.protocol, ...good }); mutate(r); bridge.mockResolvedValueOnce(r);
    await expect(runtime.incident(fixture, event)).rejects.toMatchObject({ statusCode: 502 });
  }
});
test('reopened projection rebases every retained event identity without losing evicted history', () => {
  const projection = orders.project(id, fixture), newId = '10000000-0000-4000-8000-000000000004';
  const rebased = rebaseProjection(projection, id, newId);
  expect(Object.keys(rebased.orders)).toHaveLength(Object.keys(projection.orders).length);
  const health = projectHealth({ id: newId, revision: 0, payloadJson: fixture }, 2);
  const order = Object.values(rebased.orders).find(o => o.machineIndex === 2);
  expect(health.history.events.map(e => e.eventId)).toContain(order.startEventId);
  expect(projection).toEqual(orders.project(id, fixture));
});
test('terminal outcomes cannot be overwritten and due events cannot be silently lost', async () => {
  const applied = await runtime.incident(fixture, event);
  const out = await require('./helpers/situation-bridge-double').bridge({ operation: 'demo_situation_command', session: applied.session, command: { command: 'advance' } });
  out.session.incidents[0].status = 'SKIPPED'; out.session.incidents[0].reason = 'MACHINE_IN_SERVICE';
  bridge.mockResolvedValueOnce(out);
  await expect(runtime.command(applied.session, { command: 'advance' }, id)).rejects.toMatchObject({ statusCode: 502 });
});
