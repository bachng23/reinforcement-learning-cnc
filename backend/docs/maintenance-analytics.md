# Maintenance Analytics v1

Base: `ff9a3aeec7d6f3b19e655a326cea214a968764c0` (main, includes #50/#51).
Branch: `feat/maintenance-analytics`. Independent of the outstanding Incident–Work
Order joint acceptance. No incident counters, lifecycle changes, automatic merge or deployment.

## Observation and cohorts

All data endpoints use one RepeatableRead transaction, fresh database user/factory
authorization and one PostgreSQL observation timestamp. GET never changes workflow
state, receipts, publications or audit. `read_at` is observation time, not telemetry
freshness. Current counters ignore the requested period, overlap, and must not be summed.
Period cohorts use `[from,to)`. The comparison is exactly `[from-(to-from),from)` in UTC.
There is no comparison for current backlog and no persisted snapshot across requests.

Dictionary version: `maintenance-analytics.v1`. Rates are fractions in [0,1]; rate
comparison uses percentage points. Counts and duration comparisons include absolute
delta and percent change only for positive baselines. Empty rates/durations are null,
with NO_DATA availability; empty counts are zero. Durations use PostgreSQL
`percentile_cont(0.5/0.9)`, seconds without intermediate rounding, and report valid
sample count and excluded count/reasons. Execution duration is workflow time, never
labor, machine-running time, downtime or MTTR.

| Key | Grain | Cohort / contribution |
| --- | --- | --- |
| open_orders | ORDER | Current status outside CLOSED/CANCELLED, including COMPLETED |
| overdue_orders | ORDER | Open and planned_end_at strictly before read_at |
| blocked_orders | ORDER | Current BLOCKED, including MANAGER_HOLD |
| waiting_verification_orders | ORDER | Current COMPLETED |
| created_orders | ORDER | CREATE event in period, distinct order |
| closed_orders | ORDER | CLOSE in period, including VERIFIED_STOPPED; verification breakdown |
| cancelled_orders | ORDER | CANCEL in period, distinct order |
| successful_verified_orders | ORDER | CLOSE in period, completed attempt SUCCESS and verification VERIFIED |
| rework_decision_rate | DECISION | Rework decisions / (CLOSE + REQUEST_REWORK + REASSIGN_FOR_REWORK) in period |
| first_pass_verified_rate | ORDER | Successful verified CLOSE at attempt 1 / CLOSE cohort |
| time_to_first_accept | ORDER | First ACCEPT in period minus CREATE timestamp |
| active_execution_time | ATTEMPT | COMPLETE in period; sum IN_PROGRESS intervals for completed attempt |
| verification_wait_time | DECISION | Verification/rework decision in period minus preceding COMPLETE |

Event sequence, to_status and attempt define intervals. REQUEST_REWORK opens the new
attempt IN_PROGRESS; REASSIGN_FOR_REWORK opens ASSIGNED. START after reassignment
does not reset the original actual_started_at, which is not used for these calculations.
Incomplete attempts are outside the duration cohort. Missing/inconsistent histories
are excluded with explicit reason; never silently replaced with zero or repaired.

## HTTP contract

Prefix `/api/v1/maintenance-analytics`; authenticated active VIEWER and higher can
read scoped factories. `/definitions` accepts no query and needs no factory access.
Other endpoints require factory_id/from/to, optional machine_id and timezone (UTC).
RFC3339 offsets are required; from < to <= read_at; window <=366 days. Unknown,
repeated or wrongly typed query parameters fail 400. There is no status filter.

| GET | Additional query | Result |
| --- | --- | --- |
| /overview | None | Current counters, current/previous period metrics and coverage |
| /trends | metric_key; bucket=day/week/month | <=400 clipped half-open buckets with UTC bounds |
| /machines | sort=overdue/open/blocked/rework_rate/active_p90; limit; cursor | Descending metric, machine_id ascending tie-break; nulls last |
| /drilldown | metric_key; population=numerator/denominator for rates; limit; cursor | Cohort rows and total at ORDER/ATTEMPT/DECISION grain |
| /definitions | None | Versioned dictionary and formulas |

Page default25/max100. Signed opaque keyset cursors bind actor, authorization source,
factory, machine, period, timezone, sort/metric/population and definition version.
Drilldown sorts cohort timestamp descending, sample UUID descending, preserves six
fractional digits and uses event/completion identity for repeat contributions. Cursor
is not a frozen report: workflow writes between requests can change totals/pages.

Trends use local calendar boundaries in the supplied IANA timezone; weeks begin
Monday. First/last buckets are clipped to the requested UTC window; DST days may
have 23/25 hours. Current snapshot counters are unavailable as historical trends.

Machine population is current snapshot machines UNION historical work-order machines.
Current name is display-only. Historical-only machines have present_in_current_snapshot=false;
existing machines without orders return valid empty metrics. Unknown machine gives
scoped 404. Factory totals aggregate original samples, never machine-page summaries.

Rows expose work_order_id, factory_id, machine_id, basis_snapshot_id, source case,
schedule/assignment identities, sample/event/completion IDs, cohort timestamp,
attempt, contribution and duration/exclusion. Blocked rows expose blocking command
and reason only; reports, verification notes and unrelated event payload are excluded.

Product envelopes: success/data/meta; failure success=false/error{code,message}/requestId.
X-Request-Id correlation and Cache-Control:no-store on success/errors. Errors: 400
VALIDATION_ERROR or INVALID_CURSOR; 401 UNAUTHORIZED; 404 FACTORY_NOT_FOUND or
MAINTENANCE_ANALYTICS_MACHINE_NOT_FOUND; 503 DB_UNAVAILABLE; inconsistent unrecoverable
source data 500 MAINTENANCE_ANALYTICS_INTEGRITY_ERROR. Partial duration coverage is
distinct from valid empty data and unavailable service.

## Verification and rollout

No schema change is presumed necessary. Add indexes only after EXPLAIN ANALYZE on
10,000 orders/100,000 events plus an isolation factory. Benchmark sequentially with
5 warmups/20 measured requests: overview/trends/machines p95 <=1s, drilldown <=500ms.
Record hardware, PostgreSQL version, filters, all timings and plans. No authorization cache.
Fresh and exact-base populated upgrades must preserve all workflow/source hashes.
Rollback disables analytics routes, retains immutable history and any additive indexes.

Golden expectations are handwritten independently of query code; authenticated HTTP
tests reconcile aggregate/drilldown populations and exercise DST, microseconds,
multiattempt execution, partial coverage, authorization and read-only behavior.
