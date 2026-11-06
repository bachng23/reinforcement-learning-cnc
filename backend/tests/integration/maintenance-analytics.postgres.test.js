const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { fixture } = require('../helpers/work-order-fixtures');
const R = require('../../src/services/work-order-read.service');
const golden = require('../../examples/maintenance-analytics-golden.json');
let f, p;
const originalClock = R.clock,
  oldMode = process.env.FACTORY_ACCESS_SOURCE;
beforeAll(async () => {
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  f = await fixture(db, app);
  p = (await require('../helpers/maintenance-analytics-golden').seedGolden(f)).publication;
}, 60000);
afterAll(async () => {
  R.clock = originalClock;
  if (oldMode === undefined) delete process.env.FACTORY_ACCESS_SOURCE;
  else process.env.FACTORY_ACCESS_SOURCE = oldMode;
  await f?.close();
  await db.$disconnect();
});
const query = (extra = {}) =>
  new URLSearchParams({ factory_id: p.body.factory_id, ...golden.period, ...extra });
const get = (endpoint, extra = {}, user = f.users.VIEWER) =>
  f.http('/maintenance-analytics/' + endpoint + '?' + query(extra), { user });
test('golden SQL cohorts and durations reconcile with real authenticated drilldown without leaking reports', async () => {
  const r = await get('overview');
  expect(r.status).toBe(200);
  expect(r.cache).toBe('no-store');
  const d = r.body.data;
  expect(d.snapshot.open_orders.value).toBe(0);
  for (const key of ['created_orders', 'closed_orders', 'cancelled_orders', 'successful_verified_orders'])
    expect(d.period[key].current.value).toBe(golden.expected[key]);
  for (const key of [
    'rework_decision_rate',
    'first_pass_verified_rate',
    'time_to_first_accept',
    'active_execution_time',
    'verification_wait_time',
  ]) {
    const { samples, ...expected } = golden.expected[key];
    expect(d.period[key].current).toMatchObject(expected);
    const drill = await get('drilldown', {
      metric_key: key,
      ...(key.endsWith('_rate') ? { population: 'denominator' } : {}),
    });
    expect(drill.status).toBe(200);
    expect(drill.body.data.total).toBe(expected.denominator ?? expected.sample_count);
    expect(JSON.stringify(drill.body)).not.toContain('PRIVATE');
    if (samples)
      expect(drill.body.data.items.map((i) => i.duration_seconds).sort((a, b) => b - a)).toEqual(samples);
    if (key.endsWith('_rate'))
      expect((await get('drilldown', { metric_key: key, population: 'numerator' })).body.data.total).toBe(
        expected.numerator,
      );
  }
});
test('pagination and machines use real samples; half-open range and empty buckets', async () => {
  const first = await get('drilldown', { metric_key: 'active_execution_time', limit: '1' });
  expect(first.status).toBe(200);
  const ids = [first.body.data.items[0].sample_id];
  let cursor = first.body.data.next_cursor;
  while (cursor) {
    const r = await get('drilldown', { metric_key: 'active_execution_time', limit: '1', cursor });
    expect(r.status).toBe(200);
    ids.push(...r.body.data.items.map((i) => i.sample_id));
    cursor = r.body.data.next_cursor;
  }
  expect(new Set(ids).size).toBe(3);
  expect((await get('machines')).status).toBe(200);
  const trends = await get('trends', { metric_key: 'closed_orders', bucket: 'day' });
  expect(trends.status).toBe(200);
  expect(trends.body.data[0].metric.value).toBe(1);
  const boundary = await get('overview', { to: '2026-09-22T04:03:40Z' });
  expect(boundary.body.data.period.closed_orders.current.value).toBe(0);
});

