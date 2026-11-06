const { recoverWorkOrder } = require('../src/services/work-order-recovery-policy');
const now = new Date('2026-10-23T00:00:00Z');
const old = '10000000-0000-4000-8000-000000000001', replacement = '10000000-0000-4000-8000-000000000002';
const actor = { id: '10000000-0000-4000-8000-000000000003', role: 'ENGINEER', active: true };
const order = { status: 'IN_PROGRESS', revision: 4, attempt: 1, assigneeUserId: old, actualStartedAt: new Date('2026-10-22'), latestCompletion: { reportedBy: old, report: 'Immutable old report' } };
const hold = { command: 'MANAGER_HOLD', expected_revision: 4, reason: 'Assignee access lost' };
const rework = { command: 'REASSIGN_FOR_REWORK', expected_revision: 4, assignee_user_id: replacement, reason: 'Inspection requires rework' };
const assignee = { id: replacement, role: 'OPERATOR', active: true, factoryAuthorized: true };
const fail = (fn, code) => { try { fn(); throw new Error('Expected error'); } catch (e) { expect(e.code).toBe(code); } };
test.each(['inactive', 'revoked'])('manager can hold after old assignee is %s without restoring old access', () => {
  const input = structuredClone(order), before = structuredClone(input);
  const r = recoverWorkOrder(input, hold, actor, { now });
  expect(r.patch.status).toBe('BLOCKED'); expect(r.patch.blocker).toBe(hold.reason); expect(r.event.actorId).toBe(actor.id);
  expect(r.patch).not.toHaveProperty('actualStartedAt'); expect(r.patch).not.toHaveProperty('assigneeUserId');
  expect(input).toEqual(before);
});
test('independent manager assigns rework without altering old completion or start', () => {
  const completed = { ...order, status: 'COMPLETED' }, before = structuredClone(completed);
  const r = recoverWorkOrder(completed, rework, actor, { now, assignee });
  expect(r.patch).toMatchObject({ status: 'ASSIGNED', attempt: 2, actualCompletedAt: null, assigneeUserId: replacement });
  expect(r.patch).not.toHaveProperty('latestCompletion'); expect(r.patch).not.toHaveProperty('actualStartedAt');
  expect(completed).toEqual(before);
});
test.each(['OPERATOR', 'VIEWER'])('%s cannot perform manager recovery', role => fail(() => recoverWorkOrder(order, hold, { ...actor, role }, { now }), 'FORBIDDEN'));
test('inactive manager and stale revision are rejected', () => {
  fail(() => recoverWorkOrder(order, hold, { ...actor, active: false }, { now }), 'UNAUTHORIZED');
  fail(() => recoverWorkOrder(order, { ...hold, expected_revision: 3 }, actor, { now }), 'WORK_ORDER_REVISION_CONFLICT');
});
test.each(['UNASSIGNED','ASSIGNED','ACCEPTED','BLOCKED','COMPLETED','CLOSED','CANCELLED'])('hold cannot bypass %s state', status => fail(() => recoverWorkOrder({ ...order, status }, hold, actor, { now }), 'WORK_ORDER_STATE_CONFLICT'));
test('rework cannot impersonate verifier or target an ineligible assignee', () => {
  const completed = { ...order, status: 'COMPLETED' };
  fail(() => recoverWorkOrder(completed, rework, { ...actor, id: old }, { now, assignee }), 'WORK_ORDER_INDEPENDENT_VERIFICATION_REQUIRED');
  for (const target of [{ ...assignee, active: false }, { ...assignee, factoryAuthorized: false }, { ...assignee, role: 'VIEWER' }]) {
    fail(() => recoverWorkOrder(completed, rework, actor, { now, assignee: target }), 'ASSIGNEE_UNAVAILABLE');
  }
});
test('strict request rejects blank reason or forged actor/time', () => {
  for (const input of [{ ...hold, reason: ' ' }, { ...hold, actor_id: old }, { ...hold, actual_started_at: now.toISOString() }]) fail(() => recoverWorkOrder(order, input, actor, { now }), 'VALIDATION_ERROR');
});
