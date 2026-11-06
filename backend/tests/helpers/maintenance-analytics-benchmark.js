const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const os = require('node:os');
const { Prisma } = require('@prisma/client');
const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');
const { contentHash } = require('../../src/services/operations-contract.service');
const { projection, aggregateColumns } = require('../../src/services/maintenance-analytics-query');

// Synthetic benchmark fixture: normal registry/ingest/APPROVE/COMMIT, then batched
// SQL workflow transitions with every database guard enabled. Never use a dev schema.
async function seed(db, f, { batches = 20, batchSize = 500 } = {}) {
  const original = await f.factory(),
    factoryId = original.factory_id;
  const request = original.maintenance_requests.find((r) => r.machine_id === 'M03');
  const base = Date.parse('2026-09-01T00:00:00Z');
  let firstId;
  for (let batch = 0; batch < batches; batch++) {
    const snapshot = structuredClone(original);
    snapshot.snapshot_id = 'analytics-benchmark-' + batch;
    snapshot.current_schedule = null;
    snapshot.maintenance_requests = Array.from({ length: batchSize }, (_, i) => ({
      ...request,
      maintenance_request_id: 'analytics-request-' + batch + '-' + i,
      machine_id: ['M01', 'M02', 'M03'][i % 3],
      expected_duration_minutes: 1,
      latest_start_at: null,
    }));
    const head = await db.operationsHead.findUnique({ where: { factoryId } });
    await ingestFactorySnapshot(
      { factoryId, expectedHeadRevision: head.revision, snapshot, sourceId: 'analytics-benchmark' },
      db,
    );
    const published = await f.publish(snapshot, {
      transformCandidate: (c) => {
        const template = c.schedule.assignments.find((a) => a.assignment_type === 'MAINTENANCE');
        c.schedule.assignments = snapshot.maintenance_requests.map((r, i) => ({
          ...template,
          assignment_id: 'analytics-assignment-' + batch + '-' + i,
          machine_id: r.machine_id,
          maintenance_request_id: r.maintenance_request_id,
          start_at: new Date(Date.parse(snapshot.planning_window.start_at) + i * 60000).toISOString(),
          end_at: new Date(Date.parse(snapshot.planning_window.start_at) + (i + 1) * 60000).toISOString(),
        }));
      },
    });
    const publication = await db.decisionCommit.findUnique({ where: { caseId: published.id } });
    const rows = published.candidate.schedule.assignments.map((a, i) => {
      const r = snapshot.maintenance_requests[i],
        id = randomUUID();
      firstId ??= id;
      return {
        id,
        factoryId,
        sourceCaseId: published.id,
        basisSnapshotId: snapshot.snapshot_id,
        scheduleId: publication.scheduleId,
        scheduleRevision: publication.scheduleRevision,
        scheduleHash: publication.scheduleHash,
        publishedPlanVersion: publication.planVersion,
        basisSnapshotHash: contentHash(snapshot),
        assignmentId: a.assignment_id,
        machineId: a.machine_id,
        maintenanceRequestId: r.maintenance_request_id,
        plannedStartAt: new Date(a.start_at),
        plannedEndAt: new Date(a.end_at),
        sourceTechnicianIds: a.technician_ids,
        requirementsJson: Object.fromEntries(
          [
            'maintenance_type',
            'action_type',
            'priority',
            'required_skill_ids',
            'minimum_skill_level',
            'mandatory',
            'expected_duration_minutes',
          ].map((k) => [k, r[k]]),
        ),
        actorId: f.users.MANAGER.id,
        createdAt: new Date(base + (batch * batchSize + i) * 60000),
        updatedAt: new Date(base + (batch * batchSize + i) * 60000),
      };
    });
    await db.$transaction(
      async (tx) => {
        await tx.workOrder.createMany({ data: rows });
        const ids = Prisma.join(rows.map((r) => Prisma.sql`${r.id}::uuid`));
        await tx.$executeRaw(Prisma.sql`INSERT INTO work_order_events(work_order_id,factory_id,sequence,actor_id,command,occurred_at,payload_json)
        SELECT id,factory_id,revision,actor_id,'CREATE',created_at,jsonb_build_object('to_status',status,'revision',revision,'attempt',attempt)
        FROM work_orders WHERE id IN (${ids})`);
        const steps = [
          ['ASSIGN', 'ASSIGNED', 5],
          ['ACCEPT', 'ACCEPTED', 10],
          ['START', 'IN_PROGRESS', 20],
          ['BLOCK', 'BLOCKED', 30],
          ['RESUME', 'IN_PROGRESS', 40],
          ['BLOCK', 'BLOCKED', 50],
          ['RESUME', 'IN_PROGRESS', 60],
          ['COMPLETE', 'COMPLETED', 80],
          ['REQUEST_REWORK', 'IN_PROGRESS', 100],
          ['COMPLETE', 'COMPLETED', 130],
          ['CLOSE', 'CLOSED', 150],
        ];
        for (const [command, status, seconds] of steps) {
          // 10% remain BLOCKED after 5 events, 10% remain COMPLETED after 9;
          // 80% have 12 events: 110,000 total for 10,000 orders.
          const selected = rows.filter(
            (_, i) => !(i % 10 === 0 && seconds > 30) && !(i % 10 === 1 && seconds > 80),
          );
          const selectedIds = Prisma.join(selected.map((r) => Prisma.sql`${r.id}::uuid`));
          await tx.$executeRaw(Prisma.sql`UPDATE work_orders SET status=${status},revision=revision+1,
          updated_at=created_at+${seconds}*interval '1 second',
          assignee_user_id=${f.users.OPERATOR.id}::uuid,
          blocker=CASE WHEN ${status}='BLOCKED' THEN 'Synthetic benchmark waiting' ELSE NULL END,
          verification_json=CASE WHEN ${status}='CLOSED' THEN jsonb_build_object('result','VERIFIED','note','Synthetic benchmark verification') ELSE NULL END,
          actual_started_at=CASE WHEN ${command}='START' THEN created_at+${seconds}*interval '1 second' ELSE actual_started_at END,
          actual_completed_at=CASE WHEN ${command}='COMPLETE' THEN created_at+${seconds}*interval '1 second' WHEN ${command}='REQUEST_REWORK' THEN NULL ELSE actual_completed_at END,
          attempt=attempt+CASE WHEN ${command}='REQUEST_REWORK' THEN 1 ELSE 0 END
          WHERE id IN (${selectedIds})`);
          await tx.$executeRaw(Prisma.sql`INSERT INTO work_order_events(work_order_id,factory_id,sequence,actor_id,command,occurred_at,payload_json)
          SELECT id,factory_id,revision,${f.users.MANAGER.id}::uuid,${command},updated_at,
            jsonb_build_object('to_status',status,'revision',revision,'attempt',attempt)
              || CASE WHEN ${command}='CLOSE' THEN jsonb_build_object('verification',jsonb_build_object('result','VERIFIED')) ELSE '{}'::jsonb END
          FROM work_orders WHERE id IN (${selectedIds})`);
          if (command === 'COMPLETE')
            await tx.$executeRaw(Prisma.sql`INSERT INTO work_order_completions(work_order_id,factory_id,attempt,actor_id,completed_at,report_json)
          SELECT id,factory_id,attempt,${f.users.OPERATOR.id}::uuid,updated_at,
            jsonb_build_object('outcome',CASE WHEN attempt=1 THEN 'PARTIAL' ELSE 'SUCCESS' END,'work_performed','Synthetic benchmark','result','Synthetic workflow result')
          FROM work_orders WHERE id IN (${selectedIds})`);
        }
      },
      { timeout: 120000 },
    );
    process.stdout.write('Benchmark seed batch ' + (batch + 1) + '/' + batches + '\n');
  }
  const other = await f.publish(await f.factory());
  await f.create(other);
  return {
    factory_id: factoryId,
    other_factory_id: other.body.factory_id,
    first_order_id: firstId,
    from: '2026-09-01T00:00:00Z',
    to: '2026-09-15T00:00:00Z',
  };
}
async function benchmark(db, f, dataset) {
  await db.$executeRawUnsafe('ANALYZE work_orders');
  await db.$executeRawUnsafe('ANALYZE work_order_events');
  await db.$executeRawUnsafe('ANALYZE work_order_completions');
  const results = [];
  for (const [endpoint, extra, budget] of [
    ['overview', {}, 1000],
    ['trends', { metric_key: 'active_execution_time', bucket: 'day' }, 1000],
    ['machines', { sort: 'active_p90' }, 1000],
    ['drilldown', { metric_key: 'active_execution_time', limit: '25' }, 500],
  ]) {
    const query = { factory_id: dataset.factory_id, from: dataset.from, to: dataset.to, ...extra };
    const timings = [];
    for (let n = 0; n < 25; n++) {
      const start = performance.now(),
        r = await f.http('/maintenance-analytics/' + endpoint + '?' + new URLSearchParams(query), {
          user: f.users.VIEWER,
        });
      const elapsed = performance.now() - start;
      if (r.status !== 200) throw Error('Benchmark HTTP ' + r.status + ' ' + JSON.stringify(r.body));
      if (
        endpoint === 'overview' &&
        (r.body.data.snapshot.open_orders.value !== 2000 ||
          r.body.data.snapshot.blocked_orders.value !== 1000 ||
          r.body.data.snapshot.waiting_verification_orders.value !== 1000 ||
          r.body.data.period.created_orders.current.value !== 10000 ||
          r.body.data.period.closed_orders.current.value !== 8000 ||
          r.body.data.period.active_execution_time.current.sample_count !== 17000)
      )
        throw Error(
          'Benchmark population or factory isolation differs from independently expected fixture counts',
        );
      if (n >= 5) timings.push(elapsed);
    }
    const p95 = [...timings].sort((a, b) => a - b)[Math.ceil(0.95 * timings.length) - 1];
    results.push({
      endpoint,
      query,
      warmups: 5,
      measured: 20,
      percentile_method: 'nearest-rank ceil(0.95*n)',
      timings_ms: timings,
      p95_ms: p95,
      budget_ms: budget,
      pass: p95 <= budget,
    });
    process.stdout.write(endpoint + ' p95=' + p95.toFixed(2) + 'ms\n');
  }
  const q = { factory_id: dataset.factory_id, from: dataset.from, to: dataset.to };
  const plan = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL work_mem = '32MB'");
      await tx.$executeRawUnsafe('SET LOCAL jit = off');
      return tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,SETTINGS,FORMAT JSON) ${projection(q, new Date().toISOString())}
    SELECT metric_key,${aggregateColumns()} FROM samples
      WHERE cohort_at>=(SELECT ${q.from}::timestamptz) AND cohort_at<(SELECT ${q.to}::timestamptz) GROUP BY metric_key`);
    },
    { isolationLevel: 'RepeatableRead', timeout: 30000 },
  );
  return {
    hardware: {
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0].model,
      logical_cpus: os.cpus().length,
      memory_bytes: os.totalmem(),
    },
    postgres: (await db.$queryRaw`SELECT version()`)[0].version,
    dataset: {
      ...dataset,
      orders: await db.workOrder.count({ where: { factoryId: dataset.factory_id } }),
      events: await db.workOrderEvent.count({ where: { factoryId: dataset.factory_id } }),
    },
    results,
    explain_description:
      'Shared sample aggregation; same transaction-local work_mem and jit policy as HTTP. UTC bounds are InitPlans, not repeated text casts per row.',
    plan,
  };
}
module.exports = { seed, benchmark };
