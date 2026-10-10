const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { loadCanonicalSeedPlan, validatePayload, contentHash } = require('../../src/services/operations-contract.service');
const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');
const { createDecisionCase, getDecisionCase } = require('../../src/services/decision-case.service');
const { claimDecisionCase, persistDecisionRecommendation } = require('../../src/services/decision-planning.service');
const { executeDecisionCommand } = require('../../src/services/decision-command.service');
const example = require('../../../contracts/v3/examples/demo-scenario.json');

describe('human decisions and atomic schedule publication (real HTTP/PostgreSQL)', () => {
  let seed, server, base, users;
  const oldAccess = process.env.OPERATIONS_FACTORY_ACCESS;
  beforeAll(async () => {
    seed = await validatePayload(await loadCanonicalSeedPlan(), 'seed');
    users = Object.fromEntries(await Promise.all(['ADMIN', 'OPERATOR', 'ENGINEER', 'VIEWER'].map(async role =>
      [role, await db.user.create({ data: { username: randomUUID(), passwordHash: 'unused', role } })])));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  afterAll(async () => {
    if (oldAccess === undefined) delete process.env.OPERATIONS_FACTORY_ACCESS; else process.env.OPERATIONS_FACTORY_ACCESS = oldAccess;
    if (server) await new Promise(resolve => server.close(resolve));
    await db.$disconnect();
  });
  const token = user => ({ Authorization: `Bearer ${jwt.sign({ id: user.id }, process.env.JWT_SECRET)}` });
  async function http(body, key = randomUUID(), user = users.ADMIN) {
    const response = await fetch(`${base}/decision-cases/${body.decision_case_id}/decision`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(user ? token(user) : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json(), replayed: response.headers.get('Idempotency-Replayed') };
  }
  async function fixture({ snapshot: previous, mode = 'LIVE', verdict = 'VALID', publishedSeed = false } = {}) {
    const snapshot = previous || { ...structuredClone(seed), factory_id: `commands-${randomUUID()}` };
    snapshot.current_schedule.factory_id = snapshot.factory_id;
    if (!previous) await ingestFactorySnapshot({ factoryId: snapshot.factory_id, expectedHeadRevision: 0, snapshot, sourceId: 'command-tests' }, db);
    if (publishedSeed) {
      const schedule = snapshot.current_schedule;
      await db.operationSchedule.create({ data: { factoryId: snapshot.factory_id, snapshotId: snapshot.snapshot_id,
        scheduleId: schedule.schedule_id, revision: schedule.revision, schemaVersion: '3.0',
        contentHash: contentHash(schedule), payloadJson: schedule } });
      await db.operationsHead.update({ where: { factoryId: snapshot.factory_id }, data: {
        scheduleId: schedule.schedule_id, scheduleRevision: schedule.revision, planVersion: 1 } });
    }
    process.env.OPERATIONS_FACTORY_ACCESS = JSON.stringify({ [snapshot.factory_id]: Object.values(users).map(u => u.id) });
    const head = await db.operationsHead.findUnique({ where: { factoryId: snapshot.factory_id } });
    const created = await createDecisionCase(db, users.ADMIN, { schema_version: '3.0', factory_id: snapshot.factory_id,
      expected_snapshot_id: snapshot.snapshot_id, expected_plan_version: head.planVersion,
      request: { mode, trigger: { type: 'MANUAL_REPLAN', reason: 'Review publication' }, planning_config: { horizon_minutes: 720 } } }, randomUUID());
    const id = created.body.data.decision_case_id;
    const lease = await claimDecisionCase(db, { caseId: id, expectedRevision: 1, workerId: randomUUID() });
    const candidate = { ...structuredClone(example.candidate_plans[0]), decision_case_id: id, snapshot_id: snapshot.snapshot_id,
      plan_version: 17, schedule: { ...structuredClone(snapshot.current_schedule), schedule_id: `published-${id}`, revision: 9 } };
    candidate.validation = { schema_version: '3.0', validation_id: 'command-validation', candidate_plan_id: candidate.candidate_plan_id,
      validator_version: 'operations-validator-v1', verdict, validated_at: candidate.generated_at, violations: [] };
    const alternate = { ...structuredClone(candidate), candidate_plan_id: 'alternate', schedule: { ...structuredClone(candidate.schedule), schedule_id: `alternate-${id}` } };
    alternate.validation.candidate_plan_id = alternate.candidate_plan_id;
    const recommendation = { schema_version: '3.0', recommendation_id: `rec-${id}`, decision_case_id: id,
      snapshot_id: snapshot.snapshot_id, generated_at: candidate.generated_at, recommended_plan_id: candidate.candidate_plan_id,
      candidate_plans: [candidate, alternate], explanation: { summary: 'Feasible publication', primary_reasons: ['Feasible'],
        tradeoffs: ['No change'], residual_risks: [], evidence_refs: [snapshot.snapshot_id] } };
    if (verdict === 'VALID') {
      await persistDecisionRecommendation(db, { caseId: id, expectedRevision: lease.revision, leaseToken: lease.leaseToken, recommendation });
    } else {
      // Simulate a legacy/direct-SQL artifact bypassing canonical persistence validation.
      // Approval must independently enforce VALID even when stored JSON has a matching hash.
      await db.$transaction(async tx => {
        await tx.decisionRecommendationArtifact.create({ data: { caseId: id, recommendationId: recommendation.recommendation_id,
          snapshotId: snapshot.snapshot_id, schemaVersion: '3.0', payloadJson: recommendation,
          contentHash: contentHash(recommendation), generatedAt: new Date(recommendation.generated_at) } });
        for (const status of ['GENERATING', 'VALIDATING', 'EXPLAINING', 'AWAITING_APPROVAL'])
          await tx.decisionCase.update({ where: { id }, data: { status, revision: { increment: 1 },
            ...(status === 'AWAITING_APPROVAL' ? { processingStatus: 'SUCCEEDED', leaseToken: null, leaseOwnerId: null, leaseExpiresAt: null } : {}) } });
      });
    }
    const stored = await db.decisionRecommendationArtifact.findUnique({ where: { caseId: id } });
    return { id, snapshot, candidate: stored.payloadJson.candidate_plans[0], body: { schema_version: '3.0', command: 'APPROVE',
      decision_case_id: id, recommendation_id: recommendation.recommendation_id, expected_snapshot_id: snapshot.snapshot_id,
      expected_case_revision: 6, expected_plan_version: head.planVersion, candidate_plan_id: candidate.candidate_plan_id, candidate_version: 17 } };
  }
  const commitBody = f => ({ ...f.body, command: 'COMMIT', expected_case_revision: 7 });
  async function current(f) {
    const response = await fetch(`${base}/schedules/current?factory_id=${f.snapshot.factory_id}`, { headers: token(users.ADMIN) });
    expect(response.status).toBe(200);
    return (await response.json()).data;
  }
  async function effects(f) {
    return Promise.all([db.operationsHead.findUnique({ where: { factoryId: f.snapshot.factory_id } }),
      db.operationSchedule.count({ where: { factoryId: f.snapshot.factory_id } }),
      db.decisionHumanRecord.count({ where: { caseId: f.id } }), db.decisionCommit.count({ where: { caseId: f.id } }),
      db.decisionCaseEvent.count({ where: { caseId: f.id } }), db.decisionCaseIdempotencyReceipt.count({ where: { caseId: f.id } }),
      db.decisionCase.findUnique({ where: { id: f.id } })]);
  }
  test('APPROVE → COMMIT publishes exact candidate once; loss-of-response replay, audit and read DTO agree', async () => {
    const f = await fixture(), before = await current(f), approveKey = randomUUID();
    const approved = await http(f.body, approveKey);
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.meta).toMatchObject({ case_revision: 7, available_commands: ['COMMIT'],
      approved_candidate: { candidate_version: 17, candidate_hash: contentHash(f.candidate), schedule_hash: contentHash(f.candidate.schedule) },
      human_decision: { actor_id: users.ADMIN.id, decision: 'APPROVE' }, commit: null });
    expect(await current(f)).toEqual(before);
    const key = randomUUID(), committed = await http(commitBody(f), key);
    expect(committed.status).toBe(200);
    expect(committed.body.data).toMatchObject({ status: 'COMMITTED', committed_schedule_id: f.candidate.schedule.schedule_id });
    expect(committed.body.meta).toMatchObject({ case_revision: 8, available_commands: [], commit: { plan_version: 1, schedule_revision: 9 } });
    expect(await validatePayload(committed.body.data, 'case-status')).toMatchObject({ status: 'COMMITTED' });
    const published = await current(f);
    expect(published).toMatchObject({ schedule: f.candidate.schedule, basis_snapshot: f.snapshot, plan_version: 1,
      commit: committed.body.meta.commit });
    const beforeReplay = await effects(f);
    const replay = await http(commitBody(f), key);
    expect(replay).toEqual({ status: 200, body: committed.body, replayed: 'true' });
    expect((await http(f.body, approveKey)).body).toEqual(approved.body);
    expect(await effects(f)).toEqual(beforeReplay);
    const events = await fetch(`${base}/decision-cases/${f.id}/events`, { headers: token(users.ADMIN) }).then(r => r.json());
    expect(events.data.slice(-2).map(e => e.payload.command)).toEqual(['APPROVE', 'COMMIT']);
    expect(events.data.at(-1)).toMatchObject({ actor: { kind: 'HUMAN', id: users.ADMIN.id },
      payload: { candidate_hash: contentHash(f.candidate), schedule_hash: contentHash(f.candidate.schedule), plan_version: 1 } });
    // A later observation must not erase publication provenance or its original basis.
    const head = await db.operationsHead.findUnique({ where: { factoryId: f.snapshot.factory_id } });
    await ingestFactorySnapshot({ factoryId: f.snapshot.factory_id, expectedHeadRevision: head.revision,
      snapshot: { ...f.snapshot, snapshot_id: `later-${randomUUID()}`, current_schedule: null }, sourceId: 'after-commit' }, db);
    expect(await current(f)).toMatchObject({ schedule: f.candidate.schedule, basis_snapshot: f.snapshot, commit: committed.body.meta.commit });
    expect((await http(commitBody(f), key)).body).toEqual(committed.body);
  });
  test('REJECT requires note, selects no candidate, records server actor/time and never changes head', async () => {
    const f = await fixture({ publishedSeed: true }), before = await current(f);
    const { candidate_plan_id, candidate_version, ...body } = { ...f.body, command: 'REJECT' };
    expect((await http(body)).status).toBe(400);
    expect((await http({ ...body, note: '   ' })).status).toBe(400);
    expect((await http({ ...body, note: 'Unsafe', candidate_plan_id })).status).toBe(400);
    const result = await http({ ...body, note: 'Maintenance conflict' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ data: { status: 'REJECTED' }, meta: { available_commands: [], approved_candidate: null,
      human_decision: { decision: 'REJECT', note: 'Maintenance conflict', actor_id: users.ADMIN.id } } });
    expect(await current(f)).toEqual(before);
    expect((await http({ ...commitBody(f) })).body.error.code).toBe('CASE_STATE_CONFLICT');
  });
  test('approval preserves an existing seeded schedule; commit replaces it with the selected immutable schedule', async () => {
    const f = await fixture({ publishedSeed: true }), before = await current(f);
    expect(before).toMatchObject({ plan_version: 1, schedule: f.snapshot.current_schedule, commit: null });
    expect((await http(f.body)).status).toBe(200);
    expect(await current(f)).toEqual(before);
    expect((await http(commitBody(f))).status).toBe(200);
    expect(await current(f)).toMatchObject({ plan_version: 2, schedule: f.candidate.schedule, commit: { plan_version: 2 } });
    expect(await db.operationSchedule.count({ where: { factoryId: f.snapshot.factory_id } })).toBe(2);
  });
  test.each([
    ['expected_case_revision', 5, 'CASE_REVISION_CONFLICT'], ['expected_snapshot_id', 'old', 'SNAPSHOT_CONFLICT'],
    ['expected_plan_version', 1, 'PLAN_VERSION_CONFLICT'], ['candidate_version', 1, 'CANDIDATE_VERSION_CONFLICT'],
    ['candidate_plan_id', 'absent', 'CANDIDATE_NOT_FOUND'], ['recommendation_id', 'other', 'RECOMMENDATION_CONFLICT'],
  ])('stale/mismatched %s leaves no effects', async (field, value, code) => {
    const f = await fixture(), before = await effects(f);
    const result = await http({ ...f.body, [field]: value });
    expect(result.status).toBe(409); expect(result.body.error.code).toBe(code);
    expect(await effects(f)).toEqual(before);
  });
  test('rejects unvalidated candidate and caller-owned actor/time', async () => {
    const f = await fixture({ verdict: 'ERROR' }), before = await effects(f);
    expect((await http(f.body)).body.error.code).toBe('CANDIDATE_NOT_VALID');
    expect((await http({ ...f.body, actor_id: users.ADMIN.id, decided_at: new Date().toISOString() })).status).toBe(400);
    expect(await effects(f)).toEqual(before);
  });
  test.each(['ADMIN', 'OPERATOR', 'ENGINEER', 'VIEWER'])('role %s is checked for both APPROVE and COMMIT', async role => {
    const f = await fixture();
    expect((await http(f.body, randomUUID(), users[role])).status).toBe(role === 'VIEWER' ? 403 : 200);
    expect((await http(commitBody(f), randomUUID(), users[role])).status).toBe(role === 'VIEWER' ? 403 : 200);
  });
  test('authentication and factory access apply before writes and receipt replay', async () => {
    const f = await fixture(), key = randomUUID();
    expect((await http(f.body, key, null)).status).toBe(401);
    expect((await http(f.body, key, users.OPERATOR)).status).toBe(200);
    process.env.OPERATIONS_FACTORY_ACCESS = '{}';
    expect((await http(f.body, key, users.OPERATOR)).status).toBe(404);
    expect((await http(commitBody(f), randomUUID(), users.OPERATOR)).status).toBe(404);
    expect((await getDecisionCase(db, users.ADMIN, f.id)).data.status).toBe('APPROVED');
  });
  test('concurrent duplicate key returns one decision; same key with another body/case/command conflicts', async () => {
    const f = await fixture(), key = randomUUID();
    const results = await Promise.all([http(f.body, key), http(f.body, key)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(results[0].body).toEqual(results[1].body);
    expect(results.filter(r => r.replayed === 'true')).toHaveLength(1);
    for (const body of [{ ...f.body, note: 'Different' }, commitBody(f), (await fixture({ snapshot: f.snapshot })).body])
      expect((await http(body, key)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await db.decisionHumanRecord.count({ where: { caseId: f.id } })).toBe(1);
  });
  test('concurrent commit on two cases with same basis has one winner, one increment, one receipt', async () => {
    const a = await fixture(), b = await fixture({ snapshot: a.snapshot });
    expect((await http(a.body)).status).toBe(200); expect((await http(b.body)).status).toBe(200);
    const results = await Promise.all([http(commitBody(a)), http(commitBody(b))]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(results.find(r => r.status === 409).body.error.code).toBe('PLAN_VERSION_CONFLICT');
    const winner = results[0].status === 200 ? a : b;
    expect(await current(a)).toMatchObject({ schedule: winner.candidate.schedule, plan_version: 1 });
    expect(await db.decisionCommit.count({ where: { factoryId: a.snapshot.factory_id } })).toBe(1);
    expect(await db.operationSchedule.count({ where: { factoryId: a.snapshot.factory_id } })).toBe(1);
  });
  test('simultaneous COMMIT retries return the same receipt and publish once', async () => {
    const f = await fixture(); await http(f.body);
    const key = randomUUID(), responses = await Promise.all([http(commitBody(f), key), http(commitBody(f), key)]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(responses.filter(r => r.replayed === 'true')).toHaveLength(1);
    expect((await current(f)).plan_version).toBe(1);
  });
  test('COMMIT rejects SIMULATION_ONLY, another valid candidate and changed context', async () => {
    const simulation = await fixture({ mode: 'SIMULATION_ONLY' });
    const approved = await http(simulation.body);
    expect(approved.status).toBe(200); expect(approved.body.meta.available_commands).toEqual([]);
    expect((await http(commitBody(simulation))).body.error.code).toBe('SIMULATION_ONLY');
    const f = await fixture(); await http(f.body);
    expect((await http({ ...commitBody(f), candidate_plan_id: 'alternate' })).body.error.code).toBe('APPROVED_CANDIDATE_CONFLICT');
    const head = await db.operationsHead.findUnique({ where: { factoryId: f.snapshot.factory_id } });
    await ingestFactorySnapshot({ factoryId: f.snapshot.factory_id, expectedHeadRevision: head.revision,
      snapshot: { ...f.snapshot, snapshot_id: `changed-${randomUUID()}` }, sourceId: 'changed-basis' }, db);
    const before = await effects(f);
    expect((await http(commitBody(f))).body.error.code).toBe('SNAPSHOT_CONFLICT');
    expect(await effects(f)).toEqual(before);
    expect((await getDecisionCase(db, users.ADMIN, f.id)).meta.available_commands).toEqual([]);
  });
  test.each(['decisionCaseEvent', 'decisionCaseIdempotencyReceipt'])('failure at %s rolls back publication, head, case and audit; retry succeeds', async model => {
    const f = await fixture(); await http(f.body);
    const before = await effects(f), key = randomUUID();
    const broken = { decisionCase: db.decisionCase, $transaction: (fn, options) => db.$transaction(tx => fn(new Proxy(tx, {
      get(target, prop) { return prop === model ? new Proxy(target[prop], {
        get(delegate, method) { return method === 'create' ? () => { throw new Error('injected write failure'); } : delegate[method]; },
      }) : target[prop]; },
    })), options) };
    await expect(executeDecisionCommand(broken, users.ADMIN, f.id, commitBody(f), key)).rejects.toThrow('injected write failure');
    expect(await effects(f)).toEqual(before);
    expect((await http(commitBody(f), key)).status).toBe(200);
    expect((await current(f)).plan_version).toBe(1);
  });
  test('new decision, commit and schedule records are immutable; database prevents unsupported transitions', async () => {
    const f = await fixture();
    await expect(db.decisionCase.update({ where: { id: f.id }, data: { status: 'COMMITTED', revision: { increment: 1 } } })).rejects.toThrow();
    await http(f.body); await http(commitBody(f));
    await expect(db.decisionHumanRecord.update({ where: { caseId: f.id }, data: { note: 'rewritten' } })).rejects.toThrow();
    await expect(db.decisionCommit.delete({ where: { caseId: f.id } })).rejects.toThrow();
    await expect(db.operationSchedule.delete({ where: { factoryId_scheduleId_revision: { factoryId: f.snapshot.factory_id,
      scheduleId: f.candidate.schedule.schedule_id, revision: 9 } } })).rejects.toThrow();
  });
});
