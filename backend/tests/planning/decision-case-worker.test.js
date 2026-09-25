const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const { OperationsPlanningClient } = require('../../src/services/operations-planning.client');
const { DecisionCaseWorker } = require('../../src/decision-worker/decision-case-worker');
const lifecycle = require('../../src/services/decision-case-lifecycle.service');
const { createDecisionCase, getDecisionCase,
  getDecisionCaseRecommendation } = require('../../src/services/decision-case.service');
const { seedOperations } = require('../../src/services/operations-context.service');
const { loadCanonicalSeedPlan, validatePayload } = require('../../src/services/operations-contract.service');

const db = new PrismaClient();
const baseUrl = process.env.AI_SERVICE_URL;
const actor = { id: randomUUID(), role: 'ADMIN' };
const silent = { error: () => {} };
let plan, factoryId, snapshotId, planVersion;
const calls = async () => (await fetch(`${baseUrl}/test/requests`)).json();
const planningClient = (mode, options = {}) => new OperationsPlanningClient({
  baseUrl: mode ? `${baseUrl}/faults/${mode}` : baseUrl, ...options,
});

async function createCase(reason = randomUUID()) {
  const result = await createDecisionCase(db, actor, {
    factory_id: factoryId, schema_version: '3.0', expected_snapshot_id: snapshotId,
    expected_plan_version: planVersion, request: { mode: 'LIVE',
      trigger: { type: 'MANUAL_REPLAN', reason: `Worker integration ${reason}` },
      planning_config: plan.run_request.planning_config },
  }, randomUUID());
  return result.body.data.decision_case_id;
}

function worker(client = planningClient(), options = {}) {
  return new DecisionCaseWorker({ db, planningClient: client, logger: silent,
    leaseMs: 5000, heartbeatMs: 500, pollMs: 10, ...options });
}

beforeAll(async () => {
  if (!/^product_api_it_planning_\w+$/.test(new URL(process.env.DATABASE_URL).searchParams.get('schema'))) {
    throw new Error('Use npm run test:operations-planning to isolate PostgreSQL and start FastAPI');
  }
  plan = await loadCanonicalSeedPlan();
  factoryId = plan.factory_id;
  snapshotId = plan.run_request.factory_snapshot.snapshot_id;
  await seedOperations(db, plan, { factoryId });
  const head = await db.operationsHead.findUnique({ where: { factoryId } });
  planVersion = head.planVersion;
});

afterAll(async () => db.$disconnect());

afterEach(async () => {
  let active;
  for (let i = 0; i < 100; i++) {
    active = (await (await fetch(`${baseUrl}/test/active`)).json()).active;
    if (active === 0) break;
    await delay(20);
  }
  expect(active).toBe(0);
});

