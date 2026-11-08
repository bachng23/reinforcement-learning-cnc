const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { runtime } = require('../helpers/machine-health-runtime');
const source = require('../fixtures/machine-health/source.json');
const { projectHealth } = require('../../src/research/demo-health');

let server, base, engine;
const users = {}, sessions = [];
const oldScript = process.env.JCST_BRIDGE_SCRIPT, oldPython = process.env.JCST_PYTHON;
beforeAll(async () => {
  engine = runtime();
  process.env.JCST_BRIDGE_SCRIPT = engine.script;
  const local = path.resolve(__dirname, '../../../ai_services/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  process.env.JCST_PYTHON ||= fs.existsSync(local) ? local : 'python3';
  for (const [name, role, active] of [['owner', 'ENGINEER', true], ['other', 'ENGINEER', true],
    ['viewer', 'VIEWER', true], ['admin', 'ADMIN', true], ['operator', 'OPERATOR', true], ['inactive', 'ADMIN', false]]) {
    users[name] = await db.user.create({ data: { username: `health-${name}-${randomUUID()}`, passwordHash: 'not-a-password', role, active } });
  }
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1/research/demo/sessions`;
});
afterAll(async () => {
  if (server) await new Promise(r => server.close(r));
  if (oldScript === undefined) delete process.env.JCST_BRIDGE_SCRIPT; else process.env.JCST_BRIDGE_SCRIPT = oldScript;
  if (oldPython === undefined) delete process.env.JCST_PYTHON; else process.env.JCST_PYTHON = oldPython;
  engine?.close();
  await db.auditLog.deleteMany({ where: { entityId: { in: sessions } } });
  await db.demoSession.deleteMany({ where: { id: { in: sessions } } });
  await db.user.deleteMany({ where: { id: { in: Object.values(users).map(u => u.id) } } });
  await db.$disconnect();
});
async function http(suffix, { user = users.owner, body } = {}) {
  const res = await fetch(base + suffix, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(user ? { Authorization: `Bearer ${jwt.sign({ id: user.id, role: 'ADMIN' }, process.env.JWT_SECRET)}` } : {}),
      'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json(), cache: res.headers.get('Cache-Control') };
}
async function saved(payloadJson, owner = users.owner) {
  const row = await db.demoSession.create({ data: { ownerId: owner.id, requestKey: randomUUID(), requestHash: 'fixture', payloadJson } });
  sessions.push(row.id); return row;
}

test('real authenticated create/prepare/approve produces matching health at t5/t6/t7 without GET mutation', async () => {
  const created = await http('', { body: source.scenario });
  expect(created.status).toBe(201);
  let session = created.body.data; sessions.push(session.id);
  const suffix = `/${session.id}/machines/2/health`;
  while (session.primary.state.tick < 7) {
    const result = await http(`/${session.id}/commands`, { body: { revision: session.revision,
      ...(session.status === 'REVIEW' ? { command: 'approve', reason: 'Explicit common-case approval' } : { command: 'advance', autoApprove: false }) } });
    expect(result.status).toBe(200); session = result.body.data;
    const tick = session.primary.state.tick;
    if ([5, 6, 7].includes(tick)) {
      const before = await db.demoSession.findUnique({ where: { id: session.id } });
      const audits = await db.auditLog.findMany({ where: { entityId: session.id }, orderBy: { id: 'asc' } });
      // Health must not even need a functioning Python bridge or inference.
      process.env.JCST_BRIDGE_SCRIPT = path.join(engine.script, 'does-not-exist');
      let read;
      try { read = await http(suffix + `?expectedRevision=${session.revision}`); }
      finally { process.env.JCST_BRIDGE_SCRIPT = engine.script; }
      expect(read.status).toBe(200); expect(read.cache).toBe('no-store');
      const expected = projectHealth({ ...source.rows[tick], id: session.id, revision: session.revision }, 2);
      expect(read.body.data).toEqual({ ...expected, sessionId: session.id, revision: session.revision });
      expect(await db.demoSession.findUnique({ where: { id: session.id } })).toEqual(before);
      expect(await db.auditLog.findMany({ where: { entityId: session.id }, orderBy: { id: 'asc' } })).toEqual(audits);
    }
  }
  const r = await http(suffix);
  expect(r.body.data.history.events.map(e => [e.type, e.tick])).toEqual([['failure', 5], ['start', 5], ['completion', 7]]);
}, 60000);

test('owner/admin scope uses DB role; session owners of any read role can read, other users cannot enumerate', async () => {
  const row = await saved(source.rows[7].payloadJson);
  const url = `/${row.id}/machines/2/health`;
  for (const name of ['owner', 'admin']) expect((await http(url, { user: users[name] })).status).toBe(200);
  for (const name of ['other', 'viewer', 'operator']) {
    const r = await http(url, { user: users[name] });
    expect(r.status).toBe(404); expect(r.body.error.code).toBe('DEMO_NOT_FOUND'); expect(r.cache).toBe('no-store');
    expect((await http(`/${row.id}/machines/999/health`, { user: users[name] })).body.error.code).toBe('DEMO_NOT_FOUND');
  }
  for (const name of ['viewer', 'operator']) {
    const own = await saved(source.rows[0].payloadJson, users[name]);
    expect((await http(`/${own.id}/machines/0/health`, { user: users[name] })).status).toBe(200);
  }
  for (const user of [null, users.inactive]) {
    const r = await http(url, { user }); expect(r.status).toBe(401); expect(r.cache).toBe('no-store');
  }
  await db.user.update({ where: { id: users.owner.id }, data: { active: false } });
  expect((await http(url)).status).toBe(401);
  await db.user.update({ where: { id: users.owner.id }, data: { active: true } });
});

test('strict HTTP query/index, snapshot fences and per-session machine dimensions', async () => {
  const row = await saved(source.rows[7].payloadJson);
  const url = `/${row.id}/machines/2/health`;
  for (const query of ['limit=0', 'limit=257', 'limit=01', 'limit=1&limit=2', 'extra=1',
    'expectedRevision=0&expectedRevision=0', 'limit=1.5', 'limit=-1', 'limit=', 'limit[x]=1']) {
    const r = await http(url + '?' + query); expect(r.status).toBe(400); expect(r.cache).toBe('no-store');
  }
  for (const index of ['-1', '01', '1.0', '9007199254740992']) expect((await http(`/${row.id}/machines/${index}/health`)).status).toBe(400);
  expect((await http(`/${row.id}/machines/3/health`)).body.error.code).toBe('DEMO_MACHINE_NOT_FOUND');
  expect((await http(url + '?expectedRevision=99')).body.error.code).toBe('DEMO_STALE');
  const small = JSON.parse(JSON.stringify(source.rows[0].payloadJson));
  small.config.components = small.config.components.slice(0, 1); small.primary.state.components = small.primary.state.components.slice(0, 1);
  const one = await saved(small);
  expect((await http(`/${one.id}/machines/1/health`)).status).toBe(404);
  expect((await http(`/${one.id}/machines/0/health`)).status).toBe(200);
});

test('legacy/new, retention, gaps, limit and corrupted stored evidence are truthful through HTTP', async () => {
  const empty = await saved(source.rows[0].payloadJson);
  expect((await http(`/${empty.id}/machines/2/health`)).body.data.history.returnedIntervals).toBe(0);
  const cropped = JSON.parse(JSON.stringify(source.rows[7].payloadJson));
  delete cropped.step_seconds;
  cropped.primary.records = cropped.primary.records.filter(r => [3, 5, 6].includes(r.tick));
  const row = await saved(cropped), url = `/${row.id}/machines/2/health`;
  const first = await http(url), repeat = await http(url);
  expect(first.body).toEqual(repeat.body);
  expect(first.body.data.history).toMatchObject({ truncated: true, returnedIntervals: 3, gaps: [{ fromTick: 4, toTick: 5 }] });
  expect((await http(url + '?limit=1')).body.data.history.returnedIntervals).toBe(1);
  expect((await http(url + '?limit=256')).body.data.history.returnedIntervals).toBe(3);
  cropped.primary.state.components[2][1].age = -1;
  await db.demoSession.update({ where: { id: row.id }, data: { payloadJson: cropped } });
  const bad = await http(url); expect(bad.status).toBe(500); expect(bad.body.error.code).toBe('DEMO_TRACE_INVALID');
  expect(JSON.stringify(bad.body)).not.toContain('components');
});

test('actual 320-tick continuous session exposes the retained 256-interval window without a 64-tick ceiling', async () => {
  const { spawnSync } = require('node:child_process');
  const code = `import json,sys
sys.path.insert(0,sys.argv[1])
from domain.jcst.demo import initialize,autoplay
s=initialize(mode='policy',primary='corrective',baseline='wait',continuous=True)
for _ in range(40): autoplay(s,'complete',8)
print(json.dumps(s))`;
  const built = spawnSync(process.env.JCST_PYTHON, ['-c', code, path.dirname(path.dirname(engine.script))],
    { encoding: 'utf8', timeout: 20000, maxBuffer: 8_000_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  expect(built.status).toBe(0);
  const row = await saved(JSON.parse(built.stdout));
  const url = `/${row.id}/machines/2/health`;
  const short = await http(url), full = await http(url + '?limit=256');
  expect(short.status).toBe(200); expect(full.status).toBe(200);
  expect(short.body.data).toMatchObject({ tick: 320, history: { fromTick: 256, toTick: 320,
    availableFromTick: 64, returnedIntervals: 64, truncated: true, gaps: [] } });
  expect(full.body.data.history).toMatchObject({ fromTick: 64, toTick: 320,
    availableFromTick: 64, returnedIntervals: 256, truncated: true, gaps: [] });
  expect(full.body.data.history.samples).toHaveLength(514);
  const fullIds = new Set(full.body.data.history.events.map(e => e.eventId));
  expect(short.body.data.history.events.every(e => fullIds.has(e.eventId))).toBe(true);
}, 30000);
