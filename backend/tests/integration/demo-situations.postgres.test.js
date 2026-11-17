jest.mock('../../src/research/bridge', () => ({ bridge: jest.fn((...args) => require('../helpers/situation-bridge-double').bridge(...args)) }));
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../../src/config/prisma');
const app = require('../../src/app');
const { bridge } = require('../../src/research/bridge');
const { canonical, sha } = require('../../src/research/artifact-store');
const workOrders = require('../../src/research/demo-work-orders');
const fixtures = require('../../examples/demo-work-orders-trace.json').snapshots;
let server, base, owner, other, viewer, admin, operator;
const key = () => crypto.randomUUID();
async function request(path, { user = owner, body, identity = key() } = {}) {
  const r = await fetch(base + '/api/v1/research/demo' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': identity,
      ...(user ? { Authorization: 'Bearer ' + jwt.sign({ id: user.id, role: 'ADMIN' }, process.env.JWT_SECRET) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json(), cache: r.headers.get('Cache-Control') };
}
function healthy() {
  const p = structuredClone(fixtures.beforeApproval);
  for (const lane of [p.primary, p.baseline]) {
    lane.state = structuredClone(lane.records[0].before); lane.records = [];
    for (const k of ['total_cost', 'controlled_cost', 'tail_cost', 'failures', 'unavailable_machine_ticks', 'technician_busy_ticks', 'overrides']) lane[k] = 0;
  }
  Object.assign(p, { status: 'RUNNING', pending: null, decisions: [], workflow: [], first_incident_tick: null,
    simulation_start: '2026-11-16T00:00:00.000Z', step_seconds: 900 });
  return p;
}
async function source(p = healthy(), user = owner) {
  const id = key();
  return prisma.demoSession.create({ data: { id, ownerId: user.id, requestKey: key(), requestHash: 'a'.repeat(64),
    payloadJson: p, workOrdersJson: workOrders.project(id, p) } });
}
const saveBody = s => ({ revision: s.revision, name: 'Workshop exercise', description: 'Snapshot test', layoutId: 'smt-board-assembly' });
const save = (s, options = {}) => request(`/sessions/${s.id}/snapshots`, { body: saveBody(s), ...options });
const open = (s, options = {}) => request(`/snapshots/${s.snapshotId}/sessions`, { body: { revision: s.sourceRevision }, ...options });
async function branch() {
  const saved = await save(await source()); expect(saved.status).toBe(201);
  const opened = await open(saved.body.data); expect(opened.status).toBe(201); return opened.body.data;
}
const incidentBody = (s, tick = s.tick) => ({ revision: s.revision, machineIndex: 2, componentIndex: 1, scheduledTick: tick, reason: 'Controlled exercise' });
const inject = (s, options = {}) => request(`/sessions/${s.id}/incidents`, { body: incidentBody(s), ...options });
const command = (s, c = { command: 'advance' }, options = {}) => request(`/sessions/${s.id}/commands`, { body: { revision: s.revision, ...c }, ...options });
beforeAll(async () => {
  for (const [name, role] of [['owner', 'ENGINEER'], ['other', 'ENGINEER'], ['viewer', 'VIEWER'], ['admin', 'ADMIN'], ['operator', 'OPERATOR']]) {
    const user = await prisma.user.create({ data: { username: `situations-${key()}`, passwordHash: 'unused', role } });
    if (name === 'owner') owner = user; else if (name === 'other') other = user;
    else if (name === 'viewer') viewer = user; else if (name === 'operator') operator = user; else admin = user;
  }
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { if (server) await new Promise(r => server.close(r)); await prisma.$disconnect(); });
afterEach(() => bridge.mockImplementation((...args) => require('../helpers/situation-bridge-double').bridge(...args)));

test('save locks exact revision; owner scope, roles, strict input and no-store', async () => {
  const s = await source(), before = await prisma.demoSession.findUnique({ where: { id: s.id } });
  const r = await save(s); expect(r).toMatchObject({ status: 201, cache: 'no-store' });
  expect(r.body.data).toMatchObject({ sourceRevision: 0, sourceTick: 0, sessionId: s.id, revision: 0, tick: 0 });
  expect(await prisma.demoSession.findUnique({ where: { id: s.id } })).toEqual(before);
  expect((await save(s, { body: { ...saveBody(s), revision: 1 } })).status).toBe(409);
  expect((await save(s, { user: other })).status).toBe(404);
  for (const user of [viewer, operator]) expect((await save(s, { user })).status).toBe(403);
  expect((await save(s, { user: null })).status).toBe(401);
  for (const body of [{ ...saveBody(s), actor: owner.id }, { ...saveBody(s), name: ' ' }, { ...saveBody(s), revision: '0' }])
    expect((await save(s, { body })).status).toBe(400);
  const detail = await request(`/snapshots/${r.body.data.snapshotId}`);
  expect(detail.status).toBe(200); expect(detail.body.data.payloadJson).toBeUndefined();
  expect((await request(`/snapshots/${r.body.data.snapshotId}`, { user: other })).status).toBe(404);
  expect((await request(`/snapshots/${r.body.data.snapshotId}`, { user: admin })).status).toBe(200);
});

test('save and open receipts replay original body after later writes, reject key/body conflicts', async () => {
  const s = await source(), identity = key();
  const first = await save(s, { identity });
  await prisma.demoSession.update({ where: { id: s.id }, data: { revision: 9, payloadJson: fixtures.completed } });
  expect((await save(s, { identity })).body).toEqual(first.body);
  expect((await save(s, { identity, body: { ...saveBody(s), name: 'Different' } })).status).toBe(409);
  const openKey = key(), opened = await open(first.body.data, { identity: openKey });
  expect(opened.status).toBe(201);
  expect(opened.body.data).toMatchObject({ tick: 0, revision: 0, playbackPaused: true });
  expect(opened.body.data.id).not.toBe(s.id);
  await command(opened.body.data);
  expect((await open(first.body.data, { identity: openKey })).body).toEqual(opened.body);
  expect((await open(first.body.data, { body: { revision: 9 } })).status).toBe(409);
});

test('snapshot is independent after trace eviction/policy changes; REVIEW, in-service and COMPLETE survive', async () => {
  for (const p of [fixtures.beforeApproval, fixtures.inProgress, { ...healthy(), status: 'COMPLETE', continuous: false }]) {
    const s = await source(p), saved = await save(s);
    const stored = await prisma.demoSnapshot.findUnique({ where: { id: saved.body.data.snapshotId } });
    expect(sha(canonical(stored.payloadJson))).toBe(stored.snapshotHash);
    const changed = healthy(); changed.primary.controller = 'risk'; changed.primary.records = [];
    await prisma.demoSession.update({ where: { id: s.id }, data: { payloadJson: changed, revision: 300 } });
    const opened = await open(saved.body.data); expect(opened.status).toBe(201);
    for (const field of ['primary', 'baseline', 'pending', 'status', 'config', 'releases', 'physical_seed'])
      expect(opened.body.data[field]).toEqual(p[field]);
  }
});

test('stable pagination including equal timestamps, cursor validation and owner isolation', async () => {
  const s = await source();
  for (let i = 0; i < 5; i++) await save(s);
  const original = await prisma.demoSnapshot.findFirst({ where: { sourceSessionId: s.id } });
  for (let i = 0; i < 3; i++) {
    const { id, ...copy } = original;
    await prisma.demoSnapshot.create({ data: { ...copy, createdAt: new Date('2026-11-17T00:00:00Z') } });
  }
  await save(await source(healthy(), other), { user: other });
  const expected = await prisma.demoSnapshot.findMany({ where: { ownerId: owner.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const seen = []; let cursor = null;
  do {
    const r = await request('/snapshots?limit=2' + (cursor ? '&cursor=' + cursor : ''));
    expect(r.status).toBe(200); seen.push(...r.body.data.items.map(x => x.snapshotId)); cursor = r.body.data.nextCursor;
  } while (cursor);
  expect(seen).toEqual(expected.map(x => x.id)); expect(new Set(seen).size).toBe(seen.length);
  const first = await request('/snapshots?limit=1');
  expect((await request('/snapshots?cursor=' + first.body.data.nextCursor, { user: other })).status).toBe(400);
  for (const query of ['cursor=bad', 'limit=0', 'limit=101', 'limit=2&limit=2', 'foo=1'])
    expect((await request('/snapshots?' + query)).status).toBe(400);
});

test('immediate injection is primary-only, zero-time, server-owned, and retry-safe after another command', async () => {
  let s = await branch(); const identity = key(), input = incidentBody(s);
  const r = await inject(s, { identity }); expect(r.status).toBe(201);
  expect(r.body.data.event).toMatchObject({ status: 'APPLIED', appliedTick: 0, createdBy: owner.id });
  expect(r.body.data.session.tick).toBe(0); expect(r.body.data.session.baseline).toEqual(s.baseline);
  expect((await inject(s, { identity })).body).toEqual(r.body);
  expect((await inject(s)).status).toBe(409);
  s = r.body.data.session; await command(s);
  expect((await inject(s, { identity, body: input })).body).toEqual(r.body);
  expect((await prisma.auditLog.findMany({ where: { entityId: s.id, action: 'DEMO_INCIDENT_CREATED' } }))).toHaveLength(1);
  const health = await request(`/sessions/${s.id}/machines/2/health`);
  expect(health.status).toBe(200); expect(health.body.data.machineStatus).toBe('BREAKDOWN');
});

test.each(['advance', 'autoplay', 'approve', 'override'])('scheduled incident applies once through %s with stable provenance', async name => {
  let s = await branch();
  let r = await inject(s, { body: incidentBody(s, 1) }); expect(r.status).toBe(201); s = r.body.data.session;
  if (['approve', 'override'].includes(name)) {
    const p = structuredClone(s); p.status = 'REVIEW'; p.pending = { action: [] };
    await prisma.demoSession.update({ where: { id: s.id }, data: { payloadJson: p } });
  }
  r = await command(s, name === 'autoplay' ? { command: name, stopAt: 'complete', maxTicks: 2 }
    : ['approve', 'override'].includes(name) ? { command: name, reason: 'Test', ...(name === 'override' ? { action: [] } : {}) } : { command: name });
  expect(r.status).toBe(200); s = r.body.data;
  expect(s.incidents[0]).toMatchObject({ eventId: s.incidents[0].eventId, status: 'APPLIED', appliedTick: 1 });
  await command(s);
  expect(await prisma.auditLog.count({ where: { entityId: s.id, action: 'DEMO_INCIDENT_RESOLVED' } })).toBe(1);
});

test('duplicates race, stale, REVIEW, invalid targets and non-branch sessions fail without side effects', async () => {
  const s = await branch();
  const results = await Promise.all([inject(s), inject(s)]);
  expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  const current = results.find(r => r.status === 201).body.data.session;
  expect((await inject(current)).status).toBe(409);
  expect((await inject(current, { body: { ...incidentBody(current), machineIndex: 99 } })).status).toBe(422);
  const original = await source();
  expect((await inject({ ...original, tick: 0 })).status).toBe(409);
  let p = structuredClone(current); p.status = 'REVIEW';
  await prisma.demoSession.update({ where: { id: current.id }, data: { payloadJson: p } });
  expect((await inject(current, { body: { ...incidentBody(current), machineIndex: 0 } })).status).toBe(409);
});

test('skip outcomes preserve physical state and read never writes revision/audit', async () => {
  const s = await branch(); const applied = (await inject(s)).body.data.session;
  const r = await inject(applied, { body: { ...incidentBody(applied), componentIndex: 0 } });
  expect(r.status).toBe(201); expect(r.body.data.event).toMatchObject({ status: 'SKIPPED', reason: 'COMPONENT_ALREADY_FAILED' });
  const before = await prisma.demoSession.findUnique({ where: { id: s.id } }), audit = await prisma.auditLog.count();
  for (let i = 0; i < 3; i++) expect((await request(`/sessions/${s.id}/incidents`)).status).toBe(200);
  expect(await prisma.demoSession.findUnique({ where: { id: s.id } })).toEqual(before);
  expect(await prisma.auditLog.count()).toBe(audit);
});

test('runtime errors/malformed output roll back open/injection with no receipt/audit/session', async () => {
  const saved = await save(await source()), before = await prisma.demoSession.count(), receipts = await prisma.demoWriteReceipt.count();
  bridge.mockRejectedValueOnce(Object.assign(Error('Unsupported'), { code: 'JCST_VALIDATION_FAILED' }));
  const failed = await open(saved.body.data); expect(failed.status).toBe(503);
  expect(await prisma.demoSession.count()).toBe(before); expect(await prisma.demoWriteReceipt.count()).toBe(receipts);
  const s = await branch(), row = await prisma.demoSession.findUnique({ where: { id: s.id } });
  bridge.mockResolvedValueOnce({ protocol: 'jcst-situations/1', session: { ...healthy(), physical_seed: 'wrong' } });
  expect((await inject(s)).status).toBe(502);
  expect(await prisma.demoSession.findUnique({ where: { id: s.id } })).toEqual(row);
});

test('role downgrade/inactive user blocks receipt replay; changes during runtime are rechecked', async () => {
  const s = await source(), identity = key(); await save(s, { identity });
  await prisma.user.update({ where: { id: owner.id }, data: { role: 'VIEWER' } });
  expect((await save(s, { identity })).status).toBe(403);
  await prisma.user.update({ where: { id: owner.id }, data: { role: 'ENGINEER', active: false } });
  expect((await save(s, { identity })).status).toBe(401);
  await prisma.user.update({ where: { id: owner.id }, data: { active: true } });
  const saved = await save(s);
  bridge.mockImplementationOnce(async req => {
    await prisma.user.update({ where: { id: owner.id }, data: { role: 'VIEWER' } });
    return require('../helpers/situation-bridge-double').bridge(req);
  });
  expect((await open(saved.body.data)).status).toBe(403);
  await prisma.user.update({ where: { id: owner.id }, data: { role: 'ENGINEER' } });
});

test('audit insertion failure rolls back snapshot and receipt atomically', async () => {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION situation_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'DEMO_SNAPSHOT_SAVED' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER situation_test_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION situation_test_audit_fail()');
  try {
    const s = await source(), count = await prisma.demoSnapshot.count(), receipts = await prisma.demoWriteReceipt.count();
    expect((await save(s)).status).toBe(500);
    expect(await prisma.demoSnapshot.count()).toBe(count); expect(await prisma.demoWriteReceipt.count()).toBe(receipts);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER situation_test_audit_fail ON audit_logs');
    await prisma.$executeRawUnsafe('DROP FUNCTION situation_test_audit_fail()');
  }
});

test('snapshot and receipt DB guards reject mutation/deletion', async () => {
  const s = (await save(await source())).body.data;
  await expect(prisma.demoSnapshot.update({ where: { id: s.snapshotId }, data: { name: 'Tampered' } })).rejects.toThrow();
  await expect(prisma.demoSnapshot.delete({ where: { id: s.snapshotId } })).rejects.toThrow();
  const receipt = await prisma.demoWriteReceipt.findFirst();
  await expect(prisma.demoWriteReceipt.update({ where: { id: receipt.id }, data: { responseBody: {} } })).rejects.toThrow();
});

test('same-key concurrent save/open/inject create one effect and replay the same body', async () => {
  const sourceRow = await source(), identity = key();
  const saved = await Promise.all([save(sourceRow, { identity }), save(sourceRow, { identity })]);
  expect(saved.map(r => r.status)).toEqual([201, 201]); expect(saved[0].body).toEqual(saved[1].body);
  const openKey = key();
  const opened = await Promise.all([open(saved[0].body.data, { identity: openKey }), open(saved[0].body.data, { identity: openKey })]);
  expect(opened.map(r => r.status)).toEqual([201, 201]); expect(opened[0].body).toEqual(opened[1].body);
  const incidentKey = key(), s = opened[0].body.data;
  const events = await Promise.all([inject(s, { identity: incidentKey }), inject(s, { identity: incidentKey })]);
  expect(events.map(r => r.status)).toEqual([201, 201]); expect(events[0].body).toEqual(events[1].body);
  expect(await prisma.auditLog.count({ where: { entityId: s.id, action: 'DEMO_INCIDENT_CREATED' } })).toBe(1);
});

test('machine in service skips; reopening a queue retains immutable event IDs and actors', async () => {
  const saved = await save(await source(fixtures.inProgress));
  const opened = await open(saved.body.data); const s = opened.body.data;
  const injected = await inject(s, { body: { ...incidentBody(s), componentIndex: 0 } });
  expect(injected.status).toBe(201);
  expect(injected.body.data.event).toMatchObject({ status: 'SKIPPED', reason: 'MACHINE_IN_SERVICE', appliedTick: 6 });
  const current = injected.body.data.session;
  const scheduled = await inject(current, { body: { ...incidentBody(current, 12), machineIndex: 0 } });
  const frozen = await save(scheduled.body.data.session);
  const again = await open(frozen.body.data);
  expect(again.body.data.incidents).toEqual(scheduled.body.data.session.incidents);
});

test('revision changes while runtime runs reject final write and leave no receipt', async () => {
  const s = await branch(), before = await prisma.demoWriteReceipt.count();
  bridge.mockImplementationOnce(async req => {
    await prisma.demoSession.update({ where: { id: s.id }, data: { revision: { increment: 1 } } });
    return require('../helpers/situation-bridge-double').bridge(req);
  });
  expect((await inject(s)).status).toBe(409);
  const row = await prisma.demoSession.findUnique({ where: { id: s.id } });
  expect(row.payloadJson.incidents).toBeUndefined(); expect(await prisma.demoWriteReceipt.count()).toBe(before);
});
