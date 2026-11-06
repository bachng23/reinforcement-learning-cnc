const { randomUUID } = require('node:crypto');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { fixture } = require('../helpers/work-order-fixtures');
const { DecisionCaseWorker } = require('../../src/decision-worker/decision-case-worker');
const { OperationsPlanningClient } = require('../../src/services/operations-planning.client');
const { contentHash } = require('../../src/services/operations-contract.service');
let f;
const oldMode = process.env.FACTORY_ACCESS_SOURCE;
beforeAll(async () => {
  if (!/^product_api_it_planning_\w+$/.test(new URL(process.env.DATABASE_URL).searchParams.get('schema')))
    throw Error('Use the isolated real FastAPI planning runner');
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  f = await fixture(db, app);
});
afterAll(async () => {
  if (oldMode === undefined) delete process.env.FACTORY_ACCESS_SOURCE;
  else process.env.FACTORY_ACCESS_SOURCE = oldMode;
  await f?.close();
  await db.$disconnect();
});

test('real HTTP case -> dedicated worker/FastAPI -> APPROVE/COMMIT -> Work Order -> independent close', async () => {
  const snapshot = await f.factory();
  const created = await f.http('/decision-cases', {
    method: 'POST',
    body: {
      schema_version: '3.0',
      factory_id: snapshot.factory_id,
      expected_snapshot_id: snapshot.snapshot_id,
      expected_plan_version: 0,
      request: {
        mode: 'LIVE',
        trigger: { type: 'MANUAL_REPLAN', reason: 'Work Order end-to-end' },
        planning_config: { horizon_minutes: 720 },
      },
    },
  });
  expect(created.status).toBe(202);
  const id = created.body.data.decision_case_id;
  const worker = new DecisionCaseWorker({
    db,
    planningClient: new OperationsPlanningClient({ baseUrl: process.env.AI_SERVICE_URL }),
    logger: { error: () => {} },
    leaseMs: 10000,
    heartbeatMs: 500,
  });
  let result;
  for (let i = 0; i < 10; i++) {
    result = await worker.runOnce();
    if (result.caseId === id || result.outcome === 'idle') break;
  }
  expect(result).toMatchObject({ outcome: 'completed', caseId: id });
  const recommended = await f.http(`/decision-cases/${id}/recommendation`);
  expect(recommended.status).toBe(200);
  const rec = recommended.body.data.recommendation;
  const candidate = rec.candidate_plans.find((c) => c.candidate_plan_id === rec.recommended_plan_id);
  expect(candidate.validation.verdict).toBe('VALID');
  const assignment = candidate.schedule.assignments.find((a) => a.assignment_type === 'MAINTENANCE');
  expect(assignment).toBeDefined();
  const detail = await f.http(`/decision-cases/${id}`);
  const command = {
    schema_version: '3.0',
    decision_case_id: id,
    command: 'APPROVE',
    recommendation_id: rec.recommendation_id,
    expected_snapshot_id: snapshot.snapshot_id,
    expected_plan_version: 0,
    expected_case_revision: detail.body.meta.case_revision,
    candidate_plan_id: candidate.candidate_plan_id,
    candidate_version: candidate.plan_version,
  };
  const approve = await f.http(`/decision-cases/${id}/decision`, { method: 'POST', body: command });
  expect(approve.status).toBe(200);
  const approved = await f.http(`/decision-cases/${id}`);
  const commit = await f.http(`/decision-cases/${id}/decision`, {
    method: 'POST',
    body: { ...command, command: 'COMMIT', expected_case_revision: approved.body.meta.case_revision },
  });
  expect(commit.status).toBe(200);
  const head = await db.operationsHead.findUnique({ where: { factoryId: snapshot.factory_id } });
  expect(head.planVersion).toBe(1);
  const schedules = await db.operationSchedule.findMany({ where: { factoryId: snapshot.factory_id } });
  const order = await f.create({
    body: {
      factory_id: snapshot.factory_id,
      source: {
        decision_case_id: id,
        schedule_id: candidate.schedule.schedule_id,
        schedule_revision: candidate.schedule.revision,
        schedule_hash: contentHash(candidate.schedule),
        assignment_id: assignment.assignment_id,
      },
      expected_head: {
        snapshot_id: head.snapshotId,
        plan_version: head.planVersion,
        revision: head.revision,
      },
    },
  });
  expect(order.status).toBe(201);
  let row = order.body.data;
  async function execute(command, fields = {}, user = f.users.OPERATOR) {
    const r = await f.command(row, command, fields, user, randomUUID());
    expect(r.status).toBe(200);
    row = r.body.data;
  }
  await execute('ASSIGN', { assignee_user_id: f.users.OPERATOR.id }, f.users.MANAGER);
  await execute('ACCEPT');
  await execute('START');
  await execute('BLOCK', { reason: 'Safety access check' });
  await execute('RESUME', { reason: 'Access confirmed' });
  await execute('COMPLETE', {
    report: {
      outcome: 'SUCCESS',
      work_performed: 'Completed assigned maintenance',
      result: 'Inspection passed',
    },
  });
  await execute(
    'CLOSE',
    { verification: { result: 'VERIFIED', note: 'Independent confirmation' } },
    f.users.MANAGER,
  );
  expect(row.status).toBe('CLOSED');
  expect((await f.http(`/work-orders/${row.id}`, { user: f.users.VIEWER })).body.data.status).toBe('CLOSED');
  expect(await db.operationsHead.findUnique({ where: { factoryId: snapshot.factory_id } })).toEqual(head);
  expect(await db.operationSchedule.findMany({ where: { factoryId: snapshot.factory_id } })).toEqual(
    schedules,
  );
  expect(await db.workOrderCompletion.count({ where: { workOrderId: row.id } })).toBe(1);
  expect(await db.workOrderEvent.count({ where: { workOrderId: row.id } })).toBe(8);
}, 60000);

