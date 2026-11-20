jest.mock('../../src/research/bridge', () => ({ bridge: jest.fn((...args) => require('../helpers/technician-bridge-double').bridge(...args)) }));
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../../src/config/prisma');
const app = require('../../src/app');
const { bridge } = require('../../src/research/bridge');
const workOrders = require('../../src/research/demo-work-orders');
const fixture = require('../../examples/demo-work-orders-trace.json').snapshots;
const key = () => crypto.randomUUID();
let server, base; const users = {};
async function request(path, { user = users.engineer, body, identity = key() } = {}) {
  const response = await fetch(base + '/api/v1/research/demo' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': identity,
      ...(user ? { Authorization: 'Bearer ' + jwt.sign({ id: user.id, role: 'ADMIN' }, process.env.JWT_SECRET) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cache: response.headers.get('Cache-Control') };
}
function healthy(n = 2) {
  const p = structuredClone(fixture.beforeApproval);
  for (const lane of [p.primary, p.baseline]) {
    lane.state = structuredClone(lane.records[0].before); lane.state.jobs = Array(n).fill(null); lane.records = [];
    for (const name of ['total_cost', 'controlled_cost', 'tail_cost', 'failures', 'unavailable_machine_ticks', 'technician_busy_ticks', 'overrides']) lane[name] = 0;
  }
  p.config.duration.forEach(machine => machine.forEach(row => { while (row.length < n) row.push(3); }));
  Object.assign(p, { status: 'RUNNING', pending: null, workflow: [], decisions: [], activated: true, first_incident_tick: null,
    simulation_start: '2026-11-19T00:00:00.000Z', step_seconds: 600 });
  return p;
}
async function source(payloadJson = healthy(), user = users.engineer) {
  const id = key();
  return prisma.demoSession.create({ data: { id, ownerId: user.id, requestKey: key(), requestHash: 'a'.repeat(64),
    payloadJson, workOrdersJson: workOrders.project(id, payloadJson) } });
}
const startBody = s => ({ revision: s.revision, durationTicks: 3, reason: 'Short break' });
const start = (s, index = 0, options = {}) => request(`/sessions/${s.id}/technicians/${index}/absence`, { body: startBody(s), ...options });
const back = (s, index = 0, options = {}) => request(`/sessions/${s.id}/technicians/${index}/return`, { body: { revision: s.revision, reason: 'Back early' }, ...options });
const read = (s, options = {}) => request(`/sessions/${s.id}/technicians`, options);
const command = (s, c = { command: 'advance' }, options = {}) => request(`/sessions/${s.id}/commands`, { body: { revision: s.revision, ...c }, ...options });
beforeAll(async () => {
  for (const [name, role, active] of [['engineer', 'ENGINEER', true], ['other', 'ENGINEER', true], ['admin', 'ADMIN', true], ['viewer', 'VIEWER', true], ['operator', 'OPERATOR', true], ['inactive', 'ADMIN', false]]) {
    users[name] = await prisma.user.create({ data: { username: 'technicians-' + key(), passwordHash: 'unused', role, active } });
  }
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { if (server) await new Promise(r => server.close(r)); await prisma.$disconnect(); });
afterEach(() => bridge.mockImplementation((...args) => require('../helpers/technician-bridge-double').bridge(...args)));

test('legacy GET is owner scoped, uses actual jobs/stepSeconds and never changes state or audit', async () => {
  const s = await source(fixture.inProgress), before = await prisma.demoSession.findUnique({ where: { id: s.id } }), audits = await prisma.auditLog.count();
  for (let i = 0; i < 2; i++) {
    const result = await read(s); expect(result).toMatchObject({ status: 200, cache: 'no-store' });
    expect(result.body.data).toMatchObject({ sessionId: s.id, tick: 6, revision: 0, stepSeconds: 900 });
    expect(result.body.data.technicians[1]).toMatchObject({ availability: 'BUSY', currentJob: { machine: 2, component: 1, remaining: 1 } });
  }
  expect(await prisma.demoSession.findUnique({ where: { id: s.id } })).toEqual(before); expect(await prisma.auditLog.count()).toBe(audits);
  expect((await read(s, { user: users.other })).status).toBe(404);
  expect((await read(s, { user: users.admin })).status).toBe(200);
  expect((await read(s, { user: null })).status).toBe(401);
  expect((await read(s, { user: users.inactive })).status).toBe(401);
  expect((await read(await source(healthy(), users.viewer), { user: users.viewer })).status).toBe(200);
  expect((await request(`/sessions/${s.id}/technicians?limit=2&limit=2`)).status).toBe(400);
});

test('write roles and strict index/body/reason/duration validation precede runtime', async () => {
  const s = await source(); bridge.mockClear();
  for (const user of [users.viewer, users.operator]) expect((await start(s, 0, { user })).status).toBe(403);
  expect((await start(s, 0, { user: users.other })).status).toBe(404);
  for (const index of ['-1', '1e0', '00']) expect((await start(s, index)).status).toBe(400);
  expect((await start(s, 2)).body.error.code).toBe('TECHNICIAN_NOT_FOUND');
  for (const body of [{ ...startBody(s), durationTicks: 0 }, { ...startBody(s), durationTicks: 1.5 }, { ...startBody(s), durationTicks: '2' },
    { ...startBody(s), durationTicks: 100001 }, { ...startBody(s), reason: ' ' }, { ...startBody(s), actor: users.admin.id }])
    expect((await start(s, 0, { body })).status).toBe(400);
  expect((await request(`/sessions/${s.id}/technicians/0/absence?extra=1`, { body: startBody(s) })).status).toBe(400);
  expect(bridge).not.toHaveBeenCalled();
});

test('start is zero-time, server-owned, revisioned and preserves both lane/config states', async () => {
  const s = await source(), before = s.payloadJson, r = await start(s);
  expect(r).toMatchObject({ status: 200, cache: 'no-store' });
  expect(r.body.data).toMatchObject({ sessionId: s.id, revision: 1, tick: 0, stepSeconds: 600 });
  const p = r.body.data.session;
  expect(p.primary).toEqual(before.primary); expect(p.baseline).toEqual(before.baseline); expect(p.config).toEqual(before.config);
  expect(p.technicianAvailability.events[0]).toMatchObject({ type: 'ABSENCE_STARTED', tick: 0, actor: { type: 'USER', userId: users.engineer.id } });
  expect(r.body.data.technicians[0]).toMatchObject({ availability: 'ABSENT', returnTick: 3, activeAbsence: { startTick: 0, returnTick: 3 } });
  expect((await read(s)).body.data).toEqual({ ...r.body.data, session: undefined });
  expect(p.comparisonContext).toMatchObject({ workforceVersion: 1, requiresCommonSnapshot: true });
});

test('busy primary/COMPLETE reject before bridge; baseline busy does not prohibit primary absence', async () => {
  bridge.mockClear(); const busy = await source(fixture.inProgress);
  expect((await start(busy, 1)).body.error.code).toBe('TECHNICIAN_BUSY');
  const done = await source({ ...healthy(), status: 'COMPLETE' });
  expect((await start(done)).body.error.code).toBe('DEMO_COMPLETE');
  expect((await back(done)).body.error.code).toBe('DEMO_COMPLETE');
  expect(bridge).not.toHaveBeenCalled();
  const p = healthy(); p.baseline.state.jobs[0] = { machine: 0, component: 0, technician: 0, kind: 'PM', remaining: 2 };
  let s = (await start(await source(p))).body.data.session;
  expect(s.baseline.state.jobs[0].remaining).toBe(2);
  s = (await command(s)).body.data; expect(s.baseline.state.jobs[0].remaining).toBe(1);
  s = (await command(s)).body.data; expect(s.baseline.state.jobs[0]).toBeNull();
  expect(s.technicians[0].availability).toBe('ABSENT');
});

test('finite sessions reject workforce writes without running the bridge or changing state', async () => {
  const s = await source({ ...healthy(), continuous: false });
  const receipts = await prisma.demoWriteReceipt.count();
  const audits = await prisma.auditLog.count();
  bridge.mockClear();
  for (const result of [await start(s), await back(s)]) {
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('DEMO_INTERVENTION_REPLAY_UNSUPPORTED');
  }
  expect(bridge).not.toHaveBeenCalled();
  expect(await prisma.demoSession.findUnique({ where: { id: s.id } })).toEqual(s);
  expect(await prisma.demoWriteReceipt.count()).toBe(receipts);
  expect(await prisma.auditLog.count()).toBe(audits);
});

test('early return emits one event and retries return the original receipt after later changes', async () => {
  const initial = await source(), startKey = key(), started = await start(initial, 0, { identity: startKey });
  const s = started.body.data.session, identity = key(), returned = await back(s, 0, { identity });
  expect(returned.status).toBe(200); expect(returned.body.data.technicians[0].availability).toBe('AVAILABLE');
  expect(returned.body.data.session.technicianAvailability.events.map(e => e.type)).toEqual(['ABSENCE_STARTED', 'ABSENCE_RETURNED_EARLY']);
  expect((await back(s, 0, { identity })).body).toEqual(returned.body);
  expect((await back(returned.body.data.session)).body.error.code).toBe('TECHNICIAN_NOT_ABSENT');
  await start(returned.body.data.session, 1);
  expect((await start(initial, 0, { identity: startKey })).body).toEqual(started.body);
  expect((await start(initial, 0, { identity: startKey, body: { ...startBody(initial), durationTicks: 9 } })).body.error.code).toBe('DEMO_KEY_CONFLICT');
  expect(await prisma.auditLog.count({ where: { entityId: initial.id, action: 'DEMO_ABSENCE_RETURNED_EARLY' } })).toBe(1);
});

test('simultaneous same keys replay one event; different keys on one revision have one winner', async () => {
  const s = await source(), identity = key();
  const twins = await Promise.all([start(s, 0, { identity }), start(s, 0, { identity })]);
  expect(twins.map(r => r.status)).toEqual([200, 200]); expect(twins[0].body).toEqual(twins[1].body);
  const now = twins[0].body.data.session;
  expect((await start(now)).body.error.code).toBe('TECHNICIAN_ALREADY_ABSENT');
  const race = await Promise.all([back(now), back(now)]); expect(race.map(r => r.status).sort()).toEqual([200, 409]);
  expect(await prisma.auditLog.count({ where: { entityId: s.id, action: 'DEMO_ABSENCE_STARTED' } })).toBe(1);
});

test('REVIEW/deferral invalidation makes an old proposal unusable', async () => {
  const p = structuredClone(fixture.beforeApproval); p.review_deferral = { technician: 0 }; p.reviewDeferral = true; p.deferred_review = 'old';
  const s = await source(p), r = await start(s);
  expect(r.status).toBe(200); expect(r.body.data.session).toMatchObject({ status: 'RUNNING', pending: null, playbackPaused: true,
    review_deferral: null, reviewDeferral: null, deferred_review: null });
  expect((await command(s, { command: 'approve', reason: 'Stale proposal' })).body.error.code).toBe('DEMO_STALE');
});

test.each(['advance', 'autoplay', 'approve', 'override'])('automatic return is exact and audited once through %s', async name => {
  const row = await source();
  let s = (await start(row, 0, { body: { ...startBody(row), durationTicks: name === 'autoplay' ? 2 : 1 } })).body.data.session;
  if (['approve', 'override'].includes(name)) {
    const p = structuredClone(s); p.status = 'REVIEW'; p.pending = { action: [], baseline_action: [], catalogue: [[]] };
    await prisma.demoSession.update({ where: { id: s.id }, data: { payloadJson: p } });
  }
  const c = name === 'autoplay' ? { command: name, maxTicks: 3, stopAt: 'complete' }
    : ['approve', 'override'].includes(name) ? { command: name, reason: 'Continue', ...(name === 'override' ? { action: [] } : {}) } : { command: name };
  const identity = key(), first = await command(s, c, { identity }); expect(first.status).toBe(200);
  expect(first.body.data.technicians[0].availability).toBe('AVAILABLE');
  const m = first.body.data.technicianAvailability;
  expect(m.events.at(-1)).toMatchObject({ eventId: m.absences[0].automaticEndEventId, type: 'ABSENCE_ENDED', tick: m.absences[0].returnTick });
  expect((await command(s, c, { identity })).body).toEqual(first.body);
  const audits = await prisma.auditLog.findMany({ where: { entityId: s.id, action: 'DEMO_ABSENCE_ENDED' } });
  expect(audits).toHaveLength(1); expect(audits[0].actorUserId).toBeNull();
  expect(audits[0].payloadJson.actor).toEqual({ type: 'SYSTEM', userId: null });
});

test('snapshot/reopen preserves absolute returnTick, events and workforce hash across reload', async () => {
  const sourceRow = await source(); let s = (await start(sourceRow)).body.data.session;
  s = (await command(s)).body.data;
  const saved = await request(`/sessions/${s.id}/snapshots`, { body: { revision: s.revision, name: 'Absent technician', layoutId: 'base' } });
  expect(saved.status).toBe(201);
  await command(s, { command: 'autoplay', maxTicks: 4, stopAt: 'complete' });
  const opened = await request(`/snapshots/${saved.body.data.snapshotId}/sessions`, { body: { revision: saved.body.data.sourceRevision } });
  expect(opened.status).toBe(201); const copy = opened.body.data;
  expect(copy.id).not.toBe(s.id); expect(copy.tick).toBe(1); expect(copy.playbackPaused).toBe(true);
  expect(copy.technicianAvailability).toEqual(s.technicianAvailability);
  expect(copy.technicians[0].returnTick).toBe(3);
  expect(copy.comparisonContext.workforceHash).toBe(s.comparisonContext.workforceHash);
  expect(copy.comparisonContext.cacheIdentity).not.toBe(s.comparisonContext.cacheIdentity);
  expect((await read(copy)).body.data.technicians).toEqual(copy.technicians);
});

test('config-sized indexing supports three technicians without rewriting their ordering or durations', async () => {
  const row = await source(healthy(3)), r = await start(row, 2);
  expect(r.status).toBe(200); expect(r.body.data.technicians).toHaveLength(3);
  expect(r.body.data.technicians.map(t => t.technicianIndex)).toEqual([0, 1, 2]);
  expect(r.body.data.session.config).toEqual(row.payloadJson.config);
});

test('bridge failure/malformed output causes no state, audit or receipt change', async () => {
  const s = await source(), before = await prisma.demoSession.findUnique({ where: { id: s.id } }), audit = await prisma.auditLog.count(), receipts = await prisma.demoWriteReceipt.count();
  bridge.mockRejectedValueOnce({ code: 'JCST_VALIDATION_FAILED' }); expect((await start(s)).status).toBe(503);
  bridge.mockImplementationOnce(async input => {
    const output = await require('../helpers/technician-bridge-double').bridge(input); output.session.primary.state.tick++; return output;
  });
  expect((await start(s)).status).toBe(502);
  expect(await prisma.demoSession.findUnique({ where: { id: s.id } })).toEqual(before);
  expect(await prisma.auditLog.count()).toBe(audit); expect(await prisma.demoWriteReceipt.count()).toBe(receipts);
});

test('audit failure rolls back the complete availability mutation and receipt', async () => {
  const s = await source(), before = await prisma.demoSession.findUnique({ where: { id: s.id } }), receipts = await prisma.demoWriteReceipt.count();
  await prisma.$executeRawUnsafe(`CREATE FUNCTION technician_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'DEMO_ABSENCE_STARTED' THEN RAISE EXCEPTION 'forced'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER technician_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION technician_audit_fail()');
  try {
    expect((await start(s)).status).toBe(500); expect(await prisma.demoSession.findUnique({ where: { id: s.id } })).toEqual(before);
    expect(await prisma.demoWriteReceipt.count()).toBe(receipts);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER technician_audit_fail ON audit_logs'); await prisma.$executeRawUnsafe('DROP FUNCTION technician_audit_fail()');
  }
});

test('role downgrade and revision race during runtime are checked again at write boundary', async () => {
  let s = await source();
  bridge.mockImplementationOnce(async input => {
    await prisma.user.update({ where: { id: users.engineer.id }, data: { role: 'VIEWER' } });
    return require('../helpers/technician-bridge-double').bridge(input);
  });
  expect((await start(s)).status).toBe(403);
  await prisma.user.update({ where: { id: users.engineer.id }, data: { role: 'ENGINEER' } });
  bridge.mockImplementationOnce(async input => {
    await prisma.demoSession.update({ where: { id: s.id }, data: { revision: { increment: 1 } } });
    return require('../helpers/technician-bridge-double').bridge(input);
  });
  expect((await start(s)).body.error.code).toBe('DEMO_STALE');
  expect((await prisma.demoSession.findUnique({ where: { id: s.id } })).payloadJson.technicianAvailability).toBeUndefined();
});