test('period cohorts select completion/decision time without clipping execution or repeating acceptance', async () => {
  const r = await get('overview', { from: '2026-09-22T04:02:00Z' });
  expect(r.status).toBe(200);
  const period = r.body.data.period;
  expect(period.created_orders.current.value).toBe(0);
  expect(period.closed_orders.current.value).toBe(1);
  expect(period.time_to_first_accept.current).toMatchObject({ sample_count: 0, median: null });
  expect(period.active_execution_time.current).toMatchObject({ sample_count: 2, median: 25, p90: 29 });
  expect(period.verification_wait_time.current).toMatchObject({ sample_count: 2, median: 20 });
  expect(period.active_execution_time.previous).toMatchObject({ sample_count: 1, median: 40 });
});
test('strict query, definitions, unknown machine and live scope checks', async () => {
  expect((await f.http('/maintenance-analytics/definitions', { user: f.users.VIEWER })).status).toBe(200);
  expect((await get('overview', { status: 'CLOSED' })).status).toBe(400);
  expect((await get('overview', { machine_id: 'missing' })).status).toBe(404);
  expect((await get('overview', {}, f.users.OUTSIDER)).status).toBe(404);
  expect((await get('overview', {}, f.users.INACTIVE)).status).toBe(401);
  await f.member(p.body.factory_id, f.users.VIEWER, 'DELETE');
  expect((await get('overview')).status).toBe(404);
  await f.member(p.body.factory_id, f.users.VIEWER);
});
test('DST calendar clipping, Monday weeks, month buckets, zero baselines and precise period bounds', async () => {
  const days = await get('trends', {
    metric_key: 'closed_orders',
    from: '2026-03-07T05:00:00Z',
    to: '2026-03-10T04:00:00Z',
    timezone: 'America/New_York',
  });
  expect(days.status).toBe(200);
  expect(days.body.data.map((b) => (Date.parse(b.end) - Date.parse(b.start)) / 3600000)).toEqual([
    24, 23, 24,
  ]);
  expect(days.body.data.every((b) => b.metric.value === 0)).toBe(true);
  const weeks = await get('trends', {
    metric_key: 'closed_orders',
    bucket: 'week',
    from: '2026-09-22T00:00:00Z',
    to: '2026-10-01T00:00:00Z',
  });
  expect(weeks.body.data.map((b) => b.start)).toEqual([
    '2026-09-22T00:00:00.000Z',
    '2026-09-28T00:00:00.000Z',
  ]);
  const months = await get('trends', {
    metric_key: 'active_execution_time',
    bucket: 'month',
    from: '2026-08-15T00:00:00Z',
    to: '2026-10-01T00:00:00Z',
  });
  expect(months.body.data[0].metric).toMatchObject({
    median: null,
    p90: null,
    sample_count: 0,
    availability: 'NO_DATA',
  });
  const precise = await get('overview', {
    from: '2026-09-22T04:00:00.000001Z',
    to: '2026-09-22T04:00:00.000003Z',
  });
  expect(precise.status).toBe(200);
  expect(precise.body.meta.comparison_period.from).toBe('2026-09-22T03:59:59.999999Z');
  expect(precise.body.data.period.created_orders.current.value).toBe(0);
  expect(precise.body.data.period.created_orders.previous.value).toBe(1);
  const overview = await get('overview');
  expect(overview.body.data.period.created_orders.delta).toEqual({ absolute: 1, percent: null });
  expect(overview.body.data.period.rework_decision_rate.previous).toMatchObject({
    value: null,
    denominator: 0,
    availability: 'NO_DATA',
  });
});
test('cursor tampering, scope/metric reuse, repeated parameters and authenticated read-only evidence', async () => {
  const effect = async () =>
    Promise.all([
      db.workOrder.count(),
      db.workOrderEvent.count(),
      db.workOrderCompletion.count(),
      db.workOrderCommandReceipt.count(),
      db.auditLog.count(),
      db.operationsHead.findMany(),
      db.operationSchedule.count(),
    ]);
  const before = await effect();
  const first = await get('drilldown', { metric_key: 'active_execution_time', limit: '1' });
  const cursor = first.body.data.next_cursor;
  expect((await get('drilldown', { metric_key: 'verification_wait_time', limit: '1', cursor })).status).toBe(
    400,
  );
  expect(
    (await get('drilldown', { metric_key: 'active_execution_time', limit: '1', cursor }, f.users.MANAGER))
      .status,
  ).toBe(400);
  expect(
    (await get('drilldown', { metric_key: 'active_execution_time', limit: '1', cursor: 'x' + cursor }))
      .status,
  ).toBe(400);
  expect(
    (
      await f.http('/maintenance-analytics/overview?' + query() + '&factory_id=other', {
        user: f.users.VIEWER,
      })
    ).status,
  ).toBe(400);
  expect((await get('overview', { from: '2026-01-01T00:00:00', to: '2026-01-02T00:00:00Z' })).status).toBe(
    400,
  );
  expect((await get('overview', { from: '2026-01-01T00:00:00Z', to: '2025-01-02T00:00:00Z' })).status).toBe(
    400,
  );
  expect(await effect()).toEqual(before);
});
test('database outage is 503 no-store through real authenticated HTTP', async () => {
  const { startApi } = require('../helpers/work-order-process-client');
  const url = new URL(process.env.DATABASE_URL);
  url.port = '1';
  url.searchParams.set('connect_timeout', '1');
  const api = await startApi({ DATABASE_URL: url.toString() });
  try {
    const r = await api.http('/maintenance-analytics/overview?' + query(), f.users.VIEWER);
    expect(r.status).toBe(503);
    expect(r.cache).toBe('no-store');
    expect(r.body).not.toHaveProperty('data');
  } finally {
    await api.stop();
  }
}, 30000);

