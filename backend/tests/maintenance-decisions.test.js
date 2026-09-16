process.env.JWT_SECRET = 'maintenance-test-secret';
jest.mock('../src/config/prisma', () => ({
  user: { findUnique: jest.fn() },
  maintenanceDecision: { findFirst: jest.fn(), updateMany: jest.fn(), upsert: jest.fn() },
  maintenanceDecisionAction: { create: jest.fn() }, auditLog: { create: jest.fn() },
  policyRecommendation: { findFirst: jest.fn() }, $transaction: jest.fn(),
}));
const db = require('../src/config/prisma');
const { decide } = require('../src/services/maintenance-decision.service');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const id = '84f17b7f-250e-4b68-af93-338cff87bd12';
const user = { id, role: 'OPERATOR', active: true };
const actions = { schema_version: '2.0', observation_id: 'obs', actions: [{ machine_id: 'm1', action: 'CONTINUE' }] };
const replacementAction = { ...actions, actions: [{ machine_id: 'm1', action: 'REPLACE' }] };
let current, server, base;
beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1/maintenance/decisions`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  jest.clearAllMocks();
  current = { id, status: 'PENDING_REVIEW', recommendation: {
    id, policyId: id, schemaVersion: '2.0', payloadJson: { actions, estimated_cvar_cost: 12 },
    observation: { observationKey: 'obs', payloadJson: { machines: [{ machine_id: 'm1', risk: 0.7 }] },
      episode: { experiment: { environmentConfig: { risk: { objective: 'CVAR' } } } } },
  } };
  db.user.findUnique.mockResolvedValue(user);
  db.$transaction.mockImplementation(async (fn) => fn(db));
  db.maintenanceDecision.findFirst.mockImplementation(async () => current);
  db.maintenanceDecision.updateMany.mockResolvedValue({ count: 1 });
  db.maintenanceDecisionAction.create.mockImplementation(async ({ data }) => ({ id, ...structuredClone(data) }));
  db.auditLog.create.mockResolvedValue({ id });
});
test.each(['APPROVED', 'OVERRIDDEN', 'REJECTED'])('pending transitions to %s with actor and snapshots', async (to) => {
  const result = await decide(db, { id, user, to, body: to === 'OVERRIDDEN' ? { replacementAction, reason: 'Inspect tool first' } : {} });
  expect(result.status).toBe(to);
  expect(result.action.actorUserId).toBe(user.id);
  expect(Number.isFinite(result.action.createdAt.getTime())).toBe(true);
  expect(result.action.recommendationSnapshot.payload.estimated_cvar_cost).toBe(12);
  current.recommendation.payloadJson.estimated_cvar_cost = 999;
  expect(result.action.recommendationSnapshot.payload.estimated_cvar_cost).toBe(12);
  expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: id, createdAt: result.action.createdAt }) });
});
test.each(['APPROVED', 'OVERRIDDEN', 'REJECTED'].flatMap((from) => ['APPROVED', 'OVERRIDDEN', 'REJECTED'].map((to) => [from, to])))('%s cannot transition to %s', async (from, to) => {
  current.status = from;
  await expect(decide(db, { id, user, to, body: to === 'OVERRIDDEN' ? { replacementAction, reason: 'Reason' } : {} })).rejects.toMatchObject({ statusCode: 409 });
  expect(db.maintenanceDecisionAction.create).not.toHaveBeenCalled();
});
test.each([{}, { reason: 'why' }, { replacementAction }, { replacementAction, reason: '  ' }, { replacementAction: actions, reason: 'same' }, { replacementAction: { ...replacementAction, observation_id: 'wrong' }, reason: 'why' }])('invalid override is rejected: %j', async (body) => {
  await expect(decide(db, { id, user, to: 'OVERRIDDEN', body })).rejects.toMatchObject({ statusCode: 400 });
  expect(db.maintenanceDecision.updateMany).not.toHaveBeenCalled();
});
test('concurrent loser cannot append history', async () => {
  db.maintenanceDecision.updateMany.mockResolvedValue({ count: 0 });
  await expect(decide(db, { id, user, to: 'APPROVED', body: {} })).rejects.toMatchObject({ statusCode: 409 });
  expect(db.maintenanceDecisionAction.create).not.toHaveBeenCalled();
});
async function request(verb, role, body) {
  db.user.findUnique.mockResolvedValue({ ...user, role });
  return fetch(`${base}/${id}/${verb}`, { method: verb === 'history' ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json' },
    ...(verb === 'history' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
}
test.each(['approve', 'override', 'reject'])('VIEWER forbidden from %s', async (verb) => {
  expect((await request(verb, 'VIEWER')).status).toBe(403);
  expect(db.$transaction).not.toHaveBeenCalled();
});
test.each(['OPERATOR', 'ENGINEER', 'ADMIN'].flatMap((role) => ['approve', 'override', 'reject'].map((verb) => [role, verb])))('%s can %s via authenticated HTTP', async (role, verb) => {
  const response = await request(verb, role, verb === 'override' ? { replacementAction, reason: 'Operator assessment' } : {});
  expect(response.status).toBe(200);
  expect((await response.json()).data.action.actorUserId).toBe(id);
});
test('VIEWER reads history, unauthorized requests fail', async () => {
  expect((await request('history', 'VIEWER')).status).toBe(200);
  expect((await fetch(`${base}/${id}/history`)).status).toBe(401);
});
test('foreign or missing decision returns 404 with owner scope', async () => {
  db.maintenanceDecision.findFirst.mockResolvedValue(null);
  expect((await request('approve', 'OPERATOR')).status).toBe(404);
  expect(db.maintenanceDecision.findFirst.mock.calls[0][0].where.recommendation.observation.episode).toMatchObject({ experiment: { createdById: id } });
});
