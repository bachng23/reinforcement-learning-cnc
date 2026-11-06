const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { fixture } = require('../helpers/work-order-fixtures');
const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');
let f;
const oldMode = process.env.FACTORY_ACCESS_SOURCE;
beforeAll(async () => {
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  f = await fixture(db, app);
}, 30000);
afterAll(async () => {
  if (oldMode === undefined) delete process.env.FACTORY_ACCESS_SOURCE;
  else process.env.FACTORY_ACCESS_SOURCE = oldMode;
  await f?.close();
  await db.$disconnect();
});
const ok = (r) => {
  expect(r.status).toBe(200);
  return r.body.data;
};
test('HTTP reload and historical receipt survive two independent API processes; real consumer lookup is scoped', async () => {
  const { startApi } = require('../helpers/work-order-process-client');
  const { lookupWorkOrderSummaries } = require('../../src/services/work-order-read.service');
  const p = await f.publish(await f.factory());
  let row = await running(p);
  row = ok(await f.command(row, 'COMPLETE', { report }));
  const key = randomUUID(),
    body = {
      command: 'CLOSE',
      expected_revision: row.revision,
      verification: { result: 'VERIFIED', note: 'Independent process verification' },
    };
  let api = await startApi();
  let closed, events;
  try {
    closed = await api.http(`/work-orders/${row.id}/commands`, f.users.MANAGER, { body, key });
    expect(closed.status).toBe(200);
    events = await api.http(`/work-orders/${row.id}/events`, f.users.VIEWER);
    expect(events.status).toBe(200);
  } finally {
    await api.stop();
  }
  const before = await effects(p.body.factory_id);
  api = await startApi();
  try {
    const reload = await api.http(`/work-orders/${row.id}`, f.users.MANAGER);
    expect(reload.status).toBe(200);
    expect(reload.body.data).toEqual(closed.body.data);
    expect((await api.http(`/work-orders/${row.id}/events`, f.users.VIEWER)).body.data).toEqual(
      events.body.data,
    );
    expect(await api.http(`/work-orders/${row.id}/commands`, f.users.MANAGER, { body, key })).toMatchObject({
      status: 200,
      body: closed.body,
      replay: 'true',
    });
    const summaries = await db.$transaction(
      (tx) => lookupWorkOrderSummaries(tx, f.users.VIEWER, { factory_id: p.body.factory_id, ids: [row.id] }),
      { isolationLevel: 'RepeatableRead' },
    );
    expect(summaries.data[0]).toMatchObject({
      id: row.id,
      status: 'CLOSED',
      factory_id: p.body.factory_id,
      machine_id: row.machine_id,
    });
    expect(summaries.data[0]).not.toHaveProperty('latest_completion');
    await expect(
      db.$transaction((tx) =>
        lookupWorkOrderSummaries(tx, f.users.OUTSIDER, { factory_id: p.body.factory_id, ids: [row.id] }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      db.$transaction((tx) =>
        lookupWorkOrderSummaries(tx, f.users.VIEWER, {
          factory_id: p.body.factory_id,
          ids: [row.id, randomUUID()],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await effects(p.body.factory_id)).toEqual(before);
  } finally {
    await api.stop();
  }
}, 60000);

test('inactive assignee recovery and role-downgraded historical replay enforce fresh DB users', async () => {
  const p = await f.publish(await f.factory());
  const executor = await db.user.create({
    data: { username: randomUUID(), passwordHash: 'test-only', role: 'OPERATOR' },
  });
  await f.member(p.body.factory_id, executor);
  let row = await running(p, executor);
  const started = row.actual_started_at;
  expect((await f.http(`/users/${executor.id}`, { method: 'PATCH', body: { active: false } })).status).toBe(
    200,
  );
  expect((await f.command(row, 'COMPLETE', { report }, executor)).status).toBe(401);
  row = ok(await f.command(row, 'MANAGER_HOLD', { reason: 'Inactive executor' }, f.users.MANAGER));
  row = ok(
    await f.command(
      row,
      'REASSIGN',
      { reason: 'Eligible replacement', assignee_user_id: f.users.OTHER.id },
      f.users.MANAGER,
    ),
  );
  row = ok(await f.command(row, 'ACCEPT', {}, f.users.OTHER));
  row = ok(await f.command(row, 'START', {}, f.users.OTHER));
  expect(row.actual_started_at).toBe(started);
  expect((await db.user.findUnique({ where: { id: executor.id } })).active).toBe(false);
  row = ok(await f.command(row, 'COMPLETE', { report }, f.users.OTHER));
  const verifier = await db.user.create({
    data: { username: randomUUID(), passwordHash: 'test-only', role: 'ENGINEER' },
  });
  await f.member(p.body.factory_id, verifier);
  const key = randomUUID(),
    fields = { verification: { result: 'VERIFIED', note: 'Independent verification' } },
    completed = row;
  row = ok(await f.command(completed, 'CLOSE', fields, verifier, key));
  const before = await effects(p.body.factory_id);
  expect((await f.http(`/users/${verifier.id}`, { method: 'PATCH', body: { role: 'VIEWER' } })).status).toBe(
    200,
  );
  expect((await f.command(completed, 'CLOSE', fields, verifier, key)).status).toBe(403);
  expect(await effects(p.body.factory_id)).toEqual(before);
}, 60000);

test('real unavailable database returns 503 for summaries, never missing/closed or an env fallback', async () => {
  const { startApi } = require('../helpers/work-order-process-client');
  const url = new URL(process.env.DATABASE_URL);
  url.hostname = '127.0.0.1';
  url.port = '1';
  url.searchParams.set('connect_timeout', '1');
  const api = await startApi({
    DATABASE_URL: url.toString(),
    OPERATIONS_FACTORY_ACCESS: JSON.stringify({ 'factory-unavailable': [f.users.VIEWER.id] }),
  });
  try {
    const r = await api.http(
      '/work-orders/summaries?factory_id=factory-unavailable&ids=' + randomUUID(),
      f.users.VIEWER,
    );
    expect(r).toMatchObject({
      status: 503,
      cache: 'no-store',
      body: { success: false, error: { code: 'DB_UNAVAILABLE' }, requestId: 'restart-proof' },
    });
    expect(r.body).not.toHaveProperty('data');
  } finally {
    await api.stop();
  }
}, 30000);
test('manager recovery preserves start and reports after access loss, with replay and rollback', async () => {
  const p = await f.publish(await f.factory());
  let row = await running(p);
  const started = row.actual_started_at;
  await f.member(p.body.factory_id, f.users.OPERATOR, 'DELETE');
  expect((await f.command(row, 'BLOCK', { reason: 'Revoked' })).status).toBe(404);
  const old = row,
    key = randomUUID();
  const before = await effects(p.body.factory_id);
  const fail = jest.spyOn(db, '$transaction').mockImplementationOnce(async (callback) => {
    const { PrismaClient } = require('@prisma/client');
    const isolated = new PrismaClient();
    try {
      return await isolated.$transaction((tx) =>
        callback(
          new Proxy(tx, {
            get(target, prop) {
              if (prop === 'auditLog')
                return {
                  create: async () => {
                    throw Error('injected recovery audit failure');
                  },
                };
              return Reflect.get(target, prop);
            },
          }),
        ),
      );
    } finally {
      await isolated.$disconnect();
    }
  });
  try {
    expect(
      (await f.command(row, 'MANAGER_HOLD', { reason: 'Safe recovery' }, f.users.MANAGER, key)).status,
    ).toBe(500);
  } finally {
    fail.mockRestore();
  }
  expect(await effects(p.body.factory_id)).toEqual(before);
  row = ok(await f.command(row, 'MANAGER_HOLD', { reason: 'Safe recovery' }, f.users.MANAGER, key));
  expect(
    (await f.command(old, 'MANAGER_HOLD', { reason: 'Safe recovery' }, f.users.MANAGER, key)).replay,
  ).toBe('true');
  row = ok(
    await f.command(
      row,
      'REASSIGN',
      { assignee_user_id: f.users.OTHER.id, reason: 'Replacement' },
      f.users.MANAGER,
    ),
  );
  row = ok(await f.command(row, 'ACCEPT', {}, f.users.OTHER));
  row = ok(await f.command(row, 'START', {}, f.users.OTHER));
  row = ok(await f.command(row, 'COMPLETE', { report }, f.users.OTHER));
  await f.member(p.body.factory_id, f.users.OTHER, 'DELETE');
  await f.member(p.body.factory_id, f.users.OPERATOR);
  const reworkKey = randomUUID(),
    completed = row,
    input = { assignee_user_id: f.users.OPERATOR.id, reason: 'Independent rework' };
  row = ok(await f.command(row, 'REASSIGN_FOR_REWORK', input, f.users.MANAGER, reworkKey));
  expect(row).toMatchObject({
    status: 'ASSIGNED',
    attempt: 2,
    actual_started_at: started,
    actual_completed_at: null,
  });
  expect(row.latest_completion.attempt).toBe(1);
  expect((await f.command(completed, 'REASSIGN_FOR_REWORK', input, f.users.MANAGER, reworkKey)).replay).toBe(
    'true',
  );
  expect((await f.command(row, 'CANCEL', { reason: 'Cannot undo execution' }, f.users.MANAGER)).status).toBe(
    409,
  );
  row = ok(await f.command(row, 'ACCEPT'));
  row = ok(await f.command(row, 'START'));
  row = ok(await f.command(row, 'COMPLETE', { report }));
  row = ok(
    await f.command(
      row,
      'CLOSE',
      { verification: { result: 'VERIFIED', note: 'Independent' } },
      f.users.MANAGER,
    ),
  );
  expect(row.status).toBe('CLOSED');
  expect(await db.workOrderCompletion.count({ where: { workOrderId: row.id } })).toBe(2);
}, 60000);
async function created(p) {
  const r = await f.create(p);
  expect(r.status).toBe(201);
  return r.body.data;
}
async function running(p, assignee = f.users.OPERATOR) {
  let row = await created(p);
  row = ok(await f.command(row, 'ASSIGN', { assignee_user_id: assignee.id }, f.users.MANAGER));
  row = ok(await f.command(row, 'ACCEPT', {}, assignee));
  return ok(await f.command(row, 'START', {}, assignee));
}
const report = { outcome: 'SUCCESS', work_performed: 'Replace and inspect', result: 'Inspection passed' };
async function effects(factoryId) {
  return {
    orders: await db.workOrder.findMany({ where: { factoryId }, orderBy: { id: 'asc' } }),
    events: await db.workOrderEvent.count({ where: { factoryId } }),
    completions: await db.workOrderCompletion.count({ where: { factoryId } }),
    receipts: await db.workOrderCommandReceipt.count({ where: { factoryId } }),
    audit: await db.auditLog.count({ where: { factoryId, action: { startsWith: 'WORK_ORDER_' } } }),
  };
}
test('real COMMIT -> execution, independent rework/verification and immutable schedule/history', async () => {
  const snapshot = await f.factory(),
    p = await f.publish(snapshot);
  const schedules = await db.operationSchedule.findMany({ where: { factoryId: snapshot.factory_id } }),
    head = await db.operationsHead.findUnique({ where: { factoryId: snapshot.factory_id } });
  let row = await running(p, f.users.OTHER),
    firstStart = row.actual_started_at;
  row = ok(await f.command(row, 'BLOCK', { reason: 'Await inspection' }, f.users.OTHER));
  row = ok(await f.command(row, 'RESUME', { reason: 'Inspection available' }, f.users.OTHER));
  row = ok(await f.command(row, 'COMPLETE', { report }, f.users.OTHER));
  expect(row.waiting_verification).toBe(true);
  expect(
    (
      await f.command(
        row,
        'CLOSE',
        { verification: { result: 'VERIFIED', note: 'Self check' } },
        f.users.OTHER,
      )
    ).status,
  ).toBe(403);
  expect((await f.command(row, 'REQUEST_REWORK', { reason: 'Self rework' }, f.users.OTHER)).status).toBe(403);
  row = ok(await f.command(row, 'REQUEST_REWORK', { reason: 'Repeat alignment' }, f.users.MANAGER));
  expect(row.attempt).toBe(2);
  expect(row.latest_completion.attempt).toBe(1);
  expect(row.actual_completed_at).toBeNull();
  row = ok(await f.command(row, 'BLOCK', { reason: 'Hand over' }, f.users.OTHER));
  row = ok(
    await f.command(
      row,
      'REASSIGN',
      { assignee_user_id: f.users.OPERATOR.id, reason: 'Reviewed handover' },
      f.users.MANAGER,
    ),
  );
  expect(
    (await f.command(row, 'CANCEL', { reason: 'Cannot erase started work' }, f.users.MANAGER)).status,
  ).toBe(409);
  row = ok(await f.command(row, 'ACCEPT'));
  row = ok(await f.command(row, 'START'));
  expect(row.actual_started_at).toBe(firstStart);
  row = ok(
    await f.command(row, 'COMPLETE', {
      report: { ...report, outcome: 'STOPPED', stop_reason: 'Unsafe to continue' },
    }),
  );
  expect(
    (
      await f.command(
        row,
        'CLOSE',
        { verification: { result: 'VERIFIED', note: 'Wrong outcome' } },
        f.users.MANAGER,
      )
    ).status,
  ).toBe(409);
  row = ok(
    await f.command(
      row,
      'CLOSE',
      { verification: { result: 'VERIFIED_STOPPED', note: 'Stop independently confirmed' } },
      f.users.MANAGER,
    ),
  );
  expect(row.status).toBe('CLOSED');
  expect(row.available_commands).toEqual([]);
  expect(row.overdue).toBe(false);
  expect((await f.command(row, 'REQUEST_REWORK', { reason: 'Terminal' }, f.users.MANAGER)).status).toBe(409);
  const events = (await f.http(`/work-orders/${row.id}/events`)).body.data;
  expect(events.map((e) => e.sequence)).toEqual(Array.from({ length: row.revision }, (_, i) => i + 1));
  expect(events.filter((e) => e.command === 'COMPLETE').map((e) => e.payload.report.outcome)).toEqual([
    'SUCCESS',
    'STOPPED',
  ]);
  expect(await db.workOrderCompletion.count({ where: { workOrderId: row.id } })).toBe(2);
  expect(await db.operationSchedule.findMany({ where: { factoryId: snapshot.factory_id } })).toEqual(
    schedules,
  );
  expect(await db.operationsHead.findUnique({ where: { factoryId: snapshot.factory_id } })).toEqual(head);
}, 60000);
test('create/command receipts replay original response; normalized reason, wrong body, fresh role/scope', async () => {
  const p = await f.publish(await f.factory()),
    key = randomUUID();
  const first = await f.create(p, { key });
  expect(first.status).toBe(201);
  expect(await f.create(p, { key })).toMatchObject({ status: 201, body: first.body, replay: 'true' });
  expect((await f.create(p)).body.error.code).toBe('WORK_ORDER_ORIGIN_EXISTS');
  expect(
    (await f.create({ ...p, body: { ...p.body, overlap_override_reason: 'Changed' } }, { key })).body.error
      .code,
  ).toBe('IDEMPOTENCY_KEY_REUSED');
  let row = ok(
    await f.command(first.body.data, 'ASSIGN', { assignee_user_id: f.users.OPERATOR.id }, f.users.MANAGER),
  );
  row = ok(await f.command(row, 'ACCEPT'));
  row = ok(await f.command(row, 'START'));
  const commandKey = randomUUID(),
    body = { command: 'BLOCK', expected_revision: row.revision, reason: '  Waiting for part  ' };
  const command = () =>
    f.http(`/work-orders/${row.id}/commands`, {
      method: 'POST',
      user: f.users.OPERATOR,
      key: commandKey,
      body,
    });
  const blocked = await command();
  expect(blocked.status).toBe(200);
  const before = await effects(p.body.factory_id);
  body.reason = 'Waiting for part';
  expect(await command()).toMatchObject({ status: 200, body: blocked.body, replay: 'true' });
  expect(await effects(p.body.factory_id)).toEqual(before);
  await f.member(p.body.factory_id, f.users.OPERATOR, 'DELETE');
  expect((await command()).status).toBe(404);
  expect(await effects(p.body.factory_id)).toEqual(before);
  expect((await f.create(p, { user: f.users.VIEWER })).status).toBe(403);
  expect((await f.http('/work-orders/' + row.id, { user: f.users.INACTIVE })).status).toBe(401);
});
test('strict inputs, assignment eligibility, scoped404, non-assignee and no-store errors', async () => {
  const p = await f.publish(await f.factory()),
    row = await created(p);
  for (const body of [
    { ...p.body, actor_id: f.users.ADMIN.id },
    null,
    [],
    { ...p.body, source: { ...p.body.source, occurred_at: '2026-01-01' } },
  ])
    expect((await f.create(p, { body })).status).toBe(400);
  for (const user of [f.users.ADMIN, f.users.INACTIVE, f.users.OUTSIDER, f.users.VIEWER])
    expect(
      (await f.command(row, 'ASSIGN', { assignee_user_id: user.id }, f.users.MANAGER)).body.error.code,
    ).toBe('ASSIGNEE_UNAVAILABLE');
  expect((await f.command(row, 'ASSIGN', { assignee_user_id: randomUUID() }, f.users.MANAGER)).status).toBe(
    409,
  );
  const assigned = ok(
    await f.command(row, 'ASSIGN', { assignee_user_id: f.users.OPERATOR.id }, f.users.MANAGER),
  );
  expect((await f.command(assigned, 'ACCEPT', {}, f.users.OTHER)).body.error.code).toBe(
    'WORK_ORDER_NOT_ASSIGNEE',
  );
  expect((await f.command(row, 'CANCEL', { reason: 'Stale' }, f.users.MANAGER)).body.error.code).toBe(
    'WORK_ORDER_REVISION_CONFLICT',
  );
  for (const path of [
    `/work-orders/${row.id}`,
    `/work-orders/${row.id}/events`,
    `/work-orders?factory_id=${p.body.factory_id}`,
    `/work-orders/summaries?factory_id=${p.body.factory_id}&ids=${row.id}`,
  ]) {
    const denied = await f.http(path, { user: f.users.OUTSIDER });
    expect(denied.status).toBe(404);
    expect(denied.cache).toBe('no-store');
  }
  const before = await effects(p.body.factory_id);
  for (const path of [
    `/work-orders/${row.id}`,
    `/work-orders/${row.id}/events`,
    `/work-orders?factory_id=${p.body.factory_id}`,
  ])
    expect((await f.http(path, { user: f.users.VIEWER })).status).toBe(200);
  expect(await effects(p.body.factory_id)).toEqual(before);
  expect((await f.command(assigned, 'CANCEL', { reason: '  ' }, f.users.MANAGER)).status).toBe(400);
  expect((await f.command(assigned, 'START', {}, f.users.OPERATOR)).status).toBe(409);
  expect(
    (await f.command(assigned, 'ASSIGN', { assignee_user_id: f.users.OTHER.id }, f.users.MANAGER)).status,
  ).toBe(409);
});
test('cancelled published maintenance cannot create orders through HTTP or direct database inserts', async () => {
  const p = await f.publish(await f.factory(), { maintenanceStatus: 'CANCELLED' });
  const before = await effects(p.body.factory_id);
  const schedules = await db.operationSchedule.findMany({ where: { factoryId: p.body.factory_id } });
  const key = randomUUID();
  for (const attemptKey of [key, key, randomUUID()]) {
    const response = await f.create(p, { key: attemptKey });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_WORK_ORDER_SOURCE');
    expect(await effects(p.body.factory_id)).toEqual(before);
  }
  const assignment = p.candidate.schedule.assignments.find(
    (a) => a.assignment_id === p.body.source.assignment_id,
  );
  const request = p.snapshot.maintenance_requests.find(
    (r) => r.maintenance_request_id === assignment.maintenance_request_id,
  );
  const { contentHash } = require('../../src/services/operations-contract.service');
  await expect(
    db.workOrder.create({
      data: {
        factoryId: p.body.factory_id,
        sourceCaseId: p.id,
        basisSnapshotId: p.snapshot.snapshot_id,
        scheduleId: p.body.source.schedule_id,
        scheduleRevision: p.body.source.schedule_revision,
        scheduleHash: p.body.source.schedule_hash,
        publishedPlanVersion: p.body.expected_head.plan_version,
        basisSnapshotHash: contentHash(p.snapshot),
        assignmentId: assignment.assignment_id,
        machineId: assignment.machine_id,
        maintenanceRequestId: request.maintenance_request_id,
        plannedStartAt: new Date(assignment.start_at),
        plannedEndAt: new Date(assignment.end_at),
        sourceTechnicianIds: assignment.technician_ids,
        requirementsJson: Object.fromEntries([
          'maintenance_type', 'action_type', 'priority', 'required_skill_ids',
          'minimum_skill_level', 'mandatory', 'expected_duration_minutes',
        ].map((k) => [k, request[k]])),
        actorId: f.users.ADMIN.id,
      },
    }),
  ).rejects.toThrow('Work order source projection is inconsistent');
  expect(await effects(p.body.factory_id)).toEqual(before);
  expect(await db.operationSchedule.findMany({ where: { factoryId: p.body.factory_id } })).toEqual(schedules);
});

test('PROPOSED maintenance in a genuinely committed publication remains an eligible source', async () => {
  const p = await f.publish(await f.factory(), { maintenanceStatus: 'PROPOSED' });
  const response = await f.create(p);
  expect(response.status).toBe(201);
  expect(response.body.data.status).toBe('UNASSIGNED');
});

test('only current committed maintenance sources; P2 does not rebase P1 and active request is unique', async () => {
  const s = await f.factory();
  // Seed-style publication in a unique factory, never pollute the canonical demo.
  const plan = s;
  const { contentHash } = require('../../src/services/operations-contract.service');
  await db.operationSchedule.create({
    data: {
      factoryId: s.factory_id,
      snapshotId: s.snapshot_id,
      scheduleId: s.current_schedule.schedule_id,
      revision: s.current_schedule.revision,
      schemaVersion: '3.0',
      contentHash: contentHash(s.current_schedule),
      payloadJson: s.current_schedule,
    },
  });
  const head = await db.operationsHead.update({
    where: { factoryId: s.factory_id },
    data: {
      scheduleId: s.current_schedule.schedule_id,
      scheduleRevision: s.current_schedule.revision,
      planVersion: 1,
      revision: { increment: 1 },
    },
  });
  const seedBody = {
    factory_id: plan.factory_id,
    source: {
      decision_case_id: randomUUID(),
      schedule_id: head.scheduleId,
      schedule_revision: head.scheduleRevision,
      schedule_hash: 'a'.repeat(64),
      assignment_id: 'unused',
    },
    expected_head: { snapshot_id: head.snapshotId, plan_version: head.planVersion, revision: head.revision },
  };
  expect((await f.create({ body: seedBody })).body.error.code).toBe('INVALID_WORK_ORDER_SOURCE');
  const p = await f.publish(s);
  const approved = await f.publish(s, { commit: false });
  expect((await f.create(approved)).status).toBe(409);
  const simulation = await f.publish(s, { mode: 'SIMULATION_ONLY', commit: false });
  expect((await f.create(simulation)).status).toBe(409);
  const production = p.candidate.schedule.assignments.find((a) => a.assignment_type === 'PRODUCTION');
  expect(
    (
      await f.create({
        ...p,
        body: { ...p.body, source: { ...p.body.source, assignment_id: production.assignment_id } },
      })
    ).body.error.code,
  ).toBe('INVALID_WORK_ORDER_SOURCE');
  const row = await created(p),
    second = await f.publish(s);
  expect((await f.create(p)).body.error.code).toBe('SOURCE_PLAN_CHANGED');
  expect((await f.create(second)).body.error.code).toBe('ACTIVE_MAINTENANCE_REQUEST_EXISTS');
  const historic = ok(await f.http('/work-orders/' + row.id));
  expect(historic.source_is_current).toBe(false);
  expect(historic.source).toEqual(row.source);
  await f.command(row, 'CANCEL', { reason: 'Replace old unstarted order' }, f.users.MANAGER);
  expect((await f.create(second)).status).toBe(201);
}, 60000);

test('different-basis overlap requires an explicit audited override; original source remains immutable', async () => {
  const s = await f.factory(),
    p = await f.publish(s),
    first = await created(p);
  const h = await db.operationsHead.findUnique({ where: { factoryId: s.factory_id } }),
    s2 = { ...structuredClone(s), snapshot_id: 'new-basis-' + randomUUID() };
  await ingestFactorySnapshot(
    { factoryId: s.factory_id, expectedHeadRevision: h.revision, snapshot: s2, sourceId: 'new-telemetry' },
    db,
  );
  const p2 = await f.publish(s2);
  expect((await f.create(p2)).body.error.code).toBe('WORK_ORDER_OVERLAP');
  expect((await f.create({ ...p2, body: { ...p2.body, overlap_override_reason: ' ' } })).status).toBe(400);
  const second = await created({
    ...p2,
    body: { ...p2.body, overlap_override_reason: 'Reviewed explicit parallel plan' },
  });
  const e = (await f.http(`/work-orders/${second.id}/events`)).body.data[0];
  expect(e.payload.overlapping_work_order_ids).toContain(first.id);
  expect(e.payload.overlap_override_reason).toBe('Reviewed explicit parallel plan');
  expect((await f.http('/work-orders/' + first.id)).body.data.source).toEqual(first.source);
  const other = await f.publish(await f.factory());
  expect((await f.create({ ...other, body: { ...other.body, source: p2.body.source } })).status).toBe(409);
}, 60000);

test('fixed-data pagination, strict filters/cursors, bounded lookup and historical machine labels', async () => {
  const s = await f.factory(),
    ids = [];
  for (let i = 0; i < 4; i++) {
    const p = await f.publish(s),
      original = db.$transaction.bind(db);
    const spy = jest.spyOn(db, '$transaction').mockImplementationOnce((fn, opt) =>
      original(
        (tx) =>
          fn(
            new Proxy(tx, {
              get(t, k) {
                if (k === '$queryRaw')
                  return (...args) =>
                    String(args[0]).includes('clock_timestamp() AS at')
                      ? Promise.resolve([{ at: new Date('2026-01-01T00:00:00.000Z') }])
                      : t.$queryRaw(...args);
                return t[k];
              },
            }),
          ),
        opt,
      ),
    );
    let row;
    try {
      row = await created(p);
    } finally {
      spy.mockRestore();
    }
    ids.push(row.id);
    if (i < 3) ok(await f.command(row, 'CANCEL', { reason: 'Superseded before start' }, f.users.MANAGER));
  }
  const base = '/work-orders?factory_id=' + s.factory_id;
  let cursor,
    seen = [];
  do {
    const r = await f.http(base + '&limit=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    expect(r.status).toBe(200);
    seen.push(...r.body.data.map((x) => x.id));
    cursor = r.body.meta.next_cursor;
  } while (cursor);
  expect(seen).toEqual(ids.slice().sort().reverse());
  const page = await f.http(base + '&limit=1'),
    c = encodeURIComponent(page.body.meta.next_cursor);
  for (const q of [
    'limit=0',
    'limit=101',
    'limit=1&limit=2',
    'unknown=x',
    'overdue=yes',
    'cursor=bad',
    'status=invalid',
  ])
    expect((await f.http(base + '&' + q)).status).toBe(400);
  expect((await f.http(base + '&cursor=' + c + '&status=CANCELLED')).status).toBe(400);
  expect((await f.http(base + '&cursor=' + c, { user: f.users.VIEWER })).status).toBe(400);
  expect((await f.http(base + '&status=CANCELLED&overdue=true')).body.data).toEqual([]);
  expect(
    (await f.http(base + '&status=UNASSIGNED&machine_id=M03&overdue=true')).body.data.map((r) => r.id),
  ).toEqual([ids.at(-1)]);
  const lookup = await f.http(`/work-orders/summaries?factory_id=${s.factory_id}&ids=${ids.join(',')}`);
  expect(lookup.body.data.map((r) => r.id)).toEqual(ids);
  expect(JSON.stringify(lookup.body)).not.toMatch(
    /work_performed|private planner|passwordHash|requirements|latest_completion/,
  );
  expect(
    (await f.http(`/work-orders/summaries?factory_id=${s.factory_id}&ids=${ids[0]},${randomUUID()}`)).status,
  ).toBe(404);
  expect(
    (await f.http(`/work-orders/summaries?factory_id=${s.factory_id}&ids=${ids[0]},${ids[0]}`)).status,
  ).toBe(400);
  const h = await db.operationsHead.findUnique({ where: { factoryId: s.factory_id } }),
    next = {
      ...structuredClone(s),
      snapshot_id: 'no-M03-' + randomUUID(),
      current_schedule: null,
      jobs: [],
      maintenance_requests: [],
    };
  next.machines = next.machines.filter((m) => m.machine_id !== 'M03');
  next.health_snapshots = next.health_snapshots.filter((m) => m.machine_id !== 'M03');
  await ingestFactorySnapshot(
    {
      factoryId: s.factory_id,
      expectedHeadRevision: h.revision,
      snapshot: next,
      sourceId: 'historical-machine-test',
    },
    db,
  );
  const historical = (await f.http(base + '&machine_id=M03&status=UNASSIGNED')).body.data[0];
  expect(historical.machine_in_current_snapshot).toBe(false);
  expect(historical.source_is_current).toBe(true);
  expect(historical.basis_snapshot_id).toBe(s.snapshot_id);
}, 90000);

async function race(first, second, beforeRelease = async () => {}) {
  let enter, release, timer;
  const entered = new Promise((r) => (enter = r)),
    resume = new Promise((r) => (release = r)),
    original = db.$transaction.bind(db);
  const spy = jest.spyOn(db, '$transaction').mockImplementationOnce((fn, opt) =>
    original(
      (tx) =>
        fn(
          new Proxy(tx, {
            get(t, k) {
              if (k === '$queryRaw')
                return async (...args) => {
                  const result = await t.$queryRaw(...args);
                  if (String(args[0]).includes('pg_advisory_xact_lock')) {
                    enter();
                    await resume;
                  }
                  return result;
                };
              return t[k];
            },
          }),
        ),
      { ...opt, timeout: 20000 },
    ),
  );
  const a = first();
  try {
    await Promise.race([
      entered,
      a.then(() => {
        throw Error('First request did not acquire factory lock');
      }),
      new Promise((_, reject) => (timer = setTimeout(() => reject(Error('Factory barrier timeout')), 5000))),
    ]);
    spy.mockRestore();
    const b = second();
    let blocked = false;
    for (let i = 0; i < 150; i++) {
      const [r] =
        await db.$queryRaw`SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted`;
      if (r.n) {
        blocked = true;
        break;
      }
      await delay(20);
    }
    expect(blocked).toBe(true);
    await beforeRelease();
    release();
    return await Promise.all([a, b]);
  } finally {
    clearTimeout(timer);
    spy.mockRestore();
    release();
  }
}
test.each(['create', 'command', 'replay', 'recovery', 'recovery-replay'])(
  'revocation vs %s in both serialization orders',
  async (kind) => {
    for (const revokeFirst of [true, false]) {
      const p = await f.publish(await f.factory());
      let write, user;
      if (kind === 'create') {
        user = f.users.MANAGER;
        write = () => f.create(p, { user });
      } else if (kind.startsWith('recovery')) {
        user = f.users.MANAGER;
        const row = await running(p),
          key = randomUUID(),
          fields = { reason: 'Manager recovery' };
        if (kind === 'recovery-replay')
          expect((await f.command(row, 'MANAGER_HOLD', fields, user, key)).status).toBe(200);
        write = () => f.command(row, 'MANAGER_HOLD', fields, user, key);
      } else {
        user = f.users.OPERATOR;
        let row = await running(p);
        const key = randomUUID(),
          fields = { reason: 'Pause' };
        if (kind === 'replay') expect((await f.command(row, 'BLOCK', fields, user, key)).status).toBe(200);
        write = () => f.command(row, 'BLOCK', fields, user, key);
      }
      const before = await effects(p.body.factory_id),
        revoke = () => f.member(p.body.factory_id, user, 'DELETE');
      const results = await race(revokeFirst ? revoke : write, revokeFirst ? write : revoke),
        result = results[revokeFirst ? 1 : 0];
      expect(results[revokeFirst ? 0 : 1].status).toBe(200);
      expect(result.status).toBe(revokeFirst ? 404 : kind === 'create' ? 201 : 200);
      if (revokeFirst || kind.endsWith('replay')) expect(await effects(p.body.factory_id)).toEqual(before);
      expect((await write()).status).toBe(404);
    }
  },
  90000,
);

test('duplicate create and competing state transitions serialize with one winner', async () => {
  const p = await f.publish(await f.factory()),
    results = await race(
      () => f.create(p),
      () => f.create(p),
    );
  expect(results.map((r) => r.status)).toEqual([201, 409]);
  let row = results[0].body.data;
  row = ok(await f.command(row, 'ASSIGN', { assignee_user_id: f.users.OPERATOR.id }, f.users.MANAGER));
  const accept = await race(
    () => f.command(row, 'ACCEPT'),
    () => f.command(row, 'ACCEPT', {}, f.users.OTHER),
  );
  expect(accept.map((r) => r.status)).toEqual([200, 403]);
  row = ok(await f.command(accept[0].body.data, 'START'));
  const complete = await race(
    () => f.command(row, 'COMPLETE', { report }),
    () => f.command(row, 'BLOCK', { reason: 'Race' }),
  );
  expect(complete.map((r) => r.status)).toEqual([200, 409]);
  row = complete[0].body.data;
  const close = await race(
    () =>
      f.command(
        row,
        'CLOSE',
        { verification: { result: 'VERIFIED', note: 'Independent review' } },
        f.users.MANAGER,
      ),
    () => f.command(row, 'REQUEST_REWORK', { reason: 'Race' }, f.users.OTHER),
  );
  expect(close.map((r) => r.status)).toEqual([200, 409]);
}, 60000);

test('head change wins creation lock; queued user downgrade/inactivation denies mutation', async () => {
  const p = await f.publish(await f.factory()),
    h = await db.operationsHead.findUnique({ where: { factoryId: p.body.factory_id } });
  const next = { ...structuredClone(p.snapshot), snapshot_id: 'head-race-' + randomUUID() };
  const results = await race(
    () =>
      ingestFactorySnapshot(
        { factoryId: p.body.factory_id, expectedHeadRevision: h.revision, snapshot: next, sourceId: 'race' },
        db,
      ),
    () => f.create(p),
  );
  expect(results[1].body.error.code).toBe('SOURCE_PLAN_CHANGED');
  expect(await db.workOrder.count({ where: { factoryId: p.body.factory_id } })).toBe(0);
  for (const field of ['role', 'active']) {
    const pub = await f.publish(await f.factory()),
      user = await db.user.create({
        data: { username: randomUUID(), passwordHash: 'private', role: 'ENGINEER' },
      });
    await f.member(pub.body.factory_id, user);
    const r = await race(
      () => f.member(pub.body.factory_id, f.users.VIEWER, 'DELETE'),
      () => f.create(pub, { user }),
      async () => {
        const update = await f.http('/users/' + user.id, {
          method: 'PATCH',
          body: field === 'role' ? { role: 'VIEWER' } : { active: false },
        });
        expect(update.status).toBe(200);
      },
    );
    expect(r[1].status).toBe(field === 'role' ? 403 : 401);
    expect(await db.workOrder.count({ where: { factoryId: pub.body.factory_id } })).toBe(0);
  }
}, 90000);

test.each(['auditLog', 'workOrderCommandReceipt'])(
  'forced %s failure rolls back order, completion and event atomically',
  async (delegate) => {
    const p = await f.publish(await f.factory()),
      row = await running(p),
      before = await effects(p.body.factory_id),
      original = db.$transaction.bind(db);
    const spy = jest.spyOn(db, '$transaction').mockImplementationOnce((fn, opt) =>
      original(
        (tx) =>
          fn(
            new Proxy(tx, {
              get(t, k) {
                return k === delegate
                  ? {
                      create: async () => {
                        throw Error('Injected transactional failure');
                      },
                    }
                  : t[k];
              },
            }),
          ),
        opt,
      ),
    );
    try {
      expect((await f.command(row, 'COMPLETE', { report })).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await effects(p.body.factory_id)).toEqual(before);
    const completed = ok(await f.command(row, 'COMPLETE', { report }));
    await expect(
      db.workOrder.update({
        where: { id: row.id },
        data: { machineId: 'other', revision: { increment: 1 } },
      }),
    ).rejects.toThrow();
    await expect(db.workOrder.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(db.workOrderCompletion.deleteMany({ where: { workOrderId: row.id } })).rejects.toThrow(
      'immutable',
    );
    await expect(db.workOrderEvent.deleteMany({ where: { workOrderId: row.id } })).rejects.toThrow(
      'immutable',
    );
    await expect(db.workOrderCommandReceipt.deleteMany({ where: { workOrderId: row.id } })).rejects.toThrow(
      'immutable',
    );
    expect((await f.http('/work-orders/' + completed.id)).body.data.status).toBe('COMPLETED');
  },
  60000,
);


test('assignee discovery uses current factory membership and role; exact-origin lookup never substitutes another publication', async () => {
  const p = await f.publish(await f.factory());
  const row = (await f.create(p)).body.data;
  const base = '/work-orders/eligible-assignees?factory_id=' + p.body.factory_id;
  for (const actor of [f.users.ADMIN, f.users.MANAGER]) {
    const found = await f.http(base, {user: actor});
    expect(found.status).toBe(200);
    expect(found.body.data.map(u => u.user_id).sort()).toEqual([f.users.MANAGER.id, f.users.OPERATOR.id, f.users.OTHER.id].sort());
    expect(found.body.data.some(u => ['ADMIN','VIEWER','OUTSIDER','INACTIVE'].some(k => f.users[k].id === u.user_id))).toBe(false);
  }
  expect((await f.http(base, {user: f.users.VIEWER})).status).toBe(403);
  expect((await f.http(base, {user: f.users.OUTSIDER})).status).toBe(404);
  const page = await f.http(base + '&limit=1', {user: f.users.MANAGER});
  expect(page.body.data).toHaveLength(1);
  expect(page.body.meta.has_more).toBe(true);
  const next = await f.http(base + '&limit=1&after=' + page.body.meta.next_after, {user: f.users.MANAGER});
  expect(next.body.data[0].user_id).not.toBe(page.body.data[0].user_id);
  const origin = new URLSearchParams({factory_id: p.body.factory_id, schedule_id: p.body.source.schedule_id, schedule_revision: String(p.body.source.schedule_revision), assignment_id: p.body.source.assignment_id});
  const lookup = () => '/work-orders/by-origin?' + origin;
  expect((await f.http(lookup(), {user: f.users.VIEWER})).body.data).toEqual({id: row.id});
  const denied = await f.http(lookup(), {user: f.users.OUTSIDER});
  expect(denied.status).toBe(404); expect(JSON.stringify(denied.body)).not.toContain(row.id);
  origin.set('schedule_revision', String(p.body.source.schedule_revision + 1));
  expect((await f.http(lookup())).status).toBe(404);
  origin.delete('schedule_revision');
  expect((await f.http(lookup())).status).toBe(400);
  await f.member(p.body.factory_id, f.users.OPERATOR, 'DELETE');
  const after = await f.http(base, {user: f.users.MANAGER});
  expect(after.body.data.some(u => u.user_id === f.users.OPERATOR.id)).toBe(false);
  expect((await f.command(row, 'ASSIGN', {assignee_user_id: f.users.OPERATOR.id}, f.users.MANAGER)).body.error.code).toBe('ASSIGNEE_UNAVAILABLE');
}, 30000);