test('manager hold and post-start reassignment exclude idle time; VERIFIED_STOPPED is not successful', async () => {
  const publication = await f.publish(await f.factory());
  const scope = { factory_id: publication.body.factory_id };
  let row;
  const steps = [
    [0, 'CREATE'],
    [5, 'ASSIGN'],
    [10, 'ACCEPT'],
    [20, 'START'],
    [30, 'MANAGER_HOLD'],
    [40, 'REASSIGN'],
    [50, 'ACCEPT'],
    [60, 'START'],
    [90, 'COMPLETE'],
    [100, 'CLOSE'],
  ];
  try {
    for (const [offset, command] of steps) {
      R.clock = async () => new Date(Date.parse(golden.base) + offset * 1000);
      const fields =
        {
          ASSIGN: { assignee_user_id: f.users.OPERATOR.id },
          MANAGER_HOLD: { reason: 'Unavailable executor' },
          REASSIGN: { assignee_user_id: f.users.OTHER.id, reason: 'Replacement' },
          COMPLETE: {
            report: {
              outcome: 'STOPPED',
              work_performed: 'PRIVATE stopped work',
              result: 'Stopped',
              stop_reason: 'Waiting for equipment',
            },
          },
          CLOSE: { verification: { result: 'VERIFIED_STOPPED', note: 'PRIVATE independent note' } },
        }[command] ?? {};
      const manager = ['ASSIGN', 'MANAGER_HOLD', 'REASSIGN', 'CLOSE'].includes(command);
      const r =
        command === 'CREATE'
          ? await f.create(publication)
          : await f.command(
              row,
              command,
              fields,
              manager ? f.users.MANAGER : offset >= 50 ? f.users.OTHER : f.users.OPERATOR,
            );
      expect(r.status).toBe(command === 'CREATE' ? 201 : 200);
      row = r.body.data;
      if (command === 'MANAGER_HOLD') {
        const blocked = await get('drilldown', {
          ...scope,
          metric_key: 'blocked_orders',
          from: '2020-01-01T00:00:00Z',
          to: '2020-01-02T00:00:00Z',
        });
        expect(blocked.body.data.items[0]).toMatchObject({
          command: 'MANAGER_HOLD',
          reason: 'Unavailable executor',
        });
        expect(blocked.body.data.total).toBe(1);
      }
    }
  } finally {
    R.clock = originalClock;
  }
  const r = await get('overview', scope);
  expect(r.status).toBe(200);
  expect(r.body.data.period.closed_orders.current).toMatchObject({
    value: 1,
    verification: { VERIFIED: 0, VERIFIED_STOPPED: 1 },
  });
  expect(r.body.data.period.successful_verified_orders.current.value).toBe(0);
  expect(r.body.data.period.active_execution_time.current).toMatchObject({ median: 40, sample_count: 1 });
  expect(r.body.data.period.time_to_first_accept.current.median).toBe(10);
});

test('missing completed-attempt history is partial coverage, never fabricated zero', async () => {
  const row = await db.workOrder.findFirst({ where: { factoryId: p.body.factory_id } });
  await db.workOrderCompletion.create({
    data: {
      workOrderId: row.id,
      factoryId: row.factoryId,
      attempt: 9,
      actorId: f.users.OPERATOR.id,
      completedAt: new Date('2026-09-22T04:03:30Z'),
      reportJson: {
        outcome: 'SUCCESS',
        work_performed: 'Synthetic inconsistent history',
        result: 'Fixture only',
      },
    },
  });
  const r = await get('overview');
  expect(r.status).toBe(200);
  expect(r.body.data.coverage).toBe('PARTIAL');
  expect(r.body.data.period.active_execution_time.current).toMatchObject({
    median: 30,
    p90: 38,
    sample_count: 3,
    excluded_count: 1,
    exclusions: { MISSING_HISTORY: 1 },
  });
  const drill = await get('drilldown', { metric_key: 'active_execution_time' });
  expect(drill.body.data.total).toBe(4);
  expect(drill.body.data.items.filter((r) => r.exclusion_reason === 'MISSING_HISTORY')).toHaveLength(1);
});

