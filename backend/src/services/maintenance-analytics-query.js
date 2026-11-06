const { Prisma } = require('@prisma/client');

// One relational sample projection is shared by aggregates, machine groups and drilldown.
// No report text, verification notes or whole payloads leave this projection.
function projection(q, at, orderIds) {
  return Prisma.sql`
  WITH orders AS MATERIALIZED (
    SELECT id,factory_id,machine_id,status,attempt,revision,updated_at,planned_end_at,blocker,
      basis_snapshot_id,source_case_id,schedule_id,schedule_revision,assignment_id,published_plan_version
    FROM work_orders WHERE factory_id=${q.factory_id}
    ${q.machine_id ? Prisma.sql`AND machine_id=${q.machine_id}` : Prisma.empty}
    ${orderIds ? Prisma.sql`AND id IN (${Prisma.join(orderIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty}
  ), completions AS MATERIALIZED (
    SELECT c.id,c.work_order_id,c.attempt,c.completed_at,c.report_json->>'outcome' AS outcome
    FROM work_order_completions c JOIN orders w ON w.id=c.work_order_id
  ), events AS MATERIALIZED (
    SELECT e.id,e.work_order_id,e.sequence,e.command,e.occurred_at,
      e.payload_json->>'to_status' AS to_status,e.payload_json->'verification'->>'result' AS verification_result,
      CASE WHEN e.payload_json->>'attempt' ~ '^[1-9][0-9]{0,8}$'
      THEN (e.payload_json->>'attempt')::int END AS attempt
    FROM work_order_events e JOIN orders w ON w.id=e.work_order_id
  ), adjacent_events AS (
    SELECT e.*,
      lead(occurred_at) OVER next_event AS following_at,
      lead(sequence) OVER next_event AS following_sequence,
      lead(attempt) OVER next_event AS following_attempt
    FROM events e WINDOW next_event AS (PARTITION BY work_order_id ORDER BY sequence)
  ), intervals AS MATERIALIZED (
    SELECT work_order_id,sequence,command,occurred_at,attempt,to_status,
      CASE WHEN following_sequence=sequence+1 THEN following_at END AS next_at,
      CASE WHEN following_sequence=sequence+1 THEN following_sequence END AS next_sequence,
      CASE WHEN following_sequence=sequence+1 THEN following_attempt END AS next_attempt
    FROM adjacent_events
  ), history AS MATERIALIZED (
    SELECT work_order_id, min(occurred_at) FILTER (WHERE command='CREATE') AS created_at,
      count(*) FILTER (WHERE command='CREATE') AS creates,
      bool_and(sequence=1 OR sequence>0) AND min(sequence)=1 AND max(sequence)=count(*)
        AND bool_and(next_at IS NULL OR next_at>=occurred_at) AND bool_and(attempt IS NOT NULL) AS valid
    FROM intervals GROUP BY work_order_id
  ), accepts AS (
    SELECT DISTINCT ON (work_order_id) * FROM events WHERE command='ACCEPT' ORDER BY work_order_id,sequence
  ), execution AS MATERIALIZED (
    SELECT work_order_id,attempt,
      sum(extract(epoch FROM next_at-occurred_at)) FILTER (WHERE to_status='IN_PROGRESS') AS seconds,
      bool_and(CASE WHEN to_status='IN_PROGRESS'
        THEN next_at IS NOT NULL AND next_at>=occurred_at AND next_sequence=sequence+1
          AND next_attempt=attempt ELSE true END) AS valid,
      count(*) FILTER (WHERE command='COMPLETE') AS completes,
      max(occurred_at) FILTER (WHERE command='COMPLETE') AS completed_at
    FROM intervals GROUP BY work_order_id,attempt
  ), contributions AS (
    SELECT w.id AS work_order_id,w.id AS sample_id,CASE WHEN metric.key='blocked_orders' THEN latest.id END AS event_id,NULL::uuid AS completion_id,
      w.updated_at AS cohort_at,w.attempt,CASE WHEN metric.key='blocked_orders' THEN latest.command END AS command,
      metric.key COLLATE "C" AS metric_key,1::double precision AS contribution,NULL::double precision AS duration_seconds,
      CASE WHEN latest.id IS NULL THEN 'MISSING_HISTORY' END AS exclusion_reason,NULL::text AS verification_result,
      CASE WHEN metric.key='blocked_orders' THEN w.blocker END AS reason
    FROM orders w LEFT JOIN events latest ON latest.work_order_id=w.id AND latest.sequence=w.revision
    CROSS JOIN LATERAL (VALUES
      ('open_orders',w.status NOT IN ('CLOSED','CANCELLED')),
      ('overdue_orders',w.status NOT IN ('CLOSED','CANCELLED') AND w.planned_end_at<(SELECT ${at}::timestamptz)),
      ('blocked_orders',w.status='BLOCKED'),('waiting_verification_orders',w.status='COMPLETED')
    ) metric(key,included) WHERE metric.included AND w.status NOT IN ('CLOSED','CANCELLED')
    UNION ALL
    SELECT e.work_order_id,e.id,e.id,c.id,e.occurred_at,e.attempt,e.command,
      metric.key,CASE WHEN metric.key='first_pass_verified_rate' THEN
        CASE WHEN e.attempt=1 AND c.outcome='SUCCESS' AND e.verification_result='VERIFIED' THEN 1 ELSE 0 END
        WHEN metric.key='rework_decision_rate' AND e.command='CLOSE' THEN 0 ELSE 1 END::double precision,NULL::double precision,
      CASE WHEN e.command='CLOSE' AND c.id IS NULL THEN 'MISSING_HISTORY' END,
      e.verification_result,NULL::text
    FROM events e LEFT JOIN completions c ON c.work_order_id=e.work_order_id AND c.attempt=e.attempt
    CROSS JOIN LATERAL unnest(array_remove(ARRAY[
      CASE WHEN e.command='CREATE' THEN 'created_orders' END,
      CASE WHEN e.command='CLOSE' THEN 'closed_orders' END,
      CASE WHEN e.command='CANCEL' THEN 'cancelled_orders' END,
      CASE WHEN e.command='CLOSE' AND c.outcome='SUCCESS' AND e.verification_result='VERIFIED' THEN 'successful_verified_orders' END,
      CASE WHEN e.command='CLOSE' THEN 'first_pass_verified_rate' END,
      CASE WHEN e.command IN ('CLOSE','REQUEST_REWORK','REASSIGN_FOR_REWORK') THEN 'rework_decision_rate' END
    ],NULL)) metric(key)
    WHERE e.command IN ('CREATE','CLOSE','CANCEL','REQUEST_REWORK','REASSIGN_FOR_REWORK')
    UNION ALL
    SELECT a.work_order_id,a.id,a.id,NULL::uuid,a.occurred_at,a.attempt,a.command,
      'time_to_first_accept',1::double precision,extract(epoch FROM a.occurred_at-h.created_at)::double precision,
      CASE WHEN h.created_at IS NULL THEN 'MISSING_HISTORY'
        WHEN h.creates<>1 OR NOT h.valid OR a.occurred_at<h.created_at THEN 'INCONSISTENT_HISTORY' END,NULL::text,NULL::text
    FROM accepts a JOIN history h USING(work_order_id)
    UNION ALL
    SELECT c.work_order_id,c.id,NULL::uuid,c.id,c.completed_at,c.attempt,'COMPLETE',
      'active_execution_time',1::double precision,x.seconds::double precision,
      CASE WHEN x.work_order_id IS NULL OR h.work_order_id IS NULL OR x.seconds IS NULL OR x.completes=0 THEN 'MISSING_HISTORY'
        WHEN NOT x.valid OR NOT h.valid OR h.creates<>1 OR x.completes<>1 OR x.completed_at<>c.completed_at
          THEN 'INCONSISTENT_HISTORY' END,NULL::text,NULL::text
    FROM completions c
      LEFT JOIN execution x ON x.work_order_id=c.work_order_id AND x.attempt=c.attempt
      LEFT JOIN history h ON h.work_order_id=c.work_order_id
    UNION ALL
    SELECT e.work_order_id,e.id,e.id,c.id,e.occurred_at,p.attempt,e.command,
      'verification_wait_time',1::double precision,extract(epoch FROM e.occurred_at-p.occurred_at)::double precision,
      CASE WHEN p.id IS NULL OR c.id IS NULL THEN 'MISSING_HISTORY'
        WHEN NOT h.valid OR h.creates<>1 OR p.occurred_at<>c.completed_at OR e.occurred_at<p.occurred_at
          OR p.sequence<>e.sequence-1 THEN 'INCONSISTENT_HISTORY' END,NULL::text,NULL::text
    FROM events e LEFT JOIN events p ON p.work_order_id=e.work_order_id AND p.sequence=e.sequence-1 AND p.command='COMPLETE'
      LEFT JOIN completions c ON c.work_order_id=e.work_order_id AND c.attempt=p.attempt
      JOIN history h ON h.work_order_id=e.work_order_id
    WHERE e.command IN ('CLOSE','REQUEST_REWORK','REASSIGN_FOR_REWORK')
  ), samples AS (
    SELECT c.*,w.factory_id,w.machine_id,w.status,w.basis_snapshot_id,w.source_case_id,
      w.schedule_id,w.schedule_revision,w.assignment_id,w.published_plan_version
    FROM contributions c JOIN orders w ON w.id=c.work_order_id
  )`;
}
function aggregateColumns() {
  return Prisma.sql`count(*)::int AS denominator,coalesce(sum(contribution),0)::double precision AS numerator,
    count(*) FILTER (WHERE exclusion_reason IS NULL)::int AS sample_count,
    count(*) FILTER (WHERE exclusion_reason IS NOT NULL)::int AS excluded_count,
    count(*) FILTER (WHERE exclusion_reason='MISSING_HISTORY')::int AS missing_history,
    count(*) FILTER (WHERE exclusion_reason='INCONSISTENT_HISTORY')::int AS inconsistent_history,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_seconds) FILTER (WHERE exclusion_reason IS NULL) AS median,
    percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_seconds) FILTER (WHERE exclusion_reason IS NULL) AS p90,
    count(*) FILTER (WHERE verification_result='VERIFIED')::int AS verified,
    count(*) FILTER (WHERE verification_result='VERIFIED_STOPPED')::int AS verified_stopped`;
}
module.exports = { projection, aggregateColumns };
