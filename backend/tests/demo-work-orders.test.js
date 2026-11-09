const { project, present, eventId } = require('../src/research/demo-work-orders');
const { snapshots } = require('../examples/demo-work-orders-trace.json');
const id = '00000000-0000-4000-8000-000000000001';
const start = (tick = 0, kind = 'CM') => ({ type: 'start', tick, machine: 0, component: 0, technician: 0, kind, duration: 1 });
const completion = (tick = 1, kind = 'CM') => ({ ...start(tick, kind), type: 'completion' });
const failure = tick => ({ type: 'failure', tick, machine: 0, component: 0 });
const payload = records => ({ primary: { records, state: { tick: (records.at(-1)?.tick ?? -1) + 1, jobs: [null] } }, decisions: [] });

test('Backend 1 t7 fixture identities match failure/start/completion including original occupancy ordinal', () => {
  // origin/feat/jcst-machine-health eff27fe, backend/tests/fixtures/machine-health/t7.json.
  const sessionId = 'd549829e-27cc-4f33-855e-100000000001';
  const p = project(sessionId, snapshots.completed);
  const order = Object.values(p.orders).find(o => o.machineIndex === 2);
  expect(order).toMatchObject({
    failureEventId: 'je1_WyJkNTQ5ODI5ZS0yN2NjLTRmMzMtODU1ZS0xMDAwMDAwMDAwMDEiLCJwcmltYXJ5Iiw0LDBd',
    startEventId: 'je1_WyJkNTQ5ODI5ZS0yN2NjLTRmMzMtODU1ZS0xMDAwMDAwMDAwMDEiLCJwcmltYXJ5Iiw1LDBd',
    completionEventId: 'je1_WyJkNTQ5ODI5ZS0yN2NjLTRmMzMtODU1ZS0xMDAwMDAwMDAwMDEiLCJwcmltYXJ5Iiw2LDRd',
  });
});

test('real-engine review/t6/t7: one stable M3 order, exact remaining and completion', () => {
  const before = project(id, snapshots.beforeApproval);
  expect(Object.values(before.orders).filter(o => o.machineIndex === 2)).toHaveLength(0);
  const doing = project(id, snapshots.inProgress, before, { name: 'approve', fromTick: 5 });
  const orders = Object.values(doing.orders).filter(o => o.machineIndex === 2);
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ startedTick: 5, plannedDurationTicks: 2, remainingTicks: 1,
    status: 'IN_PROGRESS', assignmentSource: 'MANUAL_APPROVAL', waitTicks: 0, decisionTick: 5 });
  const done = project(id, snapshots.completed, doing, { name: 'approve', fromTick: 6 });
  expect(done.orders[orders[0].startEventId]).toMatchObject({ workOrderId: orders[0].workOrderId,
    status: 'COMPLETED', completedTick: 7, remainingTicks: 0 });
  expect(project(id, snapshots.completed, done)).toEqual(done);
});

test('tick zero, start+completion in same interval, repeat failures have distinct IDs', () => {
  const p = project(id, payload([{ tick: 0, events: [failure(0), start(), completion()] },
    { tick: 1, events: [failure(1), start(1), completion(2)] }]));
  const orders = Object.values(p.orders);
  expect(orders).toHaveLength(2);
  expect(orders.every(o => o.status === 'COMPLETED' && o.waitTicks === 0)).toBe(true);
  expect(orders[0].failureEventId).not.toBe(orders[1].failureEventId);
  expect(orders[0].workOrderId).not.toBe(orders[1].workOrderId);
  expect(orders[0].startedTick).toBe(0);
});