test('a concurrent workflow write does not mix snapshots inside one response; next request sees the write', async () => {
  const publication = await f.publish(await f.factory());
  const created = await f.create(publication);
  expect(created.status).toBe(201);
  const row = created.body.data;
  let signal, release;
  const entered = new Promise((r) => (signal = r)),
    resume = new Promise((r) => (release = r));
  const original = db.$transaction.bind(db);
  let intercepted = false;
  // Scheduling barrier only: every authorization/query still executes on actual PG.
  const spy = jest.spyOn(db, '$transaction').mockImplementation((fn, options) => {
    if (options?.isolationLevel !== 'RepeatableRead' || intercepted) return original(fn, options);
    intercepted = true;
    return original(async (tx) => {
      await tx.$queryRaw`SELECT count(*) FROM work_orders`; // Establish the request snapshot.
      signal();
      await resume;
      return fn(tx);
    }, options);
  });
  try {
    const pending = get('overview', { factory_id: publication.body.factory_id });
    await entered;
    const cancelled = await f.command(row, 'CANCEL', { reason: 'No longer required' }, f.users.MANAGER);
    expect(cancelled.status).toBe(200);
    release();
    const old = await pending;
    expect(old.status).toBe(200);
    expect(old.body.data.snapshot.open_orders.value).toBe(1);
  } finally {
    release();
    spy.mockRestore();
  }
  const current = await get('overview', { factory_id: publication.body.factory_id });
  expect(current.body.data.snapshot.open_orders.value).toBe(0);
}, 30000);

test('historical machine remains scoped after S2 removal; current empty machines are valid', async () => {
  const publication = await f.publish(await f.factory());
  const r = await f.create(publication);
  expect(r.status).toBe(201);
  const snapshot = structuredClone(publication.snapshot);
  snapshot.snapshot_id = 'historical-machine-S2';
  snapshot.machines = snapshot.machines.filter((m) => m.machine_id !== 'M03');
  snapshot.health_snapshots = snapshot.health_snapshots.filter((m) => m.machine_id !== 'M03');
  snapshot.jobs = [];
  snapshot.maintenance_requests = [];
  snapshot.current_schedule = null;
  const head = await db.operationsHead.findUnique({ where: { factoryId: snapshot.factory_id } });
  await require('../../src/services/operations-snapshot.service').ingestFactorySnapshot(
    {
      factoryId: snapshot.factory_id,
      expectedHeadRevision: head.revision,
      snapshot,
      sourceId: 'analytics-historical-test',
    },
    db,
  );
  const scope = { factory_id: snapshot.factory_id };
  const historical = await get('machines', { ...scope, machine_id: 'M03' });
  expect(historical.status).toBe(200);
  expect(historical.body.data.items[0]).toMatchObject({
    machine_id: 'M03',
    present_in_current_snapshot: false,
    name: null,
  });
  const empty = await get('overview', { ...scope, machine_id: 'M06' });
  expect(empty.status).toBe(200);
  expect(empty.body.data.snapshot.open_orders.value).toBe(0);
  const detail = await get('drilldown', { ...scope, machine_id: 'M03', metric_key: 'open_orders' });
  expect(detail.body.data.items[0]).toMatchObject({
    basis_snapshot_id: publication.snapshot.snapshot_id,
    schedule_id: publication.body.source.schedule_id,
  });
  const current = await db.operationsHead.findUnique({ where: { factoryId: snapshot.factory_id } });
  expect(current.planVersion).toBe(head.planVersion);
  expect(current.scheduleId).toBe(head.scheduleId);
});

