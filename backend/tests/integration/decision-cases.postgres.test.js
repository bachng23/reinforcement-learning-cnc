const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { loadCanonicalSeedPlan, validatePayload, contentHash } = require('../../src/services/operations-contract.service');
const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');
const { createDecisionCase } = require('../../src/services/decision-case.service');

describe('Decision case creation and durable history', () => {
  let server, base, plan, factoryId, body;
  const users = {};
  const priorAccess = process.env.OPERATIONS_FACTORY_ACCESS;
  beforeAll(async () => {
    plan = await loadCanonicalSeedPlan();
    factoryId = `cases-${randomUUID()}`;
    const snapshot = structuredClone(plan.run_request.factory_snapshot);
    snapshot.factory_id = factoryId;
    snapshot.current_schedule = null;
    await ingestFactorySnapshot({ factoryId, expectedHeadRevision: 0, snapshot, sourceId: 'case-tests' }, db);
    await db.operationsHead.update({ where: { factoryId }, data: { planVersion: 1 } });
    for (const role of ['ADMIN', 'OPERATOR', 'ENGINEER', 'VIEWER', 'outsider']) {
      users[role] = await db.user.create({ data: { username: randomUUID(), passwordHash: 'unused', role: role === 'outsider' ? 'VIEWER' : role } });
    }
    process.env.OPERATIONS_FACTORY_ACCESS = JSON.stringify({ [factoryId]: ['OPERATOR', 'ENGINEER', 'VIEWER'].map(r => users[r].id) });
    body = { factory_id: factoryId, schema_version: '3.0', expected_snapshot_id: plan.run_request.factory_snapshot.snapshot_id,
      expected_plan_version: 1, request: { mode: 'LIVE', trigger: { type: 'MANUAL_REPLAN', reason: 'Replan production' }, planning_config: { horizon_minutes: 720 } } };
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/v1/decision-cases`;
  });
  afterAll(async () => {
    if (priorAccess === undefined) delete process.env.OPERATIONS_FACTORY_ACCESS; else process.env.OPERATIONS_FACTORY_ACCESS = priorAccess;
    if (server) await new Promise(resolve => server.close(resolve));
    await db.$disconnect();
  });
  async function http(method = 'POST', path = '', value = body, role = 'ADMIN', key = randomUUID()) {
    const headers = { 'Content-Type': 'application/json' };
    if (role) headers.Authorization = `Bearer ${jwt.sign({ id: users[role].id }, process.env.JWT_SECRET)}`;
    if (key !== null) headers['Idempotency-Key'] = key;
    const response = await fetch(base + path, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(value) } : {}) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const counts = async () => [await db.decisionCase.count(), await db.decisionCaseEvent.count(), await db.decisionCaseIdempotencyReceipt.count()];
  test('create returns generated status, UUID/Location and exactly one immutable initial event', async () => {
    const result = await http();
    expect(result.status).toBe(202);
    const id = result.body.data.decision_case_id;
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.headers.get('location')).toBe(`/api/v1/decision-cases/${id}`);
    expect(result.body.data).toMatchObject({ status: 'CREATED', recommendation_id: null });
    expect(await validatePayload(result.body.data, 'case-status')).toMatchObject({ decision_case_id: id, status: 'CREATED' });
    const row = await db.decisionCase.findUnique({ where: { id } });
    expect(row).toMatchObject({ revision: 1, snapshotId: body.expected_snapshot_id, basePlanVersion: 1, actorId: users.ADMIN.id });
    expect(row.requestHash).toBe(contentHash(row.requestJson));
    const events = await db.decisionCaseEvent.findMany({ where: { caseId: id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sequence: 1, type: 'CASE_CREATED', actorId: users.ADMIN.id });
    for (const table of ['decision_cases', 'decision_case_events', 'decision_case_idempotency_receipts']) {
      await expect(db.$executeRawUnsafe(`UPDATE ${table} SET id=id`)).rejects.toThrow('immutable');
      await expect(db.$executeRawUnsafe(`DELETE FROM ${table}`)).rejects.toThrow('immutable');
      await expect(db.$executeRawUnsafe(`TRUNCATE ${table} CASCADE`)).rejects.toThrow('immutable');
    }
  });
  test('replay returns exact prior response even after head changed; different body conflicts', async () => {
    const key = randomUUID();
    const first = await http('POST', '', body, 'ADMIN', key);
    const before = await counts();
    await db.operationsHead.update({ where: { factoryId }, data: { planVersion: 2 } });
    try {
      const replay = await http('POST', '', body, 'ADMIN', key);
      expect(replay.status).toBe(202);
      expect(replay.body).toEqual(first.body);
      expect(replay.headers.get('idempotency-replayed')).toBe('true');
      expect((await http('POST', '', { ...body, expected_plan_version: 2 }, 'ADMIN', key)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      const read = await http('GET', `/${first.body.data.decision_case_id}`);
      expect(read.body.data).toEqual(first.body.data);
      expect(read.body.meta).toMatchObject({ stale: true, current_context: { plan_version: 2 } });
      expect(await counts()).toEqual(before);
    } finally { await db.operationsHead.update({ where: { factoryId }, data: { planVersion: 1 } }); }
  });
  test('simultaneous duplicate requests create one case, event and receipt', async () => {
    const before = await counts(), key = randomUUID();
    const results = await Promise.all([http('POST', '', body, 'ADMIN', key), http('POST', '', body, 'ADMIN', key)]);
    expect(results.map(r => r.status)).toEqual([202, 202]);
    expect(results[0].body).toEqual(results[1].body);
    expect(results.filter(r => r.headers.get('idempotency-replayed') === 'true')).toHaveLength(1);
    expect(await counts()).toEqual(before.map(n => n + 1));
  });
  test.each([['expected_snapshot_id', 'old-snapshot', 'SNAPSHOT_CONFLICT'], ['expected_plan_version', 0, 'PLAN_VERSION_CONFLICT']])('stale %s creates no rows', async (field, value, code) => {
    const before = await counts();
    const response = await http('POST', '', { ...body, [field]: value });
    expect(response.status).toBe(409); expect(response.body.error.code).toBe(code);
    expect(await counts()).toEqual(before);
  });
  test.each(['decisionCaseEvent', 'decisionCaseIdempotencyReceipt'])('%s insertion failure rolls back transaction', async model => {
    const before = await counts();
    const broken = { $transaction: (fn, options) => db.$transaction(tx => fn(new Proxy(tx, { get(target, key) {
      return key === model ? new Proxy(target[key], { get(delegate, method) {
        return method === 'create' ? () => { throw new Error('injected insertion failure'); } : delegate[method];
      } }) : target[key];
    } })), options) };
    await expect(createDecisionCase(broken, users.ADMIN, body, randomUUID())).rejects.toThrow('injected insertion failure');
    expect(await counts()).toEqual(before);
  });
  test.each(['ADMIN', 'OPERATOR', 'ENGINEER', 'VIEWER'])('role matrix %s', async role => {
    expect((await http('POST', '', body, role)).status).toBe(role === 'VIEWER' ? 403 : 202);
    const made = await http();
    const id = made.body.data.decision_case_id;
    expect((await http('GET', `/${id}`, undefined, role)).status).toBe(200);
    expect((await http('GET', `/${id}/events`, undefined, role)).status).toBe(200);
  });
  test('access checks do not disclose cases; unauthenticated and ungranted writes fail', async () => {
    const made = await http(), id = made.body.data.decision_case_id;
    for (const suffix of ['', '/events']) {
      const hidden = await http('GET', `/${id}${suffix}`, undefined, 'outsider');
      const missing = await http('GET', `/${randomUUID()}${suffix}`, undefined, 'outsider');
      expect(hidden.status).toBe(404); expect(missing.status).toBe(404);
      expect(hidden.body.error).toEqual(missing.body.error);
    }
    expect((await http('POST', '', body, null)).status).toBe(401);
    expect((await http('POST', '', { ...body, factory_id: 'ungranted' }, 'OPERATOR')).status).toBe(404);
  });
  test('strict requests reject server fields, unknown nested properties and missing key', async () => {
    const before = await counts();
    for (const field of ['actor_id', 'status', 'revision', 'created_at', 'unknown']) expect((await http('POST', '', { ...body, [field]: 'bad' })).status).toBe(400);
    expect((await http('POST', '', body, 'ADMIN', null)).status).toBe(400);
    for (const change of [{ actor_id: 'fake' }, { occurred_at: '2026-01-01T00:00:00Z' }, { event_id: 'fake' }]) {
      expect((await http('POST', '', { ...body, request: { ...body.request, trigger: { ...body.request.trigger, ...change } } })).status).toBe(400);
    }
    expect((await http('POST', '', { ...body, request: { ...body.request, planning_config: { horizon_minutes: '720' } } })).status).toBe(400);
    expect(await counts()).toEqual(before);
  });
  test('event pagination, empty pages, invalid cursors, uniqueness and sanitized payloads', async () => {
    const made = await http(), id = made.body.data.decision_case_id;
    // Arrange future append-only events without adding a worker or transition endpoint.
    for (const sequence of [3, 2]) await db.decisionCaseEvent.create({ data: { caseId: id, sequence, type: 'TEST_EVENT', actorId: users.ADMIN.id,
      payloadJson: { password: 'must-not-leak', stack: 'private-stack', reasoning: 'private-reasoning' } } });
    await expect(db.decisionCaseEvent.create({ data: { caseId: id, sequence: 1, type: 'TEST_EVENT', actorId: users.ADMIN.id, payloadJson: {} } })).rejects.toMatchObject({ code: 'P2002' });
    const first = await http('GET', `/${id}/events?limit=2`);
    expect(first.body.data.map(e => e.sequence)).toEqual([1, 2]);
    expect(first.body.meta).toEqual({ has_more: true, next_after_sequence: 2 });
    const last = await http('GET', `/${id}/events?after_sequence=2&limit=2`);
    expect(last.body.data.map(e => e.sequence)).toEqual([3]);
    expect(last.body.meta).toEqual({ has_more: false, next_after_sequence: 3 });
    expect(last.body.data[0].payload).toEqual({});
    const empty = await http('GET', `/${id}/events?after_sequence=999`);
    expect(empty.body).toMatchObject({ data: [], meta: { next_after_sequence: 999, has_more: false } });
    for (const query of ['after_sequence=-1', 'after_sequence=1.2', 'after_sequence=abc', 'after_sequence=2147483648', 'limit=201', 'limit=0', 'after_sequence=1&after_sequence=2', 'unknown=x']) {
      expect((await http('GET', `/${id}/events?${query}`)).status).toBe(400);
    }
  });
});
