const { randomUUID } = require('node:crypto');
const { bootstrapFactory } = require('../../src/services/factory-registry.service');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { contentHash, validatePayload, loadCanonicalSeedPlan } = require('../../src/services/operations-contract.service');
const { ingestFactorySnapshot } = require('../helpers/factory-fixtures');
const { claimDecisionCase, persistDecisionRecommendation, recordDecisionPlanningFailure } = require('../../src/services/decision-planning.service');
const domain = require('../../../contracts/v3/operations-domain.schema.json').$defs;
const example = require('../../../contracts/v3/examples/demo-scenario.json');

// All writes use real application paths except the explicitly marked aggregate
// fixture rows and corrupt storage fixtures. No triggers are disabled.
describe('authoritative overview: real authenticated HTTP and PostgreSQL', () => {
  let seed, server, base, users;
  const oldAccess = process.env.OPERATIONS_FACTORY_ACCESS;
  beforeAll(async () => {
    seed = await validatePayload(await loadCanonicalSeedPlan(), 'seed');
    users = Object.fromEntries(await Promise.all(['ADMIN', 'OPERATOR', 'VIEWER', 'OUTSIDER'].map(async name =>
      [name, await db.user.create({ data: { username: randomUUID(), passwordHash: 'unused', role: name === 'OUTSIDER' ? 'VIEWER' : name } })])));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  afterAll(async () => {
    if (oldAccess === undefined) delete process.env.OPERATIONS_FACTORY_ACCESS; else process.env.OPERATIONS_FACTORY_ACCESS = oldAccess;
    if (server) await new Promise(resolve => server.close(resolve));
    await db.$disconnect();
  });
  async function request(path, user = users.ADMIN, body) {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
      ...(user ? { Authorization: `Bearer ${jwt.sign({ id: user.id, role: 'ADMIN' }, process.env.JWT_SECRET)}` } : {}),
      ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  }
  const get = (s, user) => request(`/operations/overview?factory_id=${s.factory_id}`, user);
  async function overview(s, user) { const r = await get(s, user); expect(r.status).toBe(200); expect(r.cache).toBe('no-store'); return r.body.data; }
  async function factory({ allStatuses = false } = {}) {
    const s = structuredClone(seed); s.factory_id = `overview-${randomUUID()}`; s.current_schedule.factory_id = s.factory_id;
    if (allStatuses) s.machines.forEach((m, i) => { m.status = domain.MachineStatus.enum[i]; });
    // Canonical machine status changes can invalidate embedded scheduling evidence.
    if (allStatuses) { s.current_schedule = null; s.health_snapshots = []; }
    await ingestFactorySnapshot({ factoryId: s.factory_id, expectedHeadRevision: 0, snapshot: s, sourceId: 'overview-test' }, db);
    process.env.OPERATIONS_FACTORY_ACCESS = JSON.stringify({ [s.factory_id]: [users.VIEWER.id, users.OPERATOR.id] });
    return s;
  }
  async function create(s, mode = 'LIVE') {
    const head = await db.operationsHead.findUnique({ where: { factoryId: s.factory_id } });
    const r = await request('/decision-cases', users.OPERATOR, { schema_version: '3.0', factory_id: s.factory_id,
      expected_snapshot_id: s.snapshot_id, expected_plan_version: head.planVersion,
      request: { mode, trigger: { type: 'MANUAL_REPLAN', reason: 'Overview test' }, planning_config: { horizon_minutes: 720 } } });
    expect(r.status).toBe(202); return r.body.data.decision_case_id;
  }
  async function ready(s, id) {
    const lease = await claimDecisionCase(db, { caseId: id, expectedRevision: 1, workerId: randomUUID() });
    const candidate = { ...structuredClone(example.candidate_plans[0]), decision_case_id: id, snapshot_id: s.snapshot_id,
      schedule: { ...structuredClone(s.current_schedule), schedule_id: `overview-published-${id}` } };
    candidate.validation = { schema_version: '3.0', validation_id: 'overview-validation', candidate_plan_id: candidate.candidate_plan_id,
      validator_version: 'operations-validator-v1', verdict: 'VALID', validated_at: candidate.generated_at, violations: [] };
    const recommendation = { schema_version: '3.0', recommendation_id: `overview-rec-${id}`, decision_case_id: id,
      snapshot_id: s.snapshot_id, generated_at: candidate.generated_at, recommended_plan_id: candidate.candidate_plan_id,
      candidate_plans: [candidate], explanation: { summary: 'PRIVATE_ARTIFACT', primary_reasons: ['Feasible'],
        tradeoffs: ['No change'], residual_risks: [], evidence_refs: [s.snapshot_id] } };
    await persistDecisionRecommendation(db, { caseId: id, expectedRevision: lease.revision, leaseToken: lease.leaseToken, recommendation });
    const head = await db.operationsHead.findUnique({ where: { factoryId: s.factory_id } });
    return { schema_version: '3.0', decision_case_id: id, command: 'APPROVE', recommendation_id: recommendation.recommendation_id,
      expected_snapshot_id: s.snapshot_id, expected_plan_version: head.planVersion, expected_case_revision: 6,
      candidate_plan_id: candidate.candidate_plan_id, candidate_version: candidate.plan_version };
  }
  async function command(body) { const r = await request(`/decision-cases/${body.decision_case_id}/decision`, users.OPERATOR, body); expect(r.status).toBe(200); return r; }
  async function assertCounts(s) {
    const data = await overview(s);
    const rows = await db.decisionCase.findMany({ where: { factoryId: s.factory_id }, select: { mode: true, status: true, processingStatus: true } });
    for (const mode of ['LIVE', 'SIMULATION_ONLY']) {
      const subset = rows.filter(r => r.mode === mode); expect(data.cases[mode].total).toBe(subset.length);
      for (const [key, n] of Object.entries(data.cases[mode].by_status)) expect(n).toBe(subset.filter(r => r.status === key).length);
      for (const [key, n] of Object.entries(data.cases[mode].by_processing)) expect(n).toBe(subset.filter(r => r.processingStatus === key).length);
    }
    return data;
  }
  test('machine six-status coverage, missing health and no publication are explicit', async () => {
    const s = await factory({ allStatuses: true }); const data = await overview(s, users.VIEWER);
    expect(data.machines).toEqual({ total: 6, by_status: Object.fromEntries(domain.MachineStatus.enum.map(n => [n, 1])) });
    expect(data.context).toMatchObject({ snapshot_id: s.snapshot_id, plan_version: 0, publication: null });
    expect(data.provenance.machines).toMatchObject({ population: 6, covered: 6, observed_at: data.context.captured_at });
    expect(data.provenance.cases.read_at).toBe(data.context.read_at);
    expect(JSON.stringify(data)).not.toMatch(/health|utilization|risk/);
    expect(data.review_preview).toMatchObject({ items: [], limit: 6, has_more: false });
  });
  test('full-factory aggregates exceed list page limit; modes, stale/terminal and microsecond ties; preview equals sanitized list', async () => {
    const s = await factory();
    // Bulk stored-state oracle: genuine DB constraints, no transition bypass on existing rows.
    const states = [['CREATED', 'PENDING'], ['ANALYZING', 'RUNNING'], ['GENERATING', 'RUNNING'],
      ['VALIDATING', 'RUNNING'], ['EXPLAINING', 'RUNNING'], ['AWAITING_APPROVAL', 'SUCCEEDED'],
      ['APPROVED', 'SUCCEEDED'], ['REJECTED', 'SUCCEEDED'], ['COMMITTED', 'SUCCEEDED'], ['FAILED', 'FAILED']];
    for (const mode of ['LIVE', 'SIMULATION_ONLY']) for (let i = 0; i < 40; i++) {
      const [storedStatus, processingStatus] = states[i % states.length];
      const status = mode === 'SIMULATION_ONLY' && storedStatus === 'COMMITTED' ? 'REJECTED' : storedStatus;
      await db.decisionCase.create({ data: { factoryId: s.factory_id, snapshotId: s.snapshot_id, basePlanVersion: 0,
        mode, status, processingStatus, processingErrorCode: status === 'FAILED' ? 'PLANNING_FAILED' : null,
        ...(processingStatus === 'RUNNING' ? { leaseToken: randomUUID(), leaseOwnerId: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60000) } : {}),
        requestJson: { private: 'PRIVATE_REQUEST' }, requestHash: contentHash({}), actorId: users.ADMIN.id } });
    }
    // Seven additional preview rows with exact timestamp ties and microsecond differences.
    for (let i = 0; i < 7; i++) {
      const at = `2026-10-20T00:00:00.${i < 3 ? '123457' : '123456'}Z`;
      await db.$executeRaw`INSERT INTO decision_cases(id,factory_id,snapshot_id,base_plan_version,mode,status,processing_status,request_json,request_hash,actor_id,created_at,updated_at)
        VALUES(${randomUUID()}::uuid,${s.factory_id},${s.snapshot_id},0,'LIVE','AWAITING_APPROVAL','SUCCEEDED','{}'::jsonb,${contentHash({})},${users.ADMIN.id}::uuid,${at}::timestamptz,${at}::timestamptz)`;
    }
    const next = { ...s, snapshot_id: 'overview-S2', captured_at: new Date(Date.parse(s.captured_at) + 1000).toISOString() };
    await ingestFactorySnapshot({ factoryId: s.factory_id, expectedHeadRevision: 1, snapshot: next, sourceId: 'overview-test' }, db);
    const data = await assertCounts(s); expect(data.cases.LIVE.total).toBe(47); expect(data.cases.SIMULATION_ONLY.total).toBe(40);
    const list = await request(`/decision-cases?factory_id=${s.factory_id}&mode=LIVE&status=AWAITING_APPROVAL&limit=6`);
    expect(data.review_preview.items).toEqual(list.body.data); expect(data.review_preview.has_more).toBe(true);
    const ordered = await db.$queryRaw`SELECT id FROM decision_cases WHERE factory_id=${s.factory_id} AND mode='LIVE' AND status='AWAITING_APPROVAL' ORDER BY created_at DESC,id DESC LIMIT 6`;
    expect(data.review_preview.items.map(i => i.decision_case_id)).toEqual(ordered.map(i => i.id));
    expect(data.review_preview.items.every(i => i.stale && i.factory_id === s.factory_id)).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/PRIVATE_|request_json|lease_token|payload_json/);
  });
  test('ADMIN, scoped OPERATOR/VIEWER, outsider, inactive and strict query; no count leakage or role spoofing', async () => {
    const s = await factory(); await create(s);
    for (const user of [users.ADMIN, users.OPERATOR, users.VIEWER]) expect((await overview(s, user)).cases.LIVE.total).toBe(1);
    for (const id of [s.factory_id, 'unknown-factory']) {
      const r = await get({ factory_id: id }, users.OUTSIDER); expect(r.status).toBe(404); expect(r.body.code).toBe('FACTORY_NOT_FOUND'); expect(r.body).not.toHaveProperty('data');
    }
    expect((await get(s, null)).status).toBe(401);
    await db.user.update({ where: { id: users.OUTSIDER.id }, data: { active: false } });
    expect((await get(s, users.OUTSIDER)).status).toBe(401);
    for (const q of ['', 'factory_id=', 'factory_id=../bad', `factory_id=${s.factory_id}&factory_id=${s.factory_id}`,
      `factory_id=${s.factory_id}&limit=6`, `factory_id=${s.factory_id}&role=ADMIN`, 'factory_id[x]=y']) {
      const r = await request(`/operations/overview?${q}`); expect(r.status).toBe(400); expect(r.cache).toBe('no-store'); expect(r.body.code).toBe('VALIDATION_ERROR');
    }
    const other = await factory(); expect((await overview(other)).cases.LIVE.total).toBe(0);
    expect((await get(s, users.VIEWER)).status).toBe(404);
  });
  test('counts track real create, worker success/failure, APPROVE, REJECT, COMMIT and preserve S1 basis after S2 ingest', async () => {
    const s = await factory(); const initial = await overview(s);
    const id = await create(s); expect((await assertCounts(s)).cases.LIVE.by_processing.PENDING).toBe(1);
    const body = await ready(s, id); const readyData = await assertCounts(s);
    expect(readyData.cases.LIVE.by_status.AWAITING_APPROVAL).toBe(1); expect(readyData.context.head_revision).toBe(initial.context.head_revision);
    expect(readyData.review_preview.items[0].recommendation_id).toBe(body.recommendation_id);
    await command(body); expect((await assertCounts(s)).cases.LIVE.by_status.APPROVED).toBe(1);
    await command({ ...body, command: 'COMMIT', expected_case_revision: 7 });
    const published = await assertCounts(s); expect(published.cases.LIVE.by_status.COMMITTED).toBe(1); expect(published.context.plan_version).toBe(1);
    const id2 = await create(s); const b2 = await ready(s, id2);
    const { candidate_plan_id, candidate_version, ...reject } = b2;
    await command({ ...reject, command: 'REJECT', note: 'PRIVATE_NOTE' }); expect((await assertCounts(s)).cases.LIVE.by_status.REJECTED).toBe(1);
    const failure = await create(s, 'SIMULATION_ONLY'); const before = await overview(s);
    const lease = await claimDecisionCase(db, { caseId: failure, expectedRevision: 1, workerId: randomUUID() });
    expect((await overview(s)).cases.SIMULATION_ONLY.by_processing.RUNNING).toBe(1);
    await recordDecisionPlanningFailure(db, { caseId: failure, expectedRevision: lease.revision, leaseToken: lease.leaseToken, errorCode: 'PLANNING_FAILED' });
    const failed = await assertCounts(s); expect(failed.cases.SIMULATION_ONLY.by_processing.FAILED).toBe(1); expect(failed.context.head_revision).toBe(before.context.head_revision);
    const next = { ...s, snapshot_id: 'overview-next', captured_at: new Date(Date.parse(s.captured_at) + 1000).toISOString() };
    await ingestFactorySnapshot({ factoryId: s.factory_id, expectedHeadRevision: failed.context.head_revision, snapshot: next, sourceId: 'overview-test' }, db);
    const observed = await overview(s); expect(observed.context.snapshot_id).toBe(next.snapshot_id); expect(observed.context.publication).toEqual(published.context.publication); expect(observed.context.publication.basis_snapshot_id).toBe(s.snapshot_id);
    const current = await request(`/schedules/current?factory_id=${s.factory_id}`); expect(current.body.data.basis_snapshot.snapshot_id).toBe(s.snapshot_id);
    if (process.env.OVERVIEW_EVIDENCE_FILE) {
      const execFile = require('node:util').promisify(require('node:child_process').execFile);
      const { stdout } = await execFile(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-sS', '-w', '\n%{http_code}',
        '-H', 'Authorization: Bearer ' + jwt.sign({ id: users.ADMIN.id }, process.env.JWT_SECRET),
        base + '/operations/overview?factory_id=' + s.factory_id], { windowsHide: true });
      const split = stdout.lastIndexOf('\n'); expect(stdout.slice(split + 1)).toBe('200');
      const payload = JSON.parse(stdout.slice(0, split)); expect(payload.data.cases).toEqual(observed.cases);
      fs.writeFileSync(process.env.OVERVIEW_EVIDENCE_FILE, JSON.stringify({ transport: 'curl, real authenticated HTTP/PostgreSQL', http_status: 200, payload }, null, 2));
    }
  });

  // Pause after the HTTP read has selected its head. The writer commits on a
  // separate connection before aggregates/preview execute. ReadCommitted would
  // mix the old head with new counts and fail these assertions.
  async function coordinated(s, writer) {
    let entered, release; const selected = new Promise(r => { entered = r; }); const resume = new Promise(r => { release = r; });
    const original = db.$transaction.bind(db);
    const spy = jest.spyOn(db, '$transaction').mockImplementationOnce((fn, options) => original(async tx => {
      const find = tx.operationsHead.findUnique.bind(tx.operationsHead);
      tx.operationsHead.findUnique = async args => { const head = await find(args); entered(); await resume; return head; };
      return fn(tx);
    }, { ...options, timeout: 15000 }));
    const pending = get(s);
    try { await selected; spy.mockRestore(); await writer(); }
    finally { spy.mockRestore(); release(); }
    const result = await pending; expect(result.status).toBe(200); return result.body.data;
  }
  test('coordinated COMMIT/read returns entirely pre-commit view, then entirely post-commit view', async () => {
    const s = await factory(); const body = await ready(s, await create(s)); await command(body);
    const during = await coordinated(s, () => command({ ...body, command: 'COMMIT', expected_case_revision: 7 }));
    expect(during.context).toMatchObject({ plan_version: 0, publication: null }); expect(during.cases.LIVE.by_status.APPROVED).toBe(1); expect(during.cases.LIVE.by_status.COMMITTED).toBe(0);
    const after = await overview(s); expect(after.context.plan_version).toBe(1); expect(after.cases.LIVE.by_status.COMMITTED).toBe(1); expect(after.cases.LIVE.by_status.APPROVED).toBe(0);
  });
  test('coordinated ingest/read and worker/read cannot mix context/counts/preview', async () => {
    const s = await factory(); const id = await create(s);
    const during = await coordinated(s, () => ready(s, id));
    expect(during.cases.LIVE.by_processing.PENDING).toBe(1); expect(during.review_preview.items).toEqual([]);
    const readyView = await overview(s); expect(readyView.context.head_revision).toBe(during.context.head_revision); expect(readyView.review_preview.items).toHaveLength(1);
    const next = { ...s, snapshot_id: 'overview-concurrent-S2', captured_at: new Date(Date.parse(s.captured_at) + 1000).toISOString() };
    const ingestView = await coordinated(s, () => ingestFactorySnapshot({ factoryId: s.factory_id, expectedHeadRevision: 1, snapshot: next, sourceId: 'overview-test' }, db));
    expect(ingestView.context.snapshot_id).toBe(s.snapshot_id); expect(ingestView.review_preview.items[0].stale).toBe(false);
    const after = await overview(s); expect(after.context.snapshot_id).toBe(next.snapshot_id); expect(after.review_preview.items[0].stale).toBe(true);
    expect(after.review_preview.items[0].current_context.snapshot_id).toBe(next.snapshot_id);
  });
  test('corrupt/hash/schema artifacts, unavailable validator and database are errors, never empty data', async () => {
    for (const kind of ['hash', 'schema']) {
      const s = structuredClone(seed); s.factory_id = `corrupt-${randomUUID()}`; s.current_schedule = null;
      if (kind === 'schema') s.machines[0].status = 'NOT_CANONICAL';
      await bootstrapFactory(db, s.factory_id, 'corruption-test');
      await db.factorySnapshot.create({ data: { factoryId: s.factory_id, snapshotId: s.snapshot_id, schemaVersion: '3.0',
        payloadJson: s, contentHash: kind === 'hash' ? '0'.repeat(64) : contentHash(s), capturedAt: new Date(s.captured_at) } });
      await db.operationsHead.create({ data: { factoryId: s.factory_id, snapshotId: s.snapshot_id } });
      const r = await get(s); expect(r.status).toBe(500); expect(r.body.code).toBe('OPERATIONS_INTEGRITY_ERROR'); expect(r.body).not.toHaveProperty('data');
    }
    const s = await factory(); const python = process.env.OPERATIONS_PYTHON;
    try { process.env.OPERATIONS_PYTHON = 'nonexistent-overview-validator'; const r = await get(s); expect(r.status).toBe(503); expect(r.body).toMatchObject({ code: 'OPERATIONS_VALIDATOR_UNAVAILABLE', retryable: true }); }
    finally { if (python === undefined) delete process.env.OPERATIONS_PYTHON; else process.env.OPERATIONS_PYTHON = python; }
    const downUrl = new URL(process.env.DATABASE_URL); downUrl.port = '1'; downUrl.searchParams.set('connect_timeout', '1');
    const unavailable = new PrismaClient({ datasources: { db: { url: downUrl.toString() } } });
    const spy = jest.spyOn(db, '$transaction').mockImplementationOnce(fn => unavailable.$transaction(fn));
    try { const r = await get(s); expect(r.status).toBe(503); expect(r.body.code).toBe('DB_UNAVAILABLE'); expect(JSON.stringify(r.body)).not.toContain('PRIVATE'); }
    finally { spy.mockRestore(); await unavailable.$disconnect(); }
  });
  test('repeated reads create no cases, events, receipts, audits, snapshots or publications and do not mutate head', async () => {
    const s = await factory(); await ready(s, await create(s));
    const effects = async () => Promise.all([db.operationsHead.findUnique({ where: { factoryId: s.factory_id } }),
      ...['decisionCase', 'decisionCaseEvent', 'decisionCaseIdempotencyReceipt', 'decisionHumanRecord', 'decisionCommit', 'auditLog', 'factorySnapshot', 'operationSchedule'].map(n => db[n].count())]);
    const rowsBefore = await db.decisionCase.findMany({ where: { factoryId: s.factory_id } });
    const before = await effects(); for (let i = 0; i < 3; i++) await overview(s);
    expect(await db.decisionCase.findMany({ where: { factoryId: s.factory_id } })).toEqual(rowsBefore);
    expect(await effects()).toEqual(before);
  });
});