test('overdue equality uses the exact database observation microsecond', async () => {
  const publication = await f.publish(await f.factory());
  const created = await f.create(publication);
  expect(created.status).toBe(201);
  const cutoff = created.body.data.planned_end_at;
  const original = db.$transaction.bind(db);
  let observed = cutoff;
  const spy = jest.spyOn(db, '$transaction').mockImplementation((fn, options) =>
    original(async (tx) => {
      const proxy = new Proxy(tx, {
        get(target, key) {
          if (key !== '$queryRaw') return Reflect.get(target, key);
          return (strings, ...values) => {
            if (Array.isArray(strings) && strings[0].includes('to_char(clock_timestamp()'))
              return target.$queryRaw`SELECT to_char(${observed}::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`;
            return target.$queryRaw(strings, ...values);
          };
        },
      });
      return fn(proxy);
    }, options),
  );
  try {
    const q = { factory_id: publication.body.factory_id, from: '2026-09-22T00:00:00Z', to: cutoff };
    const equal = await get('overview', q);
    expect(equal.status).toBe(200);
    expect(equal.body.data.snapshot.overdue_orders.value).toBe(0);
    observed = cutoff.replace('.000Z', '.000001Z');
    const after = await get('overview', q);
    expect(after.status).toBe(200);
    expect(after.body.data.snapshot.overdue_orders.value).toBe(1);
  } finally {
    spy.mockRestore();
  }
});

test('fixed completed cohort paginates equal timestamps and distinct microseconds without lost/repeated samples', async () => {
  const row = await db.workOrder.findFirst({ where: { factoryId: p.body.factory_id } });
  for (const [attempt, at] of [
    [10, '2026-09-22T04:03:21.000001Z'],
    [11, '2026-09-22T04:03:21.000002Z'],
    [12, '2026-09-22T04:03:21.000002Z'],
  ]) {
    await db.$executeRaw`INSERT INTO work_order_completions(work_order_id,factory_id,attempt,actor_id,completed_at,report_json)
      VALUES(${row.id}::uuid,${row.factoryId},${attempt},${f.users.OPERATOR.id}::uuid,${at}::timestamptz,
        '{"outcome":"SUCCESS","work_performed":"Synthetic missing-history fixture","result":"Fixture"}'::jsonb)`;
  }
  const items = [];
  let cursor;
  let total;
  do {
    const r = await get('drilldown', {
      metric_key: 'active_execution_time',
      limit: '2',
      ...(cursor ? { cursor } : {}),
    });
    expect(r.status).toBe(200);
    total = r.body.data.total;
    items.push(...r.body.data.items);
    cursor = r.body.data.next_cursor;
  } while (cursor);
  expect(items).toHaveLength(total);
  expect(new Set(items.map((r) => r.sample_id)).size).toBe(total);
  expect(items.filter((r) => r.cohort_at === '2026-09-22T04:03:21.000002Z')).toHaveLength(2);
  expect(items.filter((r) => r.cohort_at === '2026-09-22T04:03:21.000001Z')).toHaveLength(1);
});

test('event adjacency never bridges a missing sequence when measuring execution time', async () => {
  const { Prisma } = require('@prisma/client');
  const { projection } = require('../../src/services/maintenance-analytics-query');
  const order = await db.workOrder.findFirstOrThrow({ where: { factoryId: p.body.factory_id } });
  const before = await db.workOrderEvent.count({ where: { workOrderId: order.id } });
  const rollback = new Error('Rollback isolated missing-history fixture');
  await expect(db.$transaction(async (tx) => {
    // Corrupt only this transaction's fixture, then roll back both DDL and data.
    await tx.$executeRawUnsafe('ALTER TABLE work_order_events DISABLE TRIGGER work_order_events_immutable');
    await tx.$executeRaw`DELETE FROM work_order_events WHERE work_order_id=${order.id}::uuid AND sequence=5`;
    const rows = await tx.$queryRaw(Prisma.sql`${projection({ factory_id: p.body.factory_id }, new Date(), [order.id])}
      SELECT duration_seconds,exclusion_reason FROM samples
      WHERE metric_key='active_execution_time' AND attempt=1`);
    // START #4 must not run until RESUME #6 across the missing BLOCK #5.
    // Only the intact RESUME -> COMPLETE interval contributes 30 seconds.
    expect(rows).toEqual([{ duration_seconds: 30, exclusion_reason: 'INCONSISTENT_HISTORY' }]);
    throw rollback;
  }, { timeout: 30000 })).rejects.toBe(rollback);
  expect(await db.workOrderEvent.count({ where: { workOrderId: order.id } })).toBe(before);
});
