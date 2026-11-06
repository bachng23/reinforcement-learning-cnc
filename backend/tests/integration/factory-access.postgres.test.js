const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { setTimeout: delay } = require('node:timers/promises');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const {
  loadCanonicalSeedPlan,
  validatePayload,
  contentHash,
} = require('../../src/services/operations-contract.service');
const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');
const {
  claimDecisionCase,
  persistDecisionRecommendation,
} = require('../../src/services/decision-planning.service');
const { importFactoryAccess } = require('../../src/services/factory-access-import.service');
const example = require('../../../contracts/v3/examples/demo-scenario.json');
const oldMode = process.env.FACTORY_ACCESS_SOURCE,
  oldGrants = process.env.OPERATIONS_FACTORY_ACCESS;
let users, server, base, seed;
beforeAll(async () => {
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  process.env.OPERATIONS_FACTORY_ACCESS = 'MALFORMED_IGNORED_IN_DATABASE_MODE';
  users = Object.fromEntries(
    await Promise.all(
      ['ADMIN', 'OPERATOR', 'ENGINEER', 'VIEWER', 'OUTSIDER', 'INACTIVE'].map(async (role) => [
        role,
        await db.user.create({
          data: {
            username: randomUUID(),
            passwordHash: 'PRIVATE_HASH',
            role: ['OUTSIDER', 'INACTIVE'].includes(role) ? 'VIEWER' : role,
            active: role !== 'INACTIVE',
          },
        }),
      ]),
    ),
  );
  seed = await validatePayload(await loadCanonicalSeedPlan(), 'seed');
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(async () => {
  if (oldMode === undefined) delete process.env.FACTORY_ACCESS_SOURCE;
  else process.env.FACTORY_ACCESS_SOURCE = oldMode;
  if (oldGrants === undefined) delete process.env.OPERATIONS_FACTORY_ACCESS;
  else process.env.OPERATIONS_FACTORY_ACCESS = oldGrants;
  if (server) await new Promise((r) => server.close(r));
  await db.$disconnect();
});
async function http(path, { method = 'GET', user = users.ADMIN, body, key = randomUUID() } = {}) {
  const r = await fetch(base + path, {
    signal: AbortSignal.timeout(25000),
    method,
    headers: {
      ...(user
        ? { Authorization: 'Bearer ' + jwt.sign({ id: user.id, role: 'ADMIN' }, process.env.JWT_SECRET) }
        : {}),
      'X-Request-Id': 'factory-access-test',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'Idempotency-Key': key,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: r.status,
    body: await r.json(),
    cache: r.headers.get('cache-control'),
    requestId: r.headers.get('x-request-id'),
  };
}
const member = (id, user, method = 'PUT', actor = users.ADMIN) =>
  http(`/factories/${id}/members/${user.id}`, { method, user: actor });
async function factory(ingest = true) {
  const id = 'access-' + randomUUID();
  const r = await http('/factories', { method: 'POST', body: { factory_id: id, name: '  Named factory  ' } });
  expect(r.status).toBe(201);
  expect(r.body.data).toMatchObject({ factory_id: id, name: 'Named factory', has_snapshot: false });
  const s = { ...structuredClone(seed), factory_id: id };
  s.current_schedule.factory_id = id;
  if (ingest)
    await ingestFactorySnapshot(
      { factoryId: id, expectedHeadRevision: 0, snapshot: s, sourceId: 'access-test' },
      db,
    );
  for (const role of ['OPERATOR', 'ENGINEER', 'VIEWER'])
    expect((await member(id, users[role])).status).toBe(200);
  return s;
}
async function create(s, { key = randomUUID(), user = users.OPERATOR } = {}) {
  const h = await db.operationsHead.findUnique({ where: { factoryId: s.factory_id } });
  const body = {
    schema_version: '3.0',
    factory_id: s.factory_id,
    expected_snapshot_id: s.snapshot_id,
    expected_plan_version: h.planVersion,
    request: {
      mode: 'LIVE',
      trigger: { type: 'MANUAL_REPLAN', reason: 'Access test' },
      planning_config: { horizon_minutes: 720 },
    },
  };
  return { response: await http('/decision-cases', { method: 'POST', user, body, key }), body, key };
}
async function ready(s, beforePersist = async () => {}) {
  const c = await create(s);
  expect(c.response.status).toBe(202);
  const id = c.response.body.data.decision_case_id;
  const lease = await claimDecisionCase(db, { caseId: id, expectedRevision: 1, workerId: randomUUID() });
  const candidate = {
    ...structuredClone(example.candidate_plans[0]),
    decision_case_id: id,
    snapshot_id: s.snapshot_id,
    schedule: { ...structuredClone(s.current_schedule), schedule_id: 'access-schedule-' + id },
  };
  candidate.validation = {
    schema_version: '3.0',
    validation_id: 'access-validation',
    candidate_plan_id: candidate.candidate_plan_id,
    validator_version: 'operations-validator-v1',
    verdict: 'VALID',
    validated_at: candidate.generated_at,
    violations: [],
  };
  const recommendation = {
    schema_version: '3.0',
    recommendation_id: 'access-rec-' + id,
    decision_case_id: id,
    snapshot_id: s.snapshot_id,
    generated_at: candidate.generated_at,
    recommended_plan_id: candidate.candidate_plan_id,
    candidate_plans: [candidate],
    explanation: {
      summary: 'private artifact',
      primary_reasons: ['Feasible'],
      tradeoffs: ['No change'],
      residual_risks: [],
      evidence_refs: [s.snapshot_id],
    },
  };
  await beforePersist();
  await persistDecisionRecommendation(db, {
    caseId: id,
    expectedRevision: lease.revision,
    leaseToken: lease.leaseToken,
    recommendation,
  });
  return {
    ...c,
    id,
    command: {
      schema_version: '3.0',
      decision_case_id: id,
      command: 'APPROVE',
      recommendation_id: recommendation.recommendation_id,
      expected_snapshot_id: s.snapshot_id,
      expected_plan_version: c.body.expected_plan_version,
      expected_case_revision: 6,
      candidate_plan_id: candidate.candidate_plan_id,
      candidate_version: candidate.plan_version,
    },
  };
}
const decide = (body, key = randomUUID()) =>
  http(`/decision-cases/${body.decision_case_id}/decision`, {
    method: 'POST',
    user: users.OPERATOR,
    body,
    key,
  });
const auditCount = (id) =>
  db.auditLog.count({
    where: { factoryId: id, action: { in: ['FACTORY_ACCESS_GRANTED', 'FACTORY_ACCESS_REVOKED'] } },
  });
async function effects(id) {
  return Promise.all([
    db.operationsHead.findUnique({ where: { factoryId: id } }),
    db.decisionCase.findMany({ where: { factoryId: id }, orderBy: { id: 'asc' } }),
    db.decisionCaseIdempotencyReceipt.count({ where: { factoryId: id } }),
    db.decisionCommit.count({ where: { factoryId: id } }),
    db.operationSchedule.count({ where: { factoryId: id } }),
    db.decisionCaseEvent.count({ where: { case: { factoryId: id } } }),
  ]);
}

test('independent registry create/rename, strict input, duplicate and role-before-lookup', async () => {
  const s = await factory(false),
    id = s.factory_id;
  expect((await http(`/factories/${id}`, { user: users.VIEWER })).body.data.has_snapshot).toBe(false);
  expect((await http(`/operations/overview?factory_id=${id}`, { user: users.VIEWER })).status).toBe(404);
  expect(
    (await http('/factories', { method: 'POST', body: { factory_id: id, name: 'duplicate' } })).status,
  ).toBe(409);
  for (const body of [
    { factory_id: '../x', name: 'x' },
    { factory_id: 'a', name: ' ' },
    { factory_id: 'a', name: 'x', role: 'ADMIN' },
    { factory_id: 'a', name: 'x'.repeat(201) },
  ])
    expect((await http('/factories', { method: 'POST', body })).status).toBe(400);
  for (const path of [
    `/factories/${id}/members`,
    '/factories/missing/members',
    '/factories/missing/members/not-uuid',
  ])
    expect(
      (await http(path, { method: path.endsWith('not-uuid') ? 'PUT' : 'GET', user: users.VIEWER })).status,
    ).toBe(403);
  const r = await http(`/factories/${id}`, { method: 'PATCH', body: { name: ' Renamed ' } });
  expect(r.body.data).toMatchObject({ factory_id: id, name: 'Renamed', has_snapshot: false });
  const repeat = await http(`/factories/${id}`, { method: 'PATCH', body: { name: 'Renamed' } });
  expect(repeat.body).toEqual(r.body);
  expect(
    (await http(`/factories/${id}`, { method: 'PATCH', body: { factory_id: 'changed', name: 'x' } })).status,
  ).toBe(400);
  expect((await http('/factories', { user: null })).status).toBe(401);
  expect((await http('/factories', { user: users.INACTIVE })).status).toBe(401);
  for (const q of ['limit=0', 'limit=101', 'limit=1&limit=2', 'state=active', 'cursor=bad'])
    expect((await http('/factories?' + q)).status).toBe(400);
  for (const r of [
    await http('/factories'),
    await http('/factories?bad=x'),
    await http('/factories', { user: null }),
  ]) {
    expect(r.cache).toBe('no-store');
    expect(r.requestId).toBe('factory-access-test');
  }
});

test('membership transitions, inactive targets, no-op timestamps/audit, lost response retry', async () => {
  const s = await factory(false),
    id = s.factory_id,
    u = users.OUTSIDER;
  const none = await member(id, u, 'DELETE');
  expect(none.body.data).toEqual({ membership: null, changed: false });
  const count = await auditCount(id);
  const grant = await member(id, u);
  expect(grant.body.data.changed).toBe(true);
  const first = grant.body.data.membership;
  const replay = await member(id, u);
  expect(replay.body.data).toEqual({ membership: first, changed: false });
  expect(await auditCount(id)).toBe(count + 1);
  const revoked = await member(id, u, 'DELETE');
  expect(revoked.body.data.membership).toMatchObject({
    membership_id: first.membership_id,
    active: false,
    revoked_by: users.ADMIN.id,
  });
  expect((await member(id, u, 'DELETE')).body.data).toEqual({
    membership: revoked.body.data.membership,
    changed: false,
  });
  expect(await auditCount(id)).toBe(count + 2);
  const regrant = await member(id, u);
  expect(regrant.body.data.membership).toMatchObject({
    membership_id: first.membership_id,
    active: true,
    revoked_at: null,
    revoked_by: null,
  });
  expect(await auditCount(id)).toBe(count + 3);
  expect((await member(id, users.INACTIVE)).body.error.code).toBe('TARGET_USER_INACTIVE');
  expect((await member(id, users.INACTIVE, 'DELETE')).body.data.changed).toBe(false);
  expect((await member(id, { id: randomUUID() })).status).toBe(404);
  expect((await member('unknown', u)).status).toBe(404);
  expect(
    (await http(`/factories/${id}/members/${u.id}`, { method: 'PUT', body: { role: 'ADMIN' } })).status,
  ).toBe(400);
  const rows = (await http(`/factories/${id}/members`)).body.data;
  expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_HASH|password|email|token/);
  expect(await db.user.findUnique({ where: { id: u.id } })).toMatchObject({ role: 'VIEWER' });
});

test('two-factory scope and all polling/read endpoints, viewer writes and same-token revocation', async () => {
  const a = await factory(),
    b = await factory();
  await member(b.factory_id, users.VIEWER, 'DELETE');
  const f = await ready(a);
  const paths = [
    `/operations/snapshot?factory_id=${a.factory_id}`,
    `/operations/overview?factory_id=${a.factory_id}`,
    `/schedules/current?factory_id=${a.factory_id}`,
    `/decision-cases?factory_id=${a.factory_id}`,
    `/decision-cases/${f.id}`,
    `/decision-cases/${f.id}/events`,
    `/decision-cases/${f.id}/recommendation`,
  ];
  const beforeReads = await effects(a.factory_id);
  for (const path of paths) expect((await http(path, { user: users.VIEWER })).status).toBe(200);
  expect(await effects(a.factory_id)).toEqual(beforeReads);
  expect((await http(`/operations/overview?factory_id=${b.factory_id}`, { user: users.VIEWER })).status).toBe(
    404,
  );
  expect((await create(a, { user: users.VIEWER })).response.status).toBe(403);
  expect((await create(a, { user: users.ENGINEER })).response.status).toBe(202);
  await member(a.factory_id, users.VIEWER, 'DELETE');
  for (const path of paths) {
    const r = await http(path, { user: users.VIEWER });
    expect(r.status).toBe(404);
    if (path.startsWith('/decision-cases/')) expect(r.body.error.code).toBe('DECISION_CASE_NOT_FOUND');
  }
  const factories = (await http('/factories?limit=100', { user: users.VIEWER })).body.data;
  expect(factories.some((r) => [a.factory_id, b.factory_id].includes(r.factory_id))).toBe(false);
  const before = await effects(a.factory_id);
  await member(a.factory_id, users.OPERATOR, 'DELETE');
  expect(
    (await http('/decision-cases', { method: 'POST', user: users.OPERATOR, body: f.body, key: f.key }))
      .status,
  ).toBe(404);
  expect(await effects(a.factory_id)).toEqual(before);
  // Global ADMIN is not restricted by a revoked personal membership.
  await member(a.factory_id, users.ADMIN);
  await member(a.factory_id, users.ADMIN, 'DELETE');
  expect((await http(`/factories/${a.factory_id}`)).status).toBe(200);
});

test('stable scoped pagination with bounded limits and actor/filter/source-bound cursors', async () => {
  const s = await factory(false),
    id = s.factory_id;
  for (let i = 0; i < 5; i++) {
    const u = await db.user.create({ data: { username: randomUUID(), passwordHash: 'x', role: 'VIEWER' } });
    await member(id, u);
    if (i % 2) await member(id, u, 'DELETE');
  }
  for (const state of ['all', 'active', 'revoked']) {
    let cursor,
      ids = [];
    do {
      const r = await http(
        `/factories/${id}/members?state=${state}&limit=2` + (cursor ? '&cursor=' + cursor : ''),
      );
      expect(r.status).toBe(200);
      ids.push(...r.body.data.map((m) => m.user.user_id));
      cursor = r.body.meta.next_cursor;
    } while (cursor);
    const oracle = await db.factoryMembership.findMany({
      where: { factoryId: id, ...(state === 'all' ? {} : { active: state === 'active' }) },
      orderBy: { userId: 'asc' },
    });
    expect(ids).toEqual(oracle.map((m) => m.userId));
    expect(new Set(ids).size).toBe(ids.length);
  }
  const c = (await http(`/factories/${id}/members?limit=1`)).body.meta.next_cursor;
  expect((await http(`/factories/${id}/members?state=active&cursor=${c}`)).status).toBe(400);
  const otherAdmin = await db.user.create({
    data: { username: randomUUID(), passwordHash: 'x', role: 'ADMIN' },
  });
  expect((await http(`/factories/${id}/members?cursor=${c}`, { user: otherAdmin })).status).toBe(400);
  let cursor,
    ids = [];
  do {
    const r = await http('/factories?limit=2' + (cursor ? '&cursor=' + cursor : ''), {
      user: users.ENGINEER,
    });
    expect(r.status).toBe(200);
    ids.push(...r.body.data.map((f) => f.factory_id));
    cursor = r.body.meta.next_cursor;
  } while (cursor);
  const oracle = await db.factory.findMany({
    where: { memberships: { some: { userId: users.ENGINEER.id, active: true } } },
    orderBy: { factoryId: 'asc' },
  });
  expect(ids).toEqual(oracle.map((f) => f.factoryId));
});

// A barrier inside the first transaction proves a second request is waiting for
// the actual PostgreSQL advisory lock before the first writer is released.
async function race(first, second, beforeRelease = async () => {}) {
  let entered, release;
  const selected = new Promise((r) => (entered = r)),
    resume = new Promise((r) => (release = r));
  const original = db.$transaction.bind(db);
  const spy = jest.spyOn(db, '$transaction').mockImplementationOnce((fn, opt) =>
    original(
      async (tx) => {
        const raw = tx.$queryRaw.bind(tx);
        return fn(
          new Proxy(tx, {
            get(target, prop) {
              if (prop === '$queryRaw')
                return async (...args) => {
                  const result = await raw(...args);
                  if (String(args[0]).includes('pg_advisory_xact_lock')) {
                    entered();
                    await resume;
                  }
                  return result;
                };
              return target[prop];
            },
          }),
        );
      },
      { ...opt, timeout: 20000 },
    ),
  );
  const one = first();
  let barrierTimer;
  try {
    await Promise.race([
      selected,
      new Promise((_, reject) => {
        barrierTimer = setTimeout(() => reject(new Error('Factory lock barrier was not reached')), 5000);
      }),
      one.then(() => {
        throw new Error('First request completed before acquiring its factory lock');
      }),
    ]);
    spy.mockRestore();
    const two = second();
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const locks =
        await db.$queryRaw`SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted`;
      if (locks[0].n > 0) {
        blocked = true;
        break;
      }
      await delay(20);
    }
    expect(blocked).toBe(true);
    await beforeRelease();
    release();
    return await Promise.all([one, two]);
  } finally {
    clearTimeout(barrierTimer);
    spy.mockRestore();
    release();
  }
}

test.each(['create', 'APPROVE', 'COMMIT', 'replay', 'commit-replay'])(
  'revoke vs %s: both serialization orders, no unauthorized side effects',
  async (kind) => {
    for (const revokeFirst of [true, false]) {
      const s = await factory(),
        id = s.factory_id;
      let body,
        key = randomUUID(),
        path = '/decision-cases';
      if (kind === 'create') {
        const h = await db.operationsHead.findUnique({ where: { factoryId: id } });
        body = {
          schema_version: '3.0',
          factory_id: id,
          expected_snapshot_id: s.snapshot_id,
          expected_plan_version: h.planVersion,
          request: {
            mode: 'LIVE',
            trigger: { type: 'MANUAL_REPLAN', reason: 'Concurrent' },
            planning_config: { horizon_minutes: 720 },
          },
        };
      } else {
        const f = await ready(s);
        if (kind === 'replay') {
          body = f.body;
          key = f.key;
        } else {
          body = f.command;
          path = `/decision-cases/${f.id}/decision`;
          if (kind === 'COMMIT' || kind === 'commit-replay') {
            expect((await decide(body)).status).toBe(200);
            body = { ...body, command: 'COMMIT', expected_case_revision: 7 };
            if (kind === 'commit-replay') {
              expect((await http(path, { method: 'POST', user: users.OPERATOR, body, key })).status).toBe(
                200,
              );
            }
          }
        }
      }
      const before = await effects(id),
        write = () => http(path, { method: 'POST', user: users.OPERATOR, body, key }),
        revoke = () => member(id, users.OPERATOR, 'DELETE');
      const results = await race(revokeFirst ? revoke : write, revokeFirst ? write : revoke);
      const w = results[revokeFirst ? 1 : 0];
      expect(results[revokeFirst ? 0 : 1].status).toBe(200);
      if (revokeFirst) {
        expect(w.status).toBe(404);
        expect(await effects(id)).toEqual(before);
      } else {
        expect(w.status).toBe(kind === 'create' || kind === 'replay' ? 202 : 200);
        if (kind === 'commit-replay') expect(await effects(id)).toEqual(before);
        expect((await write()).status).toBe(404);
      }
    }
  },
  60000,
);

test.each(['role', 'active'])(
  'queued write rechecks DB user %s after user administration commits',
  async (field) => {
    const s = await factory();
    const u = await db.user.create({ data: { username: randomUUID(), passwordHash: 'x', role: 'OPERATOR' } });
    await member(s.factory_id, u);
    const c = await create(s, { user: u });
    expect(c.response.status).toBe(202);
    const results = await race(
      () => member(s.factory_id, users.VIEWER, 'DELETE'),
      () => http('/decision-cases', { method: 'POST', user: u, body: c.body, key: c.key }),
      async () => {
        const update = await http('/users/' + u.id, {
          method: 'PATCH',
          body: field === 'role' ? { role: 'VIEWER' } : { active: false },
        });
        expect(update.status).toBe(200);
      },
    );
    expect(results[1].status).toBe(field === 'role' ? 403 : 401);
  },
);

test('membership and audit rollback atomically; historical records remain immutable', async () => {
  const s = await factory(false),
    id = s.factory_id;
  const before = await auditCount(id);
  const original = db.$transaction.bind(db);
  const spy = jest.spyOn(db, '$transaction').mockImplementationOnce((fn, opt) =>
    original(async (tx) => {
      return fn(
        new Proxy(tx, {
          get(target, prop) {
            return prop === 'auditLog'
              ? {
                  create: async () => {
                    throw new Error('Injected audit failure');
                  },
                }
              : target[prop];
          },
        }),
      );
    }, opt),
  );
  try {
    expect((await member(id, users.OUTSIDER)).status).toBe(500);
  } finally {
    spy.mockRestore();
  }
  expect(
    await db.factoryMembership.findUnique({
      where: { factoryId_userId: { factoryId: id, userId: users.OUTSIDER.id } },
    }),
  ).toBeNull();
  expect(await auditCount(id)).toBe(before);
  const audit = await db.auditLog.findFirst({ where: { factoryId: id } });
  await expect(db.auditLog.delete({ where: { id: audit.id } })).rejects.toThrow('immutable');
});

test('dry-run/import are atomic, repeatable, source-explicit and never resurrect revoked access', async () => {
  const s = await factory(false),
    id = s.factory_id,
    raw = JSON.stringify({ [id]: [users.OUTSIDER.id, users.INACTIVE.id] });
  const before = await auditCount(id);
  const dry = await importFactoryAccess(db, raw);
  expect(dry).toMatchObject({ apply: false, created: 0, would_create: 2 });
  expect(dry.inactive_users).toContain(users.INACTIVE.id);
  expect(await auditCount(id)).toBe(before);
  for (const input of [
    'bad',
    '[]',
    JSON.stringify({ [id]: ['not-uuid'] }),
    JSON.stringify({ missing: [users.OUTSIDER.id] }),
    JSON.stringify({ [id]: [users.OUTSIDER.id, randomUUID()] }),
  ])
    await expect(importFactoryAccess(db, input, { apply: true })).rejects.toThrow();
  expect(await auditCount(id)).toBe(before);
  const failing = {
    $transaction: (fn, options) =>
      db.$transaction(
        (tx) =>
          fn(
            new Proxy(tx, {
              get(target, prop) {
                return prop === 'auditLog'
                  ? {
                      create: async () => {
                        throw new Error('Injected import audit failure');
                      },
                    }
                  : target[prop];
              },
            }),
          ),
        options,
      ),
  };
  await expect(importFactoryAccess(failing, raw, { apply: true })).rejects.toThrow(
    'Injected import audit failure',
  );
  expect(
    await db.factoryMembership.count({
      where: { factoryId: id, userId: { in: [users.OUTSIDER.id, users.INACTIVE.id] } },
    }),
  ).toBe(0);
  expect(await auditCount(id)).toBe(before);
  expect((await importFactoryAccess(db, raw, { apply: true })).created).toBe(2);
  const count = await db.auditLog.count();
  expect((await importFactoryAccess(db, raw, { apply: true })).created).toBe(0);
  expect(await db.auditLog.count()).toBe(count);
  await member(id, users.OUTSIDER, 'DELETE');
  const conflict = await importFactoryAccess(db, raw, { apply: true });
  expect(conflict.revoked_conflicts).toEqual([{ factoryId: id, userId: users.OUTSIDER.id }]);
  expect((await http(`/factories/${id}`, { user: users.OUTSIDER })).status).toBe(404);
  expect((await db.user.findUnique({ where: { id: users.INACTIVE.id } })).active).toBe(false);
  expect((await member(id, users.INACTIVE, 'DELETE')).body.data.changed).toBe(true);
  expect((await member(id, users.INACTIVE)).status).toBe(409);
});

test('environment rollout mode is exclusive; membership administration cannot report false success; outage never falls back', async () => {
  const s = await factory(false),
    id = s.factory_id;
  try {
    process.env.FACTORY_ACCESS_SOURCE = 'environment';
    process.env.OPERATIONS_FACTORY_ACCESS = JSON.stringify({ [id]: [users.OUTSIDER.id] });
    expect(
      (
        await http('/factories', {
          method: 'POST',
          body: { factory_id: 'constructor', name: 'Opaque identifier' },
        })
      ).status,
    ).toBe(201);
    expect((await http('/factories/constructor', { user: users.OUTSIDER })).status).toBe(404);
    expect((await http(`/factories/${id}`, { user: users.OUTSIDER })).status).toBe(200);
    expect((await http(`/factories/${id}`, { user: users.VIEWER })).status).toBe(404);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const path = `/factories/${id}/members` + (method === 'GET' ? '' : '/' + users.OUTSIDER.id);
      const r = await http(path, { method });
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('FACTORY_ACCESS_MODE_MISMATCH');
    }
    process.env.OPERATIONS_FACTORY_ACCESS = 'malformed';
    expect((await http(`/factories/${id}`, { user: users.OUTSIDER })).status).toBe(503);
    process.env.FACTORY_ACCESS_SOURCE = 'database';
    process.env.OPERATIONS_FACTORY_ACCESS = JSON.stringify({ [id]: [users.OUTSIDER.id] });
    expect((await http(`/factories/${id}`, { user: users.OUTSIDER })).status).toBe(404);
    const original = db.$transaction.bind(db),
      spy = jest.spyOn(db, '$transaction').mockImplementationOnce((fn, opt) =>
        original(async (tx) => {
          return fn(
            new Proxy(tx, {
              get(target, prop) {
                return prop === 'factoryMembership'
                  ? {
                      findUnique: async () => {
                        throw Object.assign(new Error('private'), { code: 'P1001' });
                      },
                    }
                  : target[prop];
              },
            }),
          );
        }, opt),
      );
    try {
      expect((await http(`/factories/${id}`, { user: users.VIEWER })).status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  } finally {
    process.env.FACTORY_ACCESS_SOURCE = 'database';
  }
});

test('normal ingest requires registry and rename preserves immutable telemetry/hash/basis', async () => {
  const s = { ...structuredClone(seed), factory_id: 'unregistered-' + randomUUID(), current_schedule: null };
  await expect(
    ingestFactorySnapshot(
      { factoryId: s.factory_id, expectedHeadRevision: 0, snapshot: s, sourceId: 'test' },
      db,
    ),
  ).rejects.toMatchObject({ code: 'FACTORY_NOT_REGISTERED' });
  const a = await factory(),
    before = await db.factorySnapshot.findMany({ where: { factoryId: a.factory_id } });
  const head = await db.operationsHead.findUnique({ where: { factoryId: a.factory_id } });
  expect(
    (await http(`/factories/${a.factory_id}`, { method: 'PATCH', body: { name: 'New display' } })).status,
  ).toBe(200);
  expect(await db.factorySnapshot.findMany({ where: { factoryId: a.factory_id } })).toEqual(before);
  expect(await db.operationsHead.findUnique({ where: { factoryId: a.factory_id } })).toEqual(head);
});

test('worker completes accepted work after creator loses access without impersonation', async () => {
  const s = await factory();
  const f = await ready(s, () => member(s.factory_id, users.OPERATOR, 'DELETE'));
  expect((await http('/decision-cases/' + f.id + '/recommendation', { user: users.OPERATOR })).status).toBe(
    404,
  );
  expect((await http('/decision-cases/' + f.id)).body.data.status).toBe('AWAITING_APPROVAL');
  expect((await decide(f.command)).status).toBe(404);
});
