const { randomUUID, createHmac } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { contentHash, validatePayload, loadCanonicalSeedPlan } = require('../../src/services/operations-contract.service');
const { ingestFactorySnapshot } = require('../helpers/factory-fixtures');
const { createDecisionCase } = require('../../src/services/decision-case.service');
const { claimDecisionCase, persistDecisionRecommendation } = require('../../src/services/decision-planning.service');
const { executeDecisionCommand } = require('../../src/services/decision-command.service');
const { listDecisionCases } = require('../../src/services/decision-case-list.service');
const example = require('../../../contracts/v3/examples/demo-scenario.json');

describe('decision case discovery and event pagination over real HTTP/PostgreSQL', () => {
  let server, base, factory, otherFactory, emptyFactory, snapshot, users, approved, rejected, committed;
  const previousAccess = process.env.OPERATIONS_FACTORY_ACCESS;
  let access;
  beforeAll(async () => {
    const seed = await validatePayload(await loadCanonicalSeedPlan(), 'seed');
    factory = `list-${randomUUID()}`; otherFactory = `other-${randomUUID()}`; emptyFactory = `empty-${randomUUID()}`;
    users = Object.fromEntries(await Promise.all(['ADMIN', 'OPERATOR', 'ENGINEER', 'VIEWER', 'OUTSIDER'].map(async name =>
      [name, await db.user.create({ data: { username: randomUUID(), passwordHash: 'unused', role: name === 'OUTSIDER' ? 'OPERATOR' : name } })])));
    for (const id of [factory, otherFactory, emptyFactory]) {
      const payload = structuredClone(seed); payload.factory_id = id; payload.current_schedule.factory_id = id;
      await ingestFactorySnapshot({ factoryId: id, expectedHeadRevision: 0, snapshot: payload, sourceId: 'list-tests' }, db);
      if (id === factory) snapshot = payload;
    }
    access = JSON.stringify({ [factory]: ['OPERATOR', 'ENGINEER', 'VIEWER'].map(role => users[role].id),
      [otherFactory]: [users.OUTSIDER.id], [emptyFactory]: [users.VIEWER.id] });
    process.env.OPERATIONS_FACTORY_ACCESS = access;
    // Real DB microseconds include both exact timestamp ties and distinct values
    // that would collapse to the same JavaScript millisecond. UUID order opposes time order.
    const times = ['.123457', '.123457', '.123456', '.123456', '.123456', '.123456', '.123455', '.123455', '.123455', '.123455'];
    for (let n = 0; n < times.length; n++) {
      const id = `10000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`;
      const status = n % 3 === 0 ? 'FAILED' : 'CREATED';
      const mode = n % 2 === 0 ? 'LIVE' : 'SIMULATION_ONLY';
      const at = `2026-10-10T00:00:00${times[n]}Z`;
      await db.$executeRaw`INSERT INTO decision_cases
        (id,factory_id,snapshot_id,base_plan_version,mode,status,request_json,request_hash,actor_id,
         created_at,updated_at,processing_status,processing_error_code)
        VALUES (${id}::uuid,${factory},${snapshot.snapshot_id},0,${mode},${status},
          '{"private_marker":"NEVER_RETURN_REQUEST"}'::jsonb,${contentHash({ private_marker: 'NEVER_RETURN_REQUEST' })},
          ${users.ADMIN.id}::uuid,${at}::timestamptz,${at}::timestamptz,
          ${status === 'FAILED' ? 'FAILED' : 'PENDING'},${status === 'FAILED' ? 'PLANNING_FAILED' : null})`;
    }
    await db.decisionCase.create({ data: { factoryId: otherFactory, snapshotId: snapshot.snapshot_id,
      basePlanVersion: 0, mode: 'LIVE', requestJson: { private_marker: 'OTHER_FACTORY_SECRET' },
      requestHash: contentHash({}), actorId: users.ADMIN.id } });
    committed = await decision('COMMIT');
    approved = await decision('APPROVE');
    rejected = await decision('REJECT');
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/v1/decision-cases`;
  }, 30000);
  afterAll(async () => {
    if (previousAccess === undefined) delete process.env.OPERATIONS_FACTORY_ACCESS; else process.env.OPERATIONS_FACTORY_ACCESS = previousAccess;
    if (server) await new Promise(resolve => server.close(resolve));
    await db.$disconnect();
  });
  async function decision(command) {
    const head = await db.operationsHead.findUnique({ where: { factoryId: factory } });
    const created = await createDecisionCase(db, users.ADMIN, { schema_version: '3.0', factory_id: factory,
      expected_snapshot_id: snapshot.snapshot_id, expected_plan_version: head.planVersion,
      request: { mode: 'LIVE', trigger: { type: 'MANUAL_REPLAN', reason: 'List summary fixture' }, planning_config: { horizon_minutes: 720 } } }, randomUUID());
    const id = created.body.data.decision_case_id;
    const lease = await claimDecisionCase(db, { caseId: id, expectedRevision: 1, workerId: randomUUID() });
    const candidate = { ...structuredClone(example.candidate_plans[0]), decision_case_id: id, snapshot_id: snapshot.snapshot_id,
      schedule: { ...structuredClone(snapshot.current_schedule), schedule_id: `list-schedule-${id}` } };
    candidate.validation = { schema_version: '3.0', validation_id: 'list-validation', candidate_plan_id: candidate.candidate_plan_id,
      validator_version: 'operations-validator-v1', verdict: 'VALID', validated_at: candidate.generated_at, violations: [] };
    const recommendation = { schema_version: '3.0', recommendation_id: `list-rec-${id}`, decision_case_id: id,
      snapshot_id: snapshot.snapshot_id, generated_at: candidate.generated_at, recommended_plan_id: candidate.candidate_plan_id,
      candidate_plans: [candidate], explanation: { summary: 'NEVER_RETURN_ARTIFACT', primary_reasons: ['Feasible'], tradeoffs: ['No change'],
        residual_risks: [], evidence_refs: [snapshot.snapshot_id] } };
    await persistDecisionRecommendation(db, { caseId: id, expectedRevision: lease.revision, leaseToken: lease.leaseToken, recommendation });
    const body = { schema_version: '3.0', decision_case_id: id, recommendation_id: recommendation.recommendation_id,
      expected_snapshot_id: snapshot.snapshot_id, expected_plan_version: head.planVersion, expected_case_revision: 6,
      ...(command === 'REJECT' ? { command: 'REJECT', note: 'NEVER_RETURN_NOTE' } : { command: 'APPROVE',
        candidate_plan_id: candidate.candidate_plan_id, candidate_version: candidate.plan_version, note: 'NEVER_RETURN_NOTE' }) };
    await executeDecisionCommand(db, users.ADMIN, id, body, randomUUID());
    if (command === 'COMMIT') {
      const { note, ...commitBody } = body;
      await executeDecisionCommand(db, users.ADMIN, id, { ...commitBody, command: 'COMMIT', expected_case_revision: 7 }, randomUUID());
    }
    return id;
  }
  async function http(query = {}, user = users.VIEWER, path = '') {
    const response = await fetch(`${base}${path}?${typeof query === 'string' ? query : new URLSearchParams(query)}`, {
      headers: user ? { Authorization: `Bearer ${jwt.sign({ id: user.id }, process.env.JWT_SECRET)}` } : {} });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }
  const list = (query = {}, user) => http({ factory_id: factory, ...query }, user);
  async function ordered(filters = {}) {
    // Ask PostgreSQL itself for the ordering oracle; do not round timestamps in JS.
    const all = await db.$queryRaw`SELECT id, status, mode FROM decision_cases WHERE factory_id=${factory} ORDER BY created_at DESC,id DESC`;
    return all.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value)).map(row => row.id);
  }
  async function walk(filters = {}, limit = '2') {
    let cursor, all = [], pages = 0;
    do {
      const result = await list({ ...filters, limit, ...(cursor ? { cursor } : {}) });
      expect(result.status).toBe(200); expect(result.cache).toBe('no-store');
      all.push(...result.body.data.map(row => row.decision_case_id));
      expect(result.body.meta.has_more).toBe(result.body.meta.next_cursor !== null);
      cursor = result.body.meta.next_cursor;
      expect(++pages).toBeLessThan(30);
    } while (cursor);
    return all;
  }
  test.each(['1', '2', '3', '5', '100'])('limit %s: fixed data has no duplicates/omissions, including exact and microsecond timestamp ties', async limit => {
    const ids = await walk({}, limit);
    expect(ids).toEqual(await ordered()); expect(new Set(ids).size).toBe(ids.length);
  });
  test.each([{ status: 'CREATED' }, { status: 'FAILED' }, { status: 'APPROVED' }, { status: 'REJECTED' },
    { status: 'COMMITTED' }, { mode: 'LIVE' }, { mode: 'SIMULATION_ONLY' }, { status: 'CREATED', mode: 'SIMULATION_ONLY' }])('filters %j compose with pagination', async filters => {
    expect(await walk(filters)).toEqual(await ordered(filters));
  });
  test('default limit, empty/no-match factory and last-page metadata', async () => {
    expect((await list()).body.meta).toEqual({ factory_id: factory, limit: 25, has_more: false, next_cursor: null });
    for (const query of [{ factory_id: emptyFactory }, { factory_id: factory, status: 'CANCELLED' }]) {
      const response = await http(query);
      expect(response.status).toBe(200); expect(response.body.data).toEqual([]);
      expect(response.body.meta).toMatchObject({ has_more: false, next_cursor: null });
    }
  });
  test('changing limit keeps the cursor valid and changing filters/factory/actor does not', async () => {
    const first = await list({ limit: '1', status: 'CREATED' }, users.ADMIN);
    const cursor = first.body.meta.next_cursor;
    const next = await list({ limit: '100', status: 'CREATED', cursor }, users.ADMIN);
    expect(next.status).toBe(200);
    expect([...first.body.data, ...next.body.data].map(row => row.decision_case_id)).toEqual(await ordered({ status: 'CREATED' }));
    for (const [query, user] of [[{ cursor }, users.ADMIN], [{ cursor, status: 'FAILED' }, users.ADMIN],
      [{ cursor, status: 'CREATED', mode: 'LIVE' }, users.ADMIN], [{ cursor, status: 'CREATED', factory_id: otherFactory }, users.ADMIN],
      [{ cursor, status: 'CREATED' }, users.VIEWER]]) {
      const result = await list(query, user);
      expect(result.status).toBe(400); expect(result.body.error.code).toBe('INVALID_CURSOR');
    }
  });
  test('malformed, tampered and signed-but-invalid cursor payloads are rejected', async () => {
    const cursor = (await list({ limit: '1' })).body.meta.next_cursor;
    const [payload, signature] = cursor.split('.');
    const sign = p => `${p}.${createHmac('sha256', process.env.JWT_SECRET).update('decision-case-list:v1:').update(p).digest('base64url')}`;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url'));
    const invalid = ['', 'bad', 'a.b', 'x'.repeat(2049), `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`, sign('bm90LWpzb24')];
    for (const change of [{ v: 2 }, { id: 'not-uuid' }, { created_at: '2026-02-30T00:00:00.123456Z' }, { created_at: '2026-10-11T00:00:00.123Z' }, { extra: true }])
      invalid.push(sign(Buffer.from(JSON.stringify({ ...decoded, ...change })).toString('base64url')));
    for (const cursor of invalid) {
      const response = await list({ cursor });
      expect(response.status).toBe(400); expect(response.body.error.code).toBe('INVALID_CURSOR');
    }
  });
  test.each(['limit=0', 'limit=101', 'limit=-1', 'limit=1.5', 'limit=01', 'limit=abc', 'limit=1&limit=2',
    'status=UNKNOWN', 'status=CREATED&status=FAILED', 'mode=WHAT_IF', 'mode=LIVE&mode=LIVE', 'extra=x', 'cursor=x&cursor=y'])('invalid query %s returns 400', async suffix => {
    expect((await http(`factory_id=${factory}&${suffix}`)).status).toBe(400);
  });
  test('factory is required and repeated/invalid factory IDs are rejected', async () => {
    for (const query of ['', 'factory_id=', `factory_id=${factory}&factory_id=${otherFactory}`, 'factory_id=../private'])
      expect((await http(query)).status).toBe(400);
  });
  test.each(['ADMIN', 'OPERATOR', 'ENGINEER', 'VIEWER'])('authorized %s can list cases created by another actor', async role => {
    const response = await list({}, users[role]);
    expect(response.status).toBe(200); expect(response.body.data).toHaveLength(13);
  });
  test('authentication, factory isolation and access revocation apply to every page', async () => {
    expect((await list({}, null)).status).toBe(401);
    for (const query of [{ factory_id: factory }, { factory_id: 'missing-factory' }]) {
      const response = await http(query, users.OUTSIDER);
      expect(response.status).toBe(404); expect(response.body.error.code).toBe('FACTORY_NOT_FOUND');
    }
    expect((await http({ factory_id: 'missing-factory' }, users.ADMIN)).status).toBe(404);
    const outside = await http({ factory_id: otherFactory }, users.OUTSIDER);
    expect(outside.status).toBe(200); expect(outside.body.data).toHaveLength(1);
    expect(outside.body.data[0].factory_id).toBe(otherFactory);
    expect((await list({}, users.ADMIN)).body.data.every(row => row.factory_id === factory)).toBe(true);
    const cursor = (await list({ limit: '1' })).body.meta.next_cursor;
    try {
      process.env.OPERATIONS_FACTORY_ACCESS = '{}';
      expect((await list({ cursor })).status).toBe(404);
      expect((await http({}, users.VIEWER, `/${committed}/events`)).status).toBe(404);
    } finally { process.env.OPERATIONS_FACTORY_ACCESS = access; }
  });
  test('summary agrees with actual decisions/publication/head and excludes private content', async () => {
    const result = await list(), rows = result.body.data;
    expect(rows.find(row => row.decision_case_id === committed)).toMatchObject({ status: 'COMMITTED', stale: true,
      base_plan_version: 0, current_context: { plan_version: 1 }, human_decision: { decision: 'APPROVE', actor_id: users.ADMIN.id },
      publication: { plan_version: 1, schedule_id: `list-schedule-${committed}`, snapshot_id: snapshot.snapshot_id } });
    expect(rows.find(row => row.decision_case_id === approved)).toMatchObject({ status: 'APPROVED', stale: false, publication: null });
    expect(rows.find(row => row.decision_case_id === rejected)).toMatchObject({ status: 'REJECTED', stale: false,
      human_decision: { decision: 'REJECT', candidate_plan_id: null, candidate_version: null }, publication: null });
    const serialized = JSON.stringify(result.body);
    for (const privateValue of ['NEVER_RETURN_', 'OTHER_FACTORY_SECRET', 'request_json', 'payloadJson', 'lease_token', 'note', 'candidate_plans'])
      expect(serialized).not.toContain(privateValue);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(Object.keys(require('../../examples/decision-cases.list.json').data[0]).sort());
  });
  test('one page uses one consistent read transaction even if head changes between queries', async () => {
    const head = await db.operationsHead.findUnique({ where: { factoryId: factory } });
    let insertedId;
    const interleaved = { $transaction: (fn, options) => db.$transaction(tx => fn(new Proxy(tx, { get(target, prop) {
      if (prop === 'operationsHead') return { findUnique: async args => {
        const value = await target.operationsHead.findUnique(args);
        await db.operationsHead.update({ where: { factoryId: factory }, data: { planVersion: head.planVersion + 1 } });
        const inserted = await db.decisionCase.create({ data: { factoryId: factory, snapshotId: snapshot.snapshot_id,
          basePlanVersion: head.planVersion + 1, mode: 'LIVE', requestJson: {}, requestHash: contentHash({}), actorId: users.ADMIN.id } });
        insertedId = inserted.id;
        return value;
      } };
      return target[prop];
    } })), options) };
    try {
      const result = await listDecisionCases(interleaved, users.VIEWER, { factory_id: factory });
      expect(result.data.every(row => row.current_context.plan_version === head.planVersion)).toBe(true);
      expect(result.data.find(row => row.decision_case_id === approved).stale).toBe(false);
      expect(result.data.some(row => row.decision_case_id === insertedId)).toBe(false);
      expect((await list()).body.data.some(row => row.decision_case_id === insertedId)).toBe(true);
    } finally { await db.operationsHead.update({ where: { factoryId: factory }, data: { planVersion: head.planVersion } }); }
  });
  test('events use exclusive sequence pagination, expose command provenance, and preserve cursor on empty poll', async () => {
    const events = []; let after = 0, more;
    do {
      const result = await http({ after_sequence: String(after), limit: '2' }, users.VIEWER, `/${committed}/events`);
      expect(result.status).toBe(200); expect(result.cache).toBe('no-store');
      events.push(...result.body.data); after = result.body.meta.next_after_sequence; more = result.body.meta.has_more;
    } while (more);
    expect(events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(events.slice(-2).map(event => event.payload.command)).toEqual(['APPROVE', 'COMMIT']);
    expect(events.at(-1)).toMatchObject({ actor: { kind: 'HUMAN', id: users.ADMIN.id }, payload: { plan_version: 1, revision: 8 } });
    expect(events.at(-1).payload.candidate_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(events.at(-1).payload.schedule_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(events.every(event => !Number.isNaN(Date.parse(event.occurred_at)))).toBe(true);
    const end = await http({ after_sequence: String(after) }, users.VIEWER, `/${committed}/events`);
    expect(end.body).toMatchObject({ data: [], meta: { has_more: false, next_after_sequence: 8 } });
    const rejection = await http({ after_sequence: '6' }, users.VIEWER, `/${rejected}/events`);
    expect(rejection.body.data[0].payload).toMatchObject({ command: 'REJECT', candidate_plan_id: null, candidate_hash: null });
    expect((await http({}, users.OUTSIDER, `/${committed}/events`)).status).toBe(404);
    expect((await http({}, null, `/${committed}/events`)).status).toBe(401);
    for (const query of ['after_sequence=-1', 'after_sequence=01', 'after_sequence=abc', 'limit=0', 'limit=201', 'extra=x'])
      expect((await http(query, users.VIEWER, `/${committed}/events`)).status).toBe(400);
  });
  test('list and event reads leave cases, heads, schedules, human decisions, publications, events and receipts unchanged', async () => {
    const state = () => Promise.all([
      db.decisionCase.findMany({ where: { factoryId: factory }, orderBy: { id: 'asc' } }),
      db.operationsHead.findUnique({ where: { factoryId: factory } }),
      db.operationSchedule.findMany({ where: { factoryId: factory }, orderBy: { scheduleId: 'asc' } }),
      db.decisionHumanRecord.findMany({ where: { case: { factoryId: factory } }, orderBy: { caseId: 'asc' } }),
      db.decisionCommit.findMany({ where: { factoryId: factory }, orderBy: { caseId: 'asc' } }),
      db.decisionCaseEvent.findMany({ where: { case: { factoryId: factory } }, orderBy: { id: 'asc' } }),
      db.decisionCaseIdempotencyReceipt.findMany({ where: { factoryId: factory }, orderBy: { id: 'asc' } }),
    ]);
    const before = await state();
    await walk(); await walk({ status: 'CREATED' });
    await http({}, users.VIEWER, `/${committed}/events`); await list({ cursor: 'invalid' });
    expect(await state()).toEqual(before);
  });
});