test('seed -> create -> dedicated worker -> real FastAPI -> persist -> AWAITING_APPROVAL -> read package', async () => {
  const caseId = await createCase('full-flow');
  const headBefore = await db.operationsHead.findUnique({ where: { factoryId } });
  const schedulesBefore = await db.operationSchedule.count({ where: { factoryId } });
  const callCount = (await calls()).length;
  const result = await worker().runOnce();
  expect(result).toMatchObject({ outcome: 'completed', caseId });

  const row = await db.decisionCase.findUnique({ where: { id: caseId }, include: { recommendation: true } });
  expect(row).toMatchObject({ status: 'AWAITING_APPROVAL', processingStatus: 'IDLE',
    processingStage: null, attempt: 1, leaseToken: null, leaseExpiresAt: null });
  const read = await getDecisionCaseRecommendation(db, actor, caseId);
  expect(read.data).toEqual(await validatePayload(read.data, 'recommendation'));
  expect(read.data).toMatchObject({ decision_case_id: caseId, snapshot_id: snapshotId });
  expect(read.data.candidate_plans.length).toBeGreaterThanOrEqual(1);
  expect(read.data.candidate_plans.length).toBeLessThanOrEqual(3);
  expect(read.data.candidate_plans.every(candidate => candidate.validation.verdict === 'VALID')).toBe(true);
  expect(read.data.candidate_plans.some(candidate => candidate.validation.verdict === 'INVALID')).toBe(false);
  expect((await getDecisionCase(db, actor, caseId)).data).toMatchObject({
    status: 'AWAITING_APPROVAL', recommendation_id: read.data.recommendation_id,
  });
  const forwarded = (await calls()).slice(callCount);
  expect(forwarded).toHaveLength(1);
  expect(forwarded[0].body.decision_case_id).toBe(caseId);
  expect(forwarded[0].request_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(forwarded[0].correlation_id).toBe(caseId);
  expect(await db.operationsHead.findUnique({ where: { factoryId } })).toEqual(headBefore);
  expect(await db.operationSchedule.count({ where: { factoryId } })).toBe(schedulesBefore);
});

test('duplicate workers claim a case once and persist one immutable recommendation', async () => {
  const caseId = await createCase('duplicate-workers');
  const results = await Promise.all([worker().runOnce(), worker().runOnce()]);
  expect(results.map(result => result.outcome).sort()).toEqual(['completed', 'idle']);
  expect(results.find(result => result.outcome === 'completed').caseId).toBe(caseId);
  expect(await db.decisionCaseRecommendation.count({ where: { caseId } })).toBe(1);
});

test('expired crash lease is reclaimed with fencing and a new attempt', async () => {
  const caseId = await createCase('crash-reclaim');
  const crashed = await lifecycle.claimNextDecisionCase(db, { leaseMs: 100,
    now: new Date(Date.now() - 10000) });
  expect(crashed.id).toBe(caseId);
  const reclaimed = await lifecycle.claimNextDecisionCase(db, { leaseMs: 5000 });
  expect(reclaimed).toMatchObject({ id: caseId, reclaimed: true, attempt: 2 });
  expect(reclaimed.leaseToken).not.toBe(crashed.leaseToken);
  expect(await lifecycle.heartbeatDecisionCase(db, crashed, { leaseMs: 5000 })).toBe(false);
  const request = await lifecycle.buildPlanningRequest(reclaimed);
  const recommendation = await planningClient().plan(request, {
    requestId: reclaimed.requestId, correlationId: reclaimed.correlationId,
  });
  await lifecycle.persistDecisionRecommendation(db, reclaimed, recommendation);
  expect((await db.decisionCase.findUnique({ where: { id: caseId } })).status).toBe('AWAITING_APPROVAL');
});

test('retryable 503 is retried once by the planning client and then persisted', async () => {
  const caseId = await createCase('bounded-retry');
  const before = (await calls()).length;
  expect(await worker(planningClient('retry-once')).runOnce()).toMatchObject({ outcome: 'completed', caseId });
  const attempts = (await calls()).slice(before);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
});

test.each([
  ['422', 'INVALID_PLANNING_REQUEST'],
  ['409', 'NO_FEASIBLE_PLAN'],
  ['504', 'PLANNING_TIMEOUT'],
  ['schema-invalid', 'INVALID_AI_RESPONSE'],
])('%s blocks processing with a safe error and never changes the current schedule', async (mode, code) => {
  const caseId = await createCase(`blocked-${mode}`);
  const callCount = (await calls()).length;
  const headBefore = await db.operationsHead.findUnique({ where: { factoryId } });
  const countBefore = await db.operationSchedule.count({ where: { factoryId } });
  expect(await worker(planningClient(mode)).runOnce()).toMatchObject({ outcome: 'blocked', caseId, code });
  const row = await db.decisionCase.findUnique({ where: { id: caseId } });
  expect(row).toMatchObject({ status: 'ANALYZING', processingStatus: 'BLOCKED',
    processingStage: 'PLANNING', errorCode: code, leaseToken: null, leaseExpiresAt: null });
  expect(row.errorMessage).not.toMatch(/trace|stack|127\.0\.0\.1|FastAPI/i);
  expect((await calls()).length - callCount).toBe(1);
  expect(await db.operationsHead.findUnique({ where: { factoryId } })).toEqual(headBefore);
  expect(await db.operationSchedule.count({ where: { factoryId } })).toBe(countBefore);
});

test('timeout is bounded and leaves the case blocked without a lease', async () => {
  const caseId = await createCase('transport-timeout');
  const started = Date.now();
  const result = await worker(planningClient('timeout', { timeoutMs: 500 })).runOnce();
  expect(result).toMatchObject({ outcome: 'blocked', caseId, code: 'PLANNING_TIMEOUT' });
  expect(Date.now() - started).toBeLessThan(3000);
  expect(await db.decisionCase.findUnique({ where: { id: caseId } })).toMatchObject({
    processingStatus: 'BLOCKED', leaseToken: null, leaseExpiresAt: null,
  });
});

test('graceful shutdown aborts the AI call and releases the lease for another worker', async () => {
  const caseId = await createCase('graceful-shutdown');
  const before = (await calls()).length;
  const controller = new AbortController();
  const pending = worker(planningClient('timeout', { timeoutMs: 10000 })).runOnce({ signal: controller.signal });
  for (let i = 0; i < 100 && (await calls()).length === before; i++) await delay(20);
  controller.abort();
  expect(await pending).toMatchObject({ outcome: 'released', caseId });
  expect(await db.decisionCase.findUnique({ where: { id: caseId } })).toMatchObject({
    status: 'ANALYZING', processingStatus: 'QUEUED', leaseToken: null, leaseExpiresAt: null,
  });
  expect(await worker().runOnce()).toMatchObject({ outcome: 'completed', caseId });
});

test('the same pinned request has deterministic planner replay before persistence', async () => {
  const caseId = await createCase('deterministic-replay');
  const claim = await lifecycle.claimNextDecisionCase(db, { leaseMs: 5000 });
  const request = await lifecycle.buildPlanningRequest(claim);
  const options = { requestId: claim.requestId, correlationId: claim.correlationId };
  const first = await planningClient().plan(request, options);
  const second = await planningClient().plan(request, options);
  expect(second).toEqual(first);
  await lifecycle.persistDecisionRecommendation(db, claim, first);
  expect((await getDecisionCaseRecommendation(db, actor, caseId)).data).toEqual(first);
});