test('PM automatic and multiple assignments in one decision; empty defer creates nothing', () => {
  const a = start(0, 'PM'), b = { ...start(0, 'PM'), machine: 1, technician: 1 };
  const s = payload([{ tick: 0, events: [a, b] }]);
  s.decisions = [{ tick: 0, actor: 'automatic', action: [[0, 0, 0], [1, 0, 1]] }];
  const p = project(id, s);
  expect(Object.values(p.orders)).toHaveLength(2);
  for (const o of Object.values(p.orders)) expect(o).toMatchObject({ assignmentSource: 'AUTOMATIC', waitTicks: null, decisionTick: 0 });
  expect(Object.values(project(id, payload([{ tick: 0, events: [] }])).orders)).toHaveLength(0);
});

test('explicit override source does not depend on whether matching changed', () => {
  const s = payload([{ tick: 0, events: [start()] }]);
  s.decisions = [{ tick: 0, actor: 'human', action: [[0, 0, 0]], override: false }];
  expect(Object.values(project(id, s, null, { name: 'override', fromTick: 0 }).orders)[0].assignmentSource).toBe('OVERRIDE');
});

test('rolling trace preserves orders and unresolved failure without reprocessing', () => {
  const p = project(id, payload([{ tick: 0, events: [failure(0)] }]));
  const q = project(id, payload([{ tick: 1, events: [start(1), completion(2)] }]), p);
  expect(Object.values(q.orders)[0].waitTicks).toBe(1);
  const r = project(id, payload([{ tick: 2, events: [start(2), completion(3)] }]), q);
  expect(Object.values(r.orders)[1].failureEventId).toBeNull();
  expect(Object.values(r.orders)[1].waitTicks).toBeNull();
  expect(Object.values(q.orders)).toHaveLength(1);
});

test('completion only closes matching tuple, never a different component on the machine', () => {
  const p = project(id, payload([{ tick: 0, events: [start(), { ...completion(), component: 1 }] }]));
  expect(Object.values(p.orders)[0].status).toBe('IN_PROGRESS');
  expect(p.historyCoverage).toBe('PARTIAL');
});

test('completed repair remains completed when another component on that machine fails', () => {
  const p = project(id, payload([{ tick: 0, events: [start(),
    { ...failure(1), component: 1 }, completion()] }]));
  expect(Object.values(p.orders)[0].status).toBe('COMPLETED');
  expect(p.failures['0:1'].tick).toBe(1);
});

test('event identity uses original ordinal and interval, never filtered position or boundary tick', () => {
  const p = project(id, payload([{ tick: 0, events: [start(),
    { type: 'occupancy', tick: 0, machine: 0, component: 0, technician: 0 }, completion()] }]));
  expect(Object.values(p.orders)[0].completionEventId).toBe(eventId(id, 0, 2));
});

test('legacy reads are pure, partial trace cannot fabricate orders or failure evidence', () => {
  const row = { id, revision: 8, payloadJson: payload([{ tick: 8, events: [completion(9), start(8)] }]) };
  const original = structuredClone(row);
  const result = present(row);
  expect(result.historyCoverage).toBe('PARTIAL');
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ assignmentSource: 'UNKNOWN', failureEventId: null, waitTicks: null });
  expect(row).toEqual(original);
  expect(present(row)).toEqual(result);
});

test('gap in new command fails closed; sort/filter stable and baseline ignored', () => {
  const p = project(id, payload([{ tick: 0, events: [] }]));
  expect(() => project(id, payload([{ tick: 2, events: [start(2)] }]), p)).toThrow('trace gap');
  const s = payload([{ tick: 0, events: [start(), { ...start(), machine: 1, technician: 1 }] }]);
  s.baseline = { records: [{ tick: 0, events: [start()] }] };
  const row = { id, revision: 1, payloadJson: s };
  expect(present(row, { limit: 1 })).toMatchObject({ total: 2, items: [{ machineIndex: 1 }] });
  expect(present(row, { machineIndex: 0 }).items).toHaveLength(1);
  expect(JSON.parse(Buffer.from(eventId(id, 0, 0).slice(4), 'base64url').toString())).toEqual([id, 'primary', 0, 0]);
});
