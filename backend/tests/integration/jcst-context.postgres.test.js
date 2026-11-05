const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const prisma = require('../../src/config/prisma');
const app = require('../../src/app');
const { contextSnapshot } = require('../../src/research/demo-context');
let server, base, users, session, legacy, traces;
const request = async (suffix, { user = users.owner, method = 'GET', body } = {}) => {
  const response = await fetch(base + suffix, { method, headers: { ...(user ? { Authorization: 'Bearer ' + jwt.sign({ id: user.id, role: 'ADMIN' }, process.env.JWT_SECRET) } : {}),
    'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
};
beforeAll(async () => {
  const python = process.env.JCST_PYTHON || path.resolve(__dirname, '../../../ai_services/.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const generated = spawnSync(python, [path.resolve(__dirname, '../helpers/jcst-context-trace.py')], { encoding: 'utf8', timeout: 30000 });
  if (generated.status !== 0) throw Error(generated.stderr || 'Physical fixture generation failed');
  traces = JSON.parse(generated.stdout);
  users = {};
  for (const [name, role] of [['owner', 'ENGINEER'], ['other', 'ENGINEER'], ['admin', 'ADMIN'], ['viewer', 'VIEWER'], ['inactive', 'ENGINEER']])
    users[name] = await prisma.user.create({ data: { username: 'jcst-context-' + randomUUID(), passwordHash: 'test-only', role, active: name !== 'inactive' } });
  session = await prisma.demoSession.create({ data: { ownerId: users.owner.id, requestKey: randomUUID(), requestHash: 'a'.repeat(64),
    revision: 5, payloadJson: traces[4], contextJson: contextSnapshot() } });
  legacy = await prisma.demoSession.create({ data: { ownerId: users.viewer.id, requestKey: randomUUID(), requestHash: 'b'.repeat(64), revision: 5, payloadJson: traces[4] } });
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1/research/demo/sessions`;
}, 60000);
afterAll(async () => { if (server) await new Promise(r => server.close(r)); await prisma.$disconnect(); });
const url = suffix => `/${session.id}/${suffix}`;
test('real physical failure t5, CM in service t6 and completion/new failure t7 retain incident identity', async () => {
  const open = await request(url('incidents')); expect(open.status).toBe(200);
  expect(open.body.data.items).toHaveLength(1);
  const incident = open.body.data.items[0];
  expect(incident).toMatchObject({ machineId: 'M3', componentId: 'C2', openedAtTick: 5, status: 'OPEN' });
  await prisma.demoSession.update({ where: { id: session.id }, data: { payloadJson: traces[5], revision: 6 } });
  const inService = await request(url(`incidents/${incident.incidentId}`));
  expect(inService.body.data.incident).toMatchObject({ status: 'IN_SERVICE', serviceStartedAtTick: 5 });
  expect(inService.body.data.incident.decisions).toHaveLength(1);
  await prisma.demoSession.update({ where: { id: session.id }, data: { payloadJson: traces[6], revision: 7 } });
  const resolved = await request(url(`incidents/${incident.incidentId}`));
  expect(resolved.body.data).toMatchObject({ revision: 7, tick: 7, lane: 'primary', incident: { status: 'RESOLVED', resolvedAtTick: 7 } });
  const list = await request(url('incidents?machineId=M2&status=OPEN'));
  expect(list.body.data.items.some(i => i.componentId === 'C2' && i.openedAtTick === 7)).toBe(true);
  const machine = await request(url('machines/M1'));
  expect(machine.body.data.maintenanceHistory[0]).toMatchObject({ kind: 'PM', completedAtTick: 7 });
  expect((await request(url('incidents/M3-C2'))).status).toBe(404);
});
test('authorized reads share a revision fence, preserve context and never mutate session/audit', async () => {
  const before = await prisma.demoSession.findUnique({ where: { id: session.id } });
  const audits = await prisma.auditLog.count({ where: { entityId: session.id } });
  for (const suffix of ['factory', 'observation', 'machines/M3', 'incidents']) {
    const r = await request(url(suffix + '?expectedRevision=7'));
    expect(r.status).toBe(200); expect(r.cache).toBe('no-store');
    expect(r.body.data).toMatchObject({ sessionId: session.id, revision: 7, tick: 7, lane: 'primary', contextStatus: 'AVAILABLE' });
  }
  expect((await request(url('factory?expectedRevision=6'))).body.error.code).toBe('DEMO_STALE');
  for (const query of ['expectedRevision=7&expectedRevision=7', 'expectedRevision=-1', 'unknown=x'])
    expect((await request(url('factory?' + query))).status).toBe(400);
  expect(await prisma.demoSession.findUnique({ where: { id: session.id } })).toEqual(before);
  expect(await prisma.auditLog.count({ where: { entityId: session.id } })).toBe(audits);
  const altered = contextSnapshot(); altered.machines[0].name = 'New illustrative name';
  await expect(prisma.demoSession.update({ where: { id: session.id }, data: { contextJson: altered } })).rejects.toThrow();
  expect((await request(url('factory'))).body.data.context.machines[0].name).toBe('CNC turning center');
});
test('owner/admin scope, legacy viewer read and no viewer writes or cross-session incident IDs', async () => {
  for (const suffix of ['factory', 'observation', 'machines/M1', 'incidents']) {
    expect((await request(url(suffix), { user: users.other })).status).toBe(404);
    expect((await request(url(suffix), { user: users.admin })).status).toBe(200);
    expect((await request(url(suffix), { user: null })).status).toBe(401);
    expect((await request(url(suffix), { user: users.inactive })).status).toBe(401);
  }
  const old = await prisma.demoSession.findUnique({ where: { id: legacy.id } });
  const r = await request(`/${legacy.id}/machines/M3`, { user: users.viewer });
  expect(r.status).toBe(200); expect(r.body.data).toMatchObject({ contextStatus: 'MISSING_LEGACY', contextVersion: null, context: null, profile: null });
  expect((await request(`/${legacy.id}/commands`, { user: users.viewer, method: 'POST', body: { revision: 5, command: 'advance' } })).status).toBe(403);
  const foreign = (await request(url('incidents'))).body.data.items[0].incidentId;
  expect((await request(`/${legacy.id}/incidents/${foreign}`, { user: users.viewer })).status).toBe(404);
  expect(await prisma.demoSession.findUnique({ where: { id: legacy.id } })).toEqual(old);
});
test('labels and locations stay outside physical state/trace and legacy cannot be silently backfilled', async () => {
  const a = contextSnapshot(), b = contextSnapshot(); b.machines[0].name = 'Different label'; b.machines[0].location.x = 99;
  const second = await prisma.demoSession.create({ data: { ownerId: users.owner.id, requestKey: randomUUID(), requestHash: 'c'.repeat(64),
    payloadJson: traces[6], revision: 7, contextJson: b } });
  const first = (await request(url('observation'))).body.data;
  const other = (await request(`/${second.id}/observation`)).body.data;
  expect(other.machines).toEqual(first.machines);
  expect(other.incidents.map(i => [i.machineId, i.componentId, i.status, i.timeline])).toEqual(first.incidents.map(i => [i.machineId, i.componentId, i.status, i.timeline]));
  expect((await prisma.demoSession.findUnique({ where: { id: second.id } })).payloadJson).toEqual(traces[6]);
  await expect(prisma.demoSession.update({ where: { id: legacy.id }, data: { contextJson: a } })).rejects.toThrow();
});
test('HTTP create freezes context and command duplicate/stale/concurrent/rollback semantics remain atomic', async () => {
  const previous = process.env.JCST_BRIDGE_SCRIPT;
  // The bridge fixture emits genuine pinned-physics transitions for transaction
  // testing. It is not the registered-policy demo and is not learned-policy evidence.
  process.env.JCST_BRIDGE_SCRIPT = path.resolve(__dirname, '../helpers/jcst-command-fixture.py');
  const send = async (suffix, body, key) => {
    const response = await fetch(base + suffix, { method: 'POST', headers: {
      Authorization: 'Bearer ' + jwt.sign({ id: users.owner.id }, process.env.JWT_SECRET), 'Content-Type': 'application/json', 'Idempotency-Key': key,
    }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const key = randomUUID(), created = await send('', {}, key);
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const repeat = await send('', {}, key); expect(repeat.body).toEqual(created.body);
    expect((await prisma.demoSession.findUnique({ where: { id } })).contextJson).toEqual(contextSnapshot());
    expect((await send('', { seed: '990000002' }, key)).status).toBe(409);
    const commandKey = randomUUID(), body = { revision: 0, command: 'advance' };
    const advanced = await send(`/${id}/commands`, body, commandKey); expect(advanced.status).toBe(200);
    expect((await send(`/${id}/commands`, body, commandKey)).body).toEqual(advanced.body);
    expect((await send(`/${id}/commands`, body, randomUUID())).status).toBe(409);
    const concurrent = await Promise.all([0, 1].map(() => send(`/${id}/commands`, { revision: 1, command: 'advance' }, randomUUID())));
    expect(concurrent.map(r => r.status).sort()).toEqual([200, 409]);
    const before = await prisma.demoSession.findUnique({ where: { id } });
    expect(before.revision).toBe(2); expect(before.contextJson).toEqual(contextSnapshot());
    const audits = await prisma.auditLog.count({ where: { entityId: id } });
    expect(audits).toBe(3);
    await prisma.$executeRawUnsafe("CREATE FUNCTION jcst_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced audit rollback'; END $$");
    await prisma.$executeRawUnsafe("CREATE TRIGGER jcst_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action='DEMO_ADVANCE') EXECUTE FUNCTION jcst_test_audit_failure()");
    try {
      expect((await send(`/${id}/commands`, { revision: 2, command: 'advance' }, randomUUID())).status).toBe(500);
      expect(await prisma.demoSession.findUnique({ where: { id } })).toEqual(before);
      expect(await prisma.auditLog.count({ where: { entityId: id } })).toBe(audits);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER jcst_test_audit_failure ON audit_logs');
      await prisma.$executeRawUnsafe('DROP FUNCTION jcst_test_audit_failure()');
    }
  } finally {
    if (previous === undefined) delete process.env.JCST_BRIDGE_SCRIPT; else process.env.JCST_BRIDGE_SCRIPT = previous;
  }
}, 60000);
