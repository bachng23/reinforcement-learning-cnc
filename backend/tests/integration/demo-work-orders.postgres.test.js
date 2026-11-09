const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../../src/config/prisma');
const app = require('../../src/app');
const demo = require('../../src/research/demo-service');
let server, base, owner, other, admin;
async function request(path, user = owner, body, key = randomUUID()) {
  const r = await fetch(base + '/api/v1/research/demo/sessions' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
      ...(user ? { Authorization: 'Bearer ' + jwt.sign({ id: user.id }, process.env.JWT_SECRET) } : {}),
      'Idempotency-Key': key }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function create() {
  const r = await request('', owner, { case: 'base', seed: '990000001', mode: 'policy', primary: 'corrective', baseline: 'wait', continuous: true });
  expect(r.status).toBe(201); return r.body.data;
}
async function cmd(s, body, key) {
  return request(`/${s.id}/commands`, owner, { revision: s.revision, ...body }, key);
}
async function review() {
  let s = await create();
  while (s.primary.state.tick < 5 || s.status !== 'REVIEW') {
    const r = await cmd(s, s.status === 'REVIEW' ? { command: 'approve', reason: 'Defer preventive action' } : { command: 'advance' });
    expect(r.status).toBe(200); s = r.body.data;
  }
  return s;
}
beforeAll(async () => {
  for (const role of ['ENGINEER', 'VIEWER', 'ADMIN']) {
    const u = await prisma.user.create({ data: { username: `wo-${randomUUID()}`, passwordHash: 'test', role } });
    if (role === 'ENGINEER') owner = u; else if (role === 'ADMIN') admin = u; else other = u;
  }
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

test('real simulator approval, duplicate, stale and stable completion; GET never writes', async () => {
  let s = await review();
  expect((await request(`/${s.id}/work-orders?machineIndex=2`)).body.data.items).toEqual([]);
  const key = randomUUID(), body = { command: 'approve', reason: 'Approve T2 repair' };
  const [first, duplicate] = [await cmd(s, body, key), await cmd(s, body, key)];
  expect(first.status).toBe(200); expect(duplicate.body.data.revision).toBe(first.body.data.revision);
  expect((await cmd(s, body)).status).toBe(409);
  s = first.body.data;
  const beforeRead = await prisma.demoSession.findUnique({ where: { id: s.id } });
  const doing = (await request(`/${s.id}/work-orders?machineIndex=2`)).body.data;
  expect(doing.items).toHaveLength(1);
  expect(doing.items[0]).toMatchObject({ status: 'IN_PROGRESS', remainingTicks: 1, startedTick: 5 });
  expect(await prisma.demoSession.findUnique({ where: { id: s.id } })).toEqual(beforeRead);
  while (s.primary.state.tick < 7) {
    const r = await cmd(s, s.status === 'REVIEW' ? { command: 'approve', reason: 'Continue matching' } : { command: 'advance' });
    expect(r.status).toBe(200); s = r.body.data;
  }
  const done = (await request(`/${s.id}/work-orders?machineIndex=2`)).body.data;
  expect(done.items).toHaveLength(1);
  expect(done.items[0]).toMatchObject({ workOrderId: doing.items[0].workOrderId, status: 'COMPLETED', completedTick: 7, remainingTicks: 0 });
}, 60000);

test('session read permissions, strict queries, and pure legacy fallback', async () => {
  const s = await review();
  expect((await request(`/${s.id}/work-orders`, null)).status).toBe(401);
  expect((await request(`/${s.id}/work-orders`, other)).status).toBe(404);
  expect((await request(`/${s.id}/work-orders`, admin)).status).toBe(200);
  for (const q of ['limit=0', 'machineIndex=-1', 'machineIndex=99', 'unexpected=true'])
    expect((await request(`/${s.id}/work-orders?${q}`)).status).toBe(400);
  const legacy = structuredClone(s);
  legacy.primary.records = legacy.primary.records.slice(-2);
  await prisma.demoSession.update({ where: { id: s.id }, data: { payloadJson: legacy, workOrdersJson: require('@prisma/client').Prisma.DbNull, ownerId: other.id } });
  const before = await prisma.demoSession.findUnique({ where: { id: s.id } });
  const r = await request(`/${s.id}/work-orders`, other);
  expect(r.status).toBe(200); expect(r.body.data.historyCoverage).toBe('PARTIAL');
  expect(await prisma.demoSession.findUnique({ where: { id: s.id } })).toEqual(before);
  expect((await request(`/${s.id}/commands`, other, { revision: s.revision, command: 'approve', reason: 'Forbidden viewer mutation' })).status).toBe(403);
}, 60000);

test('autoplay projects every interval and replay does not duplicate', async () => {
  const s = await create(), key = randomUUID(), body = { command: 'autoplay', stopAt: 'complete', maxTicks: 8 };
  const first = await cmd(s, body, key); expect(first.status).toBe(200);
  expect(first.body.data.primary.state.tick).toBe(8);
  const a = (await request(`/${s.id}/work-orders`)).body.data;
  expect(a.items.some(o => o.machineIndex === 2 && o.status === 'COMPLETED')).toBe(true);
  expect(a.items.every(o => o.assignmentSource === 'AUTOMATIC')).toBe(true);
  expect((await cmd(s, body, key)).status).toBe(200);
  expect((await request(`/${s.id}/work-orders`)).body.data).toEqual(a);
}, 60000);

test('concurrent identical approvals replay one receipt and create one projection', async () => {
  const s = await review(), key = randomUUID();
  const auditCount = await prisma.auditLog.count({ where: { entityId: s.id, action: 'DEMO_APPROVE' } });
  const body = { command: 'approve', reason: 'Concurrent identical approval' };
  const results = await Promise.all([cmd(s, body, key), cmd(s, body, key)]);
  expect(results.map(r => r.status)).toEqual([200, 200]);
  expect(results[0].body.data).toEqual(results[1].body.data);
  expect((await request(`/${s.id}/work-orders?machineIndex=2`)).body.data.items).toHaveLength(1);
  expect(await prisma.auditLog.count({ where: { entityId: s.id, action: 'DEMO_APPROVE' } })).toBe(auditCount + 1);
}, 60000);

test('audit transaction failure rolls back session and projection together', async () => {
  const s = await review();
  const before = await prisma.demoSession.findUnique({ where: { id: s.id } });
  const audits = await prisma.auditLog.count({ where: { entityId: s.id } });
  // Keep the real PostgreSQL transaction, inject a failure only at audit insertion.
  const original = prisma.$transaction.bind(prisma);
  const spy = jest.spyOn(prisma, '$transaction').mockImplementation(callback => original(async tx => {
    const wrapped = new Proxy(tx, { get(target, key) {
      if (key === 'auditLog') return { create: async () => { throw new Error('Injected audit failure'); } };
      return target[key];
    } });
    return callback(wrapped);
  }));
  try {
    await expect(demo.command(owner, s.id, { command: 'approve', revision: s.revision, reason: 'Rollback test' }, randomUUID())).rejects.toThrow('Injected audit failure');
  } finally { spy.mockRestore(); }
  expect(await prisma.demoSession.findUnique({ where: { id: s.id } })).toEqual(before);
  expect(await prisma.auditLog.count({ where: { entityId: s.id } })).toBe(audits);
}, 60000);
