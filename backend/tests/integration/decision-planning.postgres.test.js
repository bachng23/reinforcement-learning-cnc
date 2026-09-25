const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { loadCanonicalSeedPlan, validatePayload, contentHash } = require('../../src/services/operations-contract.service');
const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');
const { createDecisionCase, getDecisionCase, getDecisionCaseEvents } = require('../../src/services/decision-case.service');
const { claimDecisionCase, persistDecisionRecommendation, recordDecisionPlanningFailure, releaseExpiredDecisionCaseLease } = require('../../src/services/decision-planning.service');
const example = require('../../../contracts/v3/examples/demo-scenario.json');

describe('Decision recommendation persistence and leases', () => {
  let snapshot, factoryId, actor, viewer, outsider, server, base;
  const workerId = randomUUID();
  const previousAccess = process.env.OPERATIONS_FACTORY_ACCESS;
  beforeAll(async () => {
    snapshot = await validatePayload(await loadCanonicalSeedPlan(), 'seed');
    factoryId = `planning-${randomUUID()}`;
    snapshot.factory_id = factoryId;
    snapshot.current_schedule.factory_id = factoryId;
    await ingestFactorySnapshot({ factoryId, expectedHeadRevision: 0, snapshot, sourceId: 'planning-tests' }, db);
    actor = await db.user.create({ data: { username: randomUUID(), passwordHash: 'unused', role: 'ADMIN' } });
    viewer = await db.user.create({ data: { username: randomUUID(), passwordHash: 'unused', role: 'VIEWER' } });
    outsider = await db.user.create({ data: { username: randomUUID(), passwordHash: 'unused', role: 'VIEWER' } });
    process.env.OPERATIONS_FACTORY_ACCESS = JSON.stringify({ [factoryId]: [viewer.id] });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/v1/decision-cases`;
  });
  afterAll(async () => {
    if (previousAccess === undefined) delete process.env.OPERATIONS_FACTORY_ACCESS; else process.env.OPERATIONS_FACTORY_ACCESS = previousAccess;
    if (server) await new Promise(resolve => server.close(resolve));
    await db.$disconnect();
  });
  async function create() {
    return (await createDecisionCase(db, actor, { schema_version: '3.0', factory_id: factoryId,
      expected_snapshot_id: snapshot.snapshot_id, expected_plan_version: 0,
      request: { mode: 'LIVE', trigger: { type: 'MANUAL_REPLAN', reason: 'Review' }, planning_config: { horizon_minutes: 720 } },
    }, randomUUID())).body.data.decision_case_id;
  }
  const claim = (caseId, expectedRevision = 1, leaseSeconds = 120) => claimDecisionCase(db, { caseId, expectedRevision, workerId, leaseSeconds });
  const owned = lease => ({ caseId: lease.caseId, expectedRevision: lease.revision, leaseToken: lease.leaseToken });
  function recommendation(caseId, recommendationId = `rec-${randomUUID()}`) {
    const plan = structuredClone(example.candidate_plans[0]);
    plan.schema_version = '3.0';
    plan.decision_case_id = caseId;
    plan.snapshot_id = snapshot.snapshot_id;
    plan.schedule = structuredClone(snapshot.current_schedule);
    plan.validation = { schema_version: '3.0', validation_id: 'validation-test', candidate_plan_id: plan.candidate_plan_id,
      validator_version: 'operations-validator-v1', verdict: 'VALID', validated_at: plan.generated_at, violations: [] };
    return { schema_version: '3.0', recommendation_id: recommendationId, decision_case_id: caseId, snapshot_id: snapshot.snapshot_id,
      generated_at: plan.generated_at, recommended_plan_id: plan.candidate_plan_id, candidate_plans: [plan],
      explanation: { summary: 'Keep the valid schedule', primary_reasons: ['Feasible'], tradeoffs: ['No change'], residual_risks: [], evidence_refs: [snapshot.snapshot_id] } };
  }
  async function read(caseId, user = viewer) {
    const response = await fetch(`${base}/${caseId}/recommendation`, { headers: user ? { Authorization: `Bearer ${jwt.sign({ id: user.id }, process.env.JWT_SECRET)}` } : {} });
    return { status: response.status, body: await response.json() };
  }
  test('competing claims have one winner and one ordered event; token is not in public metadata', async () => {
    const id = await create();
    const results = await Promise.allSettled([claim(id), claim(id)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason).toMatchObject({ statusCode: 409 });
    const row = await getDecisionCase(db, viewer, id);
    expect(row.data.status).toBe('ANALYZING');
    expect(row.meta.processing).toEqual({ status: 'RUNNING', attempt: 1, error_code: null });
    expect(JSON.stringify(row)).not.toContain(results.find(r => r.status === 'fulfilled').value.leaseToken);
    expect(await db.decisionCaseEvent.count({ where: { caseId: id } })).toBe(2);
  });
  test('persists valid immutable recommendation, lifecycle, status DTO and pinned snapshot atomically', async () => {
    const id = await create(), lease = await claim(id), payload = recommendation(id);
    const result = await persistDecisionRecommendation(db, { ...owned(lease), recommendation: payload });
    expect(result).toMatchObject({ revision: 6, status: 'AWAITING_APPROVAL', recommendationId: payload.recommendation_id });
    const row = await getDecisionCase(db, viewer, id);
    expect(row.data.recommendation_id).toBe(payload.recommendation_id);
    expect(row.data.updated_at >= row.data.created_at).toBe(true);
    expect((await validatePayload(row.data, 'case-status')).status).toBe('AWAITING_APPROVAL');
    expect(row.meta.processing.status).toBe('SUCCEEDED');
    const history = await getDecisionCaseEvents(db, viewer, id, {});
    expect(history.data.map(e => e.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(history.data.slice(1).map(e => e.payload.to_status)).toEqual(['ANALYZING', 'GENERATING', 'VALIDATING', 'EXPLAINING', 'AWAITING_APPROVAL']);
    expect(history.data.slice(1).every(e => e.actor.kind === 'SYSTEM')).toBe(true);
    const response = await read(id);
    expect(response.status).toBe(200);
    expect(response.body.data.snapshot).toEqual(snapshot);
    expect(contentHash(response.body.data.recommendation)).toBe(result.contentHash);
    for (const sql of ['UPDATE decision_recommendation_artifacts SET content_hash=content_hash', 'DELETE FROM decision_recommendation_artifacts', 'TRUNCATE decision_recommendation_artifacts CASCADE']) {
      await expect(db.$executeRawUnsafe(sql)).rejects.toThrow('immutable');
    }
    await expect(persistDecisionRecommendation(db, { ...owned(lease), recommendation: payload })).rejects.toMatchObject({ statusCode: 409 });
    expect(await db.decisionRecommendationArtifact.count({ where: { caseId: id } })).toBe(1);
  });
  test('stale revision and token cannot persist or fail a current attempt', async () => {
    const id = await create(), lease = await claim(id);
    for (const bad of [{ ...owned(lease), expectedRevision: 1 }, { ...owned(lease), leaseToken: randomUUID() }]) {
      await expect(recordDecisionPlanningFailure(db, { ...bad, errorCode: 'PLANNING_FAILED' })).rejects.toMatchObject({ statusCode: 409 });
      await expect(persistDecisionRecommendation(db, { ...bad, recommendation: recommendation(id) })).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(await db.decisionCaseEvent.count({ where: { caseId: id } })).toBe(2);
  });
  test('expiry release is token/revision fenced and permits a fresh claim; old worker cannot write', async () => {
    const id = await create(), lease = await claim(id, 1, 1);
    await expect(releaseExpiredDecisionCaseLease(db, owned(lease))).rejects.toMatchObject({ statusCode: 409 });
    await db.$queryRaw`SELECT pg_sleep(1.1)::text`;
    await expect(recordDecisionPlanningFailure(db, { ...owned(lease), errorCode: 'PLANNING_TIMEOUT' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(releaseExpiredDecisionCaseLease(db, { ...owned(lease), leaseToken: randomUUID() })).rejects.toMatchObject({ statusCode: 409 });
    const released = await releaseExpiredDecisionCaseLease(db, owned(lease));
    const next = await claim(id, released.revision);
    expect(next.attempt).toBe(2);
    expect(next.leaseToken).not.toBe(lease.leaseToken);
    await expect(persistDecisionRecommendation(db, { ...owned(lease), expectedRevision: next.revision, recommendation: recommendation(id) })).rejects.toMatchObject({ statusCode: 409 });
  });
  test('failure stores only a safe code, clears lease, and can be retried with new CAS', async () => {
    const id = await create(), lease = await claim(id);
    await expect(recordDecisionPlanningFailure(db, { ...owned(lease), errorCode: 'password=secret', stack: 'private' })).rejects.toMatchObject({ statusCode: 400 });
    const failed = await recordDecisionPlanningFailure(db, { ...owned(lease), errorCode: 'PLANNING_TIMEOUT' });
    const response = await getDecisionCase(db, viewer, id);
    expect(response.data).toMatchObject({ status: 'FAILED', error_code: 'PLANNING_TIMEOUT', recommendation_id: null });
    expect((await validatePayload(response.data, 'case-status')).status).toBe('FAILED');
    expect((await claim(id, failed.revision)).attempt).toBe(2);
  });
  test('invalid AI payload, hash, case/snapshot IDs and every candidate are rejected without writes', async () => {
    const id = await create(), lease = await claim(id);
    const variants = [];
    for (const change of [{ schema_version: '2.0' }, { decision_case_id: randomUUID() }, { snapshot_id: 'wrong' }, { recommended_plan_id: 'missing' }]) variants.push({ ...recommendation(id), ...change });
    const all = recommendation(id);
    const invalid = structuredClone(all.candidate_plans[0]);
    invalid.candidate_plan_id = 'bad-unselected'; invalid.validation.candidate_plan_id = invalid.candidate_plan_id;
    invalid.schedule.assignments[0].machine_id = 'unknown-machine';
    all.candidate_plans.push(invalid); variants.push(all);
    for (const payload of variants) await expect(persistDecisionRecommendation(db, { ...owned(lease), recommendation: payload })).rejects.toMatchObject({ statusCode: 400 });
    await expect(persistDecisionRecommendation(db, { ...owned(lease), recommendation: recommendation(id), expectedContentHash: '0'.repeat(64) })).rejects.toMatchObject({ code: 'RECOMMENDATION_CONTENT_CONFLICT' });
    expect(await db.decisionRecommendationArtifact.count({ where: { caseId: id } })).toBe(0);
    expect(await db.decisionCaseEvent.count({ where: { caseId: id } })).toBe(2);
  });
  test('duplicate recommendation ID across cases rolls back the second attempt', async () => {
    const first = await create(), second = await create(), a = await claim(first), b = await claim(second), recommendationId = `rec-${randomUUID()}`;
    await persistDecisionRecommendation(db, { ...owned(a), recommendation: recommendation(first, recommendationId) });
    await expect(persistDecisionRecommendation(db, { ...owned(b), recommendation: recommendation(second, recommendationId) })).rejects.toMatchObject({ code: 'RECOMMENDATION_ALREADY_EXISTS' });
    expect((await getDecisionCase(db, viewer, second)).data.status).toBe('ANALYZING');
  });
  test('event failure rolls back artifact and every intermediate case transition', async () => {
    const id = await create(), lease = await claim(id);
    let count = 0;
    const broken = { decisionCase: db.decisionCase, $transaction: (fn, options) => db.$transaction(tx => fn(new Proxy(tx, {
      get(target, key) { return key === 'decisionCaseEvent' ? new Proxy(target[key], { get(delegate, method) {
        if (method === 'create') return async args => { if (++count === 3) throw new Error('injected event failure'); return delegate.create(args); };
        return delegate[method];
      } }) : target[key]; },
    })), options) };
    await expect(persistDecisionRecommendation(broken, { ...owned(lease), recommendation: recommendation(id) })).rejects.toThrow('injected event failure');
    expect(await db.decisionRecommendationArtifact.count({ where: { caseId: id } })).toBe(0);
    expect((await getDecisionCase(db, viewer, id)).meta.case_revision).toBe(2);
    expect(await db.decisionCaseEvent.count({ where: { caseId: id } })).toBe(2);
  });
  test('recommendation read checks authentication/factory access before readiness', async () => {
    const id = await create();
    expect((await read(id, null)).status).toBe(401);
    const hidden = await read(id, outsider), missing = await read(randomUUID(), outsider);
    expect(hidden.status).toBe(404); expect(hidden.body.error).toEqual(missing.body.error);
    expect((await read(id)).body.error.code).toBe('RECOMMENDATION_NOT_READY');
    await persistDecisionRecommendation(db, { ...owned(await claim(id)), recommendation: recommendation(id) });
    expect((await read(id, outsider)).status).toBe(404);
    expect((await read(id)).status).toBe(200);
  });
});
