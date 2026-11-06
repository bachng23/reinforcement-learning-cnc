const { Prisma } = require('@prisma/client');
const { ApiError } = require('../lib/api-error');
const { authorizeFactory, currentUser } = require('./factory-access.service');
const policy = require('./maintenance-analytics-policy');
const { projection, aggregateColumns } = require('./maintenance-analytics-query');

function metric(def, row) {
  if (def.unit !== 'seconds' && row?.excluded_count > 0)
    throw new ApiError(
      500,
      'MAINTENANCE_ANALYTICS_INTEGRITY_ERROR',
      'Workflow source history is inconsistent',
    );
  if (def.unit === 'fraction') {
    const denominator = row?.denominator ?? 0,
      numerator = row?.numerator ?? 0;
    return {
      numerator,
      denominator,
      value: denominator ? numerator / denominator : null,
      availability: denominator ? 'AVAILABLE' : 'NO_DATA',
    };
  }
  if (def.unit === 'seconds') {
    const sample_count = row?.sample_count ?? 0,
      excluded_count = row?.excluded_count ?? 0;
    return {
      median: row?.median ?? null,
      p90: row?.p90 ?? null,
      sample_count,
      excluded_count,
      exclusions: {
        MISSING_HISTORY: row?.missing_history ?? 0,
        INCONSISTENT_HISTORY: row?.inconsistent_history ?? 0,
      },
      availability: excluded_count ? 'PARTIAL' : sample_count ? 'AVAILABLE' : 'NO_DATA',
      unit: 'seconds',
    };
  }
  return {
    value: row?.denominator ?? 0,
    availability: 'AVAILABLE',
    ...(def.metric_key === 'closed_orders'
      ? { verification: { VERIFIED: row?.verified ?? 0, VERIFIED_STOPPED: row?.verified_stopped ?? 0 } }
      : {}),
  };
}
function comparison(def, current, previous) {
  if (def.unit === 'fraction')
    return {
      current,
      previous,
      delta_percentage_points:
        current.value == null || previous.value == null ? null : (current.value - previous.value) * 100,
    };
  const delta = (key) => ({
    absolute: current[key] == null || previous[key] == null ? null : current[key] - previous[key],
    percent:
      current[key] != null && previous[key] > 0
        ? ((current[key] - previous[key]) / previous[key]) * 100
        : null,
  });
  return {
    current,
    previous,
    delta: def.unit === 'seconds' ? { median: delta('median'), p90: delta('p90') } : delta('value'),
  };
}
async function machineExists(tx, q) {
  if (!q.machine_id) return;
  const found =
    await tx.$queryRaw`SELECT EXISTS(SELECT 1 FROM work_orders WHERE factory_id=${q.factory_id} AND machine_id=${q.machine_id}) OR
    EXISTS(SELECT 1 FROM operations_heads h JOIN factory_snapshots s ON s.factory_id=h.factory_id AND s.snapshot_id=h.snapshot_id,
      LATERAL jsonb_array_elements(s.payload_json->'machines') m
      WHERE h.factory_id=${q.factory_id} AND m->>'machine_id'=${q.machine_id}) AS found`;
  if (!found[0].found)
    throw new ApiError(404, 'MAINTENANCE_ANALYTICS_MACHINE_NOT_FOUND', 'Machine was not found');
}
async function overview(tx, q, at, meta) {
  const rows = await tx.$queryRaw(Prisma.sql`${projection(q, at)}, periods AS (
    SELECT *,CASE WHEN metric_key IN ('open_orders','overdue_orders','blocked_orders','waiting_verification_orders') THEN 'snapshot'
      WHEN cohort_at>=(SELECT ${q.from}::timestamptz) AND cohort_at<(SELECT ${q.to}::timestamptz) THEN 'current'
      WHEN cohort_at>=(SELECT ${meta.comparison_period.from}::timestamptz) AND cohort_at<(SELECT ${q.from}::timestamptz) THEN 'previous' END AS period
    FROM samples
  ) SELECT metric_key,period,${aggregateColumns()} FROM periods WHERE period IS NOT NULL GROUP BY metric_key,period`);
  const get = (d, p) =>
    metric(
      d,
      rows.find((r) => r.metric_key === d.metric_key && r.period === p),
    );
  const snapshot = {},
    period = {};
  for (const d of policy.definitions) {
    if (d.cohort === 'CURRENT') snapshot[d.metric_key] = get(d, 'snapshot');
    else period[d.metric_key] = comparison(d, get(d, 'current'), get(d, 'previous'));
  }
  return {
    snapshot,
    period,
    coverage: Object.values(period).some(
      (r) => r.current.availability === 'PARTIAL' || r.previous.availability === 'PARTIAL',
    )
      ? 'PARTIAL'
      : 'AVAILABLE',
  };
}
async function trends(tx, q, at) {
  const buckets =
    await tx.$queryRaw`SELECT greatest(t AT TIME ZONE ${q.timezone},(SELECT ${q.from}::timestamptz)) AS start,
    least((t+('1 '||${q.bucket})::interval) AT TIME ZONE ${q.timezone},(SELECT ${q.to}::timestamptz)) AS "end"
    FROM generate_series(date_trunc(${q.bucket},(SELECT ${q.from}::timestamptz) AT TIME ZONE ${q.timezone}),
      (SELECT ${q.to}::timestamptz) AT TIME ZONE ${q.timezone},('1 '||${q.bucket})::interval) t
    WHERE t AT TIME ZONE ${q.timezone}<(SELECT ${q.to}::timestamptz) ORDER BY t LIMIT 401`;
  if (buckets.length > 400) throw new ApiError(400, 'VALIDATION_ERROR', 'At most 400 buckets allowed');
  const rows = await tx.$queryRaw(Prisma.sql`${projection(q, at)}
    SELECT date_trunc(${q.bucket},cohort_at AT TIME ZONE ${q.timezone}) AT TIME ZONE ${q.timezone} AS bucket_at,
      ${aggregateColumns()} FROM samples WHERE metric_key=${q.metric_key}
      AND cohort_at>=(SELECT ${q.from}::timestamptz) AND cohort_at<(SELECT ${q.to}::timestamptz) GROUP BY bucket_at ORDER BY bucket_at`);
  const def = policy.definitions.find((d) => d.metric_key === q.metric_key);
  return buckets.map((b) => ({
    start: b.start.toISOString(),
    end: b.end.toISOString(),
    metric: metric(
      def,
      rows.find(
        (r) => (r.bucket_at >= b.start && r.bucket_at < b.end) || (r.bucket_at < b.start && b === buckets[0]),
      ),
    ),
  }));
}
async function drilldown(tx, q, at, user) {
  const after = policy.decode('drilldown', q, user),
    def = policy.definitions.find((d) => d.metric_key === q.metric_key);
  if (
    after &&
    (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(after.at) || !/^[a-f0-9-]{36}$/.test(after.id))
  )
    throw new ApiError(400, 'INVALID_CURSOR', 'Invalid sample cursor');
  if (q.metric_key === 'active_execution_time') return completedAttemptPage(tx, q, at, user, after, def);
  const rows = await tx.$queryRaw(Prisma.sql`${projection(q, at)}, population AS MATERIALIZED (
    SELECT *,count(*) OVER()::int AS total FROM samples WHERE metric_key=${q.metric_key}
      ${def.cohort === 'CURRENT' ? Prisma.empty : Prisma.sql`AND cohort_at>=(SELECT ${q.from}::timestamptz) AND cohort_at<(SELECT ${q.to}::timestamptz)`}
      ${q.population === 'numerator' ? Prisma.sql`AND contribution=1` : Prisma.empty}
  ) SELECT to_jsonb(p) || jsonb_build_object('cohort_at',to_char(cohort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS row
    FROM population p ${after ? Prisma.sql`WHERE (cohort_at,sample_id)<((SELECT ${after.at}::timestamptz),${after.id}::uuid)` : Prisma.empty}
    ORDER BY cohort_at DESC,sample_id DESC LIMIT ${q.limit + 1}`);
  const page = rows.slice(0, q.limit).map((r) => r.row),
    more = rows.length > q.limit;
  // Count remains available even on a valid cursor beyond the last row.
  let total = page[0]?.total;
  if (total === undefined) {
    const count =
      await tx.$queryRaw(Prisma.sql`${projection(q, at)} SELECT count(*)::int AS total FROM samples
      WHERE metric_key=${q.metric_key}
      ${def.cohort === 'CURRENT' ? Prisma.empty : Prisma.sql`AND cohort_at>=(SELECT ${q.from}::timestamptz) AND cohort_at<(SELECT ${q.to}::timestamptz)`}
      ${q.population === 'numerator' ? Prisma.sql`AND contribution=1` : Prisma.empty}`);
    total = count[0].total;
  }
  return {
    items: page.map(({ total, ...r }) => ({ ...r, grain: def.grain })),
    total,
    has_more: more,
    next_cursor: more
      ? policy.encode('drilldown', q, user, { at: page.at(-1).cohort_at, id: page.at(-1).sample_id })
      : null,
  };
}
async function completedAttemptPage(tx, q, at, user, after, def) {
  // Cohort membership depends only on immutable completion + scoped order identity.
  // Derive durations with the same projection, but only for the page's orders.
  const [result] = await tx.$queryRaw(Prisma.sql`WITH cohort AS MATERIALIZED (
    SELECT c.id,c.work_order_id,c.completed_at FROM work_order_completions c
    JOIN work_orders w ON w.id=c.work_order_id AND w.factory_id=c.factory_id
    WHERE w.factory_id=${q.factory_id}
      ${q.machine_id ? Prisma.sql`AND w.machine_id=${q.machine_id}` : Prisma.empty}
      AND c.completed_at>=(SELECT ${q.from}::timestamptz) AND c.completed_at<(SELECT ${q.to}::timestamptz)
  ), page AS (
    SELECT *,to_char(completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM cohort
    ${after ? Prisma.sql`WHERE (completed_at,id)<((SELECT ${after.at}::timestamptz),${after.id}::uuid)` : Prisma.empty}
    ORDER BY completed_at DESC,id DESC LIMIT ${q.limit + 1}
  ) SELECT (SELECT count(*)::int FROM cohort) AS total,
    coalesce(jsonb_agg(to_jsonb(page) ORDER BY completed_at DESC,id DESC),'[]'::jsonb) AS items FROM page`);
  const page = result.items.slice(0, q.limit),
    more = result.items.length > q.limit;
  if (!page.length) return { items: [], total: result.total, has_more: false, next_cursor: null };
  const rows =
    await tx.$queryRaw(Prisma.sql`${projection(q, at, [...new Set(page.map((r) => r.work_order_id))])}
    SELECT to_jsonb(s)||jsonb_build_object('cohort_at',to_char(cohort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS row
    FROM samples s WHERE metric_key=${q.metric_key} AND sample_id IN (${Prisma.join(page.map((r) => Prisma.sql`${r.id}::uuid`))})
    ORDER BY cohort_at DESC,sample_id DESC`);
  return {
    items: rows.map((r) => ({ ...r.row, grain: def.grain })),
    total: result.total,
    has_more: more,
    next_cursor: more
      ? policy.encode('drilldown', q, user, { id: page.at(-1).id, at: page.at(-1).at })
      : null,
  };
}
async function machines(tx, q, at, user) {
  const after = policy.decode('machines', q, user);
  if (after && (typeof after.id !== 'string' || !(after.value === null || Number.isFinite(after.value))))
    throw new ApiError(400, 'INVALID_CURSOR', 'Invalid machine cursor');
  const sortMetric = {
    overdue: 'overdue_orders',
    blocked: 'blocked_orders',
    open: 'open_orders',
    rework_rate: 'rework_decision_rate',
    active_p90: 'active_execution_time',
  }[q.sort];
  const [result] = await tx.$queryRaw(Prisma.sql`${projection(q, at)}, aggregated AS (
    SELECT machine_id,metric_key,${aggregateColumns()} FROM samples
    WHERE metric_key IN ('open_orders','overdue_orders','blocked_orders','waiting_verification_orders')
      OR (cohort_at>=(SELECT ${q.from}::timestamptz) AND cohort_at<(SELECT ${q.to}::timestamptz))
    GROUP BY machine_id,metric_key
  ), current_machines AS (
    SELECT m->>'machine_id' AS machine_id,m->>'display_name' AS name FROM operations_heads h
      JOIN factory_snapshots s ON s.factory_id=h.factory_id AND s.snapshot_id=h.snapshot_id,
      LATERAL jsonb_array_elements(s.payload_json->'machines') m WHERE h.factory_id=${q.factory_id}
  ), identities AS (
    SELECT machine_id FROM orders UNION SELECT machine_id FROM current_machines
  ), machine_rows AS (
    SELECT i.machine_id,c.name,c.machine_id IS NOT NULL AS present_in_current_snapshot,
      coalesce(jsonb_object_agg(a.metric_key,to_jsonb(a)) FILTER(WHERE a.metric_key IS NOT NULL),'{}'::jsonb) AS metrics
    FROM identities i LEFT JOIN current_machines c USING(machine_id) LEFT JOIN aggregated a USING(machine_id)
    ${q.machine_id ? Prisma.sql`WHERE i.machine_id=${q.machine_id}` : Prisma.empty}
    GROUP BY i.machine_id,c.name,c.machine_id
  ), ranked AS (
    SELECT *,count(*) OVER()::int AS total,
      ${
        q.sort === 'rework_rate'
          ? Prisma.sql`(metrics->${sortMetric}->>'numerator')::float8/nullif((metrics->${sortMetric}->>'denominator')::float8,0)`
          : q.sort === 'active_p90'
            ? Prisma.sql`(metrics->${sortMetric}->>'p90')::float8`
            : Prisma.sql`coalesce((metrics->${sortMetric}->>'denominator')::float8,0)`
      } AS sort_value
    FROM machine_rows
  ), paged AS (SELECT * FROM ranked
    ${
      after
        ? Prisma.sql`WHERE (sort_value<${after.value}::float8 OR (sort_value IS NOT DISTINCT FROM ${after.value}::float8 AND machine_id>${after.id})
      OR (${after.value}::float8 IS NOT NULL AND sort_value IS NULL))`
        : Prisma.empty
    }
    ORDER BY sort_value DESC NULLS LAST,machine_id ASC LIMIT ${q.limit + 1})
    SELECT coalesce(jsonb_agg(to_jsonb(paged) ORDER BY sort_value DESC NULLS LAST,machine_id ASC),'[]'::jsonb) AS items,
      (SELECT count(*)::int FROM ranked) AS total FROM paged`);
  const rows = result.items;
  const page = rows.slice(0, q.limit),
    more = rows.length > q.limit;
  return {
    items: page.map((r) => ({
      machine_id: r.machine_id,
      name: r.name,
      present_in_current_snapshot: r.present_in_current_snapshot,
      metrics: Object.fromEntries(
        policy.definitions.map((d) => [d.metric_key, metric(d, r.metrics[d.metric_key])]),
      ),
    })),
    total: result.total,
    has_more: more,
    next_cursor: more
      ? policy.encode('machines', q, user, { id: page.at(-1).machine_id, value: page.at(-1).sort_value })
      : null,
  };
}
async function read(db, user, endpoint, raw) {
  const q = policy.query(endpoint, raw);
  return db.$transaction(
    async (tx) => {
      // Bound transaction-local working memory for event windows/percentiles. The
      // 110k-event EXPLAIN spilled at the 4MB server default; no session/global change.
      await tx.$executeRawUnsafe("SET LOCAL work_mem = '32MB'");
      // These bounded read queries finish before JIT compilation amortizes its
      // cost. Keep this transaction-local; other application queries retain
      // their configured PostgreSQL JIT policy.
      await tx.$executeRawUnsafe('SET LOCAL jit = off');
      user =
        endpoint === 'definitions'
          ? await currentUser(tx, user)
          : await authorizeFactory(tx, user, q.factory_id);
      const [{ at }] =
        await tx.$queryRaw`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`;
      const meta = {
        read_at: at,
        metric_definition_version: policy.version,
        filters:
          endpoint === 'definitions' ? null : { factory_id: q.factory_id, machine_id: q.machine_id ?? null },
        period: endpoint === 'definitions' ? null : { from: q.from, to: q.to },
        timezone: q.timezone ?? 'UTC',
        comparison_period: endpoint === 'definitions' ? null : { from: null, to: null },
      };
      if (endpoint === 'definitions') return { success: true, data: policy.definitions, meta };
      const [bounds] = await tx.$queryRaw`SELECT ${q.from}::timestamptz<${q.to}::timestamptz
      AND ${q.to}::timestamptz<=${at}::timestamptz
      AND ${q.to}::timestamptz-${q.from}::timestamptz<=interval '366 days' AS valid,
      to_char((${q.from}::timestamptz-(${q.to}::timestamptz-${q.from}::timestamptz)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS previous_from,
      to_char(${q.from}::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS period_from,
      to_char(${q.to}::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS period_to`;
      if (!bounds.valid)
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Period must be positive, at most 366 days, and not in the future',
        );
      meta.comparison_period.from = bounds.previous_from;
      meta.comparison_period.to = bounds.period_from;
      meta.period = { from: bounds.period_from, to: bounds.period_to };
      await machineExists(tx, q);
      const handlers = {
        overview: () => overview(tx, q, at, meta),
        trends: () => trends(tx, q, at),
        machines: () => machines(tx, q, at, user),
        drilldown: () => drilldown(tx, q, at, user),
      };
      return { success: true, data: await handlers[endpoint](), meta };
    },
    { isolationLevel: 'RepeatableRead', timeout: 30000 },
  );
}
module.exports = { read, metric, comparison };
