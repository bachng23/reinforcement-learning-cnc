const crypto = require('node:crypto');
jest.mock('../src/research/bridge', () => ({ bridge: jest.fn((...args) => require('./helpers/technician-bridge-double').bridge(...args)) }));
const { bridge } = require('../src/research/bridge');
const state = require('../src/research/demo-technician-state');
const api = require('../src/research/demo-technicians');
const runtime = require('../src/research/demo-situation-runtime');
const examples = require('../examples/demo-work-orders-trace.json').snapshots;
function absent() {
  const p = structuredClone(examples.beforeApproval), eventId = crypto.randomUUID();
  p.technicianAvailability = { schemaVersion: state.version, version: 1, absences: [{ eventId, automaticEndEventId: crypto.randomUUID(),
    technicianIndex: 0, startTick: 5, returnTick: 7, endedTick: null, endedByEventId: null }], events: [{ eventId, technicianIndex: 0,
    type: 'ABSENCE_STARTED', tick: 5, actor: { type: 'USER', userId: crypto.randomUUID() }, reason: 'Break' }],
    origin: { eventId, tick: 5, workforceVersion: 1 } };
  p.pending = null; p.status = 'RUNNING'; return p;
}
beforeEach(() => bridge.mockImplementation((...args) => require('./helpers/technician-bridge-double').bridge(...args)));
test('legacy jobs determine availability; defaults never mutate source', () => {
  const before = structuredClone(examples.inProgress);
  expect(state.technicians(before).map(t => t.availability)).toContain('BUSY');
  expect(state.technicians(examples.beforeApproval).map(t => t.availability)).toEqual(['AVAILABLE', 'AVAILABLE']);
  expect(before).toEqual(examples.inProgress);
});
test('half-open return boundary must close using its preallocated system event', async () => {
  const p = absent();
  const next = await runtime.command(p, { command: 'autoplay', maxTicks: 2, stopAt: 'complete' }, crypto.randomUUID());
  expect(next.primary.state.tick).toBe(7); expect(state.technicians(next)[0].availability).toBe('AVAILABLE');
  expect(next.technicianAvailability.events.at(-1)).toMatchObject({ type: 'ABSENCE_ENDED', tick: 7, actor: { type: 'SYSTEM', userId: null } });
  expect(next.technicianAvailability.version).toBe(1);
});
test('malformed/overlapping metadata is rejected; config matrix length is authoritative', () => {
  for (const mutate of [p => p.technicianAvailability.absences[0].returnTick = 5,
    p => p.technicianAvailability.events[0].actor = { type: 'SYSTEM', userId: null },
    p => p.technicianAvailability.version = 9, p => p.config.duration[0][0].pop()]) {
    const p = absent(); mutate(p); expect(() => state.metadata(p)).toThrow();
  }
});
test('new dispatch or a pending proposal containing absent technicians is rejected', async () => {
  const p = absent();
  const output = await require('./helpers/technician-bridge-double').bridge({ operation: 'demo_technician_command', session: p, command: { command: 'advance' } });
  output.session.primary.records.at(-1).action = [[0, 0, 0]];
  bridge.mockResolvedValueOnce(output);
  await expect(runtime.command(p, { command: 'advance' }, crypto.randomUUID())).rejects.toMatchObject({ statusCode: 502 });
});
test('runtime cannot drop the calendar or offer a REVIEW without WAIT', async () => {
  const p = absent();
  const good = await require('./helpers/technician-bridge-double').bridge({ operation: 'demo_technician_command', session: p, command: { command: 'advance' } });
  for (const mutate of [r => { delete r.session.technicianAvailability; }, r => {
    r.session.status = 'REVIEW'; r.session.pending = { action: [], baseline_action: [], catalogue: [[[0, 0, 1]]] };
  }]) {
    const bad = structuredClone(good); mutate(bad); bridge.mockResolvedValueOnce(bad);
    await expect(runtime.command(p, { command: 'advance' }, crypto.randomUUID())).rejects.toMatchObject({ statusCode: 502 });
  }
});
test('session restore and command use availability-aware protocol and fail closed on old bridge', async () => {
  bridge.mockRejectedValueOnce({ code: 'JCST_VALIDATION_FAILED' });
  await expect(runtime.restore({ runtime: absent() })).rejects.toMatchObject({ code: 'TECHNICIAN_RUNTIME_UNAVAILABLE', statusCode: 503 });
  const p = absent(); expect(await runtime.restore({ runtime: p })).toEqual(p);
  expect(bridge.mock.calls.at(-1)[0]).toMatchObject({ protocol: api.protocol, operation: 'demo_technician_restore' });
});
test('comparison key changes with calendar and branch identity; reads stay stable', () => {
  const p = absent(), row = { id: crypto.randomUUID(), revision: 10, payloadJson: p };
  const before = state.present(row); expect(state.present(row)).toEqual(before);
  expect(before.comparisonContext).toMatchObject({ workforceVersion: 1, requiresCommonSnapshot: true });
  expect(state.present({ ...row, id: crypto.randomUUID() }).comparisonContext.cacheIdentity).not.toBe(before.comparisonContext.cacheIdentity);
});
