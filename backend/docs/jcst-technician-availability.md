# Technician availability — backend M0 proposal / M1

Integration base: `72af5ecda40833e3c9aaa68f6977f08937fa5814` (main fetched
2026-11-19). Branch: `feat/jcst-technician-availability`. Partner acceptance of
this protocol and real runtime acceptance are M2 dependencies, not implied here.

## Public contract

Under `/api/v1/research/demo/sessions/{id}`:

* GET `/technicians`: owner-scoped active-user read (ADMIN sees all). Strict empty
  query. Returns sessionId, revision, tick, stepSeconds, lane=primary,
  technicians[], comparisonContext. Does not advance/infer/write.
* POST `/technicians/{technicianIndex}/absence`: ADMIN/ENGINEER; strict body
  `{revision,durationTicks,reason}`. Duration integer 1..100000; index is a decimal
  0-based integer validated against both job arrays and every config duration row.
* POST `/technicians/{technicianIndex}/return`: same scope/role; strict body
  `{revision,reason}`. Both writes require Idempotency-Key and reject queries.

Write response: `{success:true,data:{session,technicians,sessionId,revision,tick,
stepSeconds,comparisonContext}}`. Full session also exposes the technician summary
and comparisonContext. Retain existing snake_case step_seconds for compatibility.
New endpoints and errors are Cache-Control:no-store. Reason is trimmed, nonblank,
maximum 1000 characters. Actor/event IDs come from the server. Physical tick is
unchanged, revision increments once. COMPLETE is 409. Finite sessions reject
availability writes with 409 DEMO_INTERVENTION_REPLAY_UNSUPPORTED. Invalid index is scoped 404
TECHNICIAN_NOT_FOUND, malformed input is 400 VALIDATION_ERROR. Business conflicts:
409 TECHNICIAN_BUSY, TECHNICIAN_ALREADY_ABSENT, TECHNICIAN_NOT_ABSENT,
TECHNICIAN_AVAILABILITY_LIMIT, DEMO_COMPLETE, DEMO_STALE, DEMO_KEY_CONFLICT.
Other errors retain existing 401/403/404/502/503/504 research conventions.

Primary must be idle to start absence. Availability precedence is BUSY (actual
engine job), ABSENT (active interval), AVAILABLE. At returnTick the technician is
available for new assignments; WAIT is always legal. Baseline may finish an
already active job during the shared absence, but cannot start another assignment
until the interval ends. A busy primary start is rejected before bridge execution.
Changing availability at REVIEW clears pending, cancels workforce-dependent
deferral, sets RUNNING and playbackPaused=true. Old proposal/revision cannot dispatch.

## Persistence, provenance and concurrency

No migration: store typed engineering metadata in `payloadJson.technicianAvailability`:
schemaVersion=`jcst-technician-availability/1`, version, absences[], events[], origin.
An absence retains immutable startTick/absolute returnTick and the start eventId;
automaticEndEventId is preallocated by the server. endedTick/endedByEventId record
the single close. Early return does not rewrite the original planned returnTick.
Events have eventId, technicianIndex, type, tick, actor `{type:USER|SYSTEM,userId}`,
reason. Automatic end uses SYSTEM/null and reason `Absence interval elapsed`.
Audit supplies server recording time separately from physical event tick.

Intervals are [startTick, returnTick), shortened by endedTick after early return.
At most one active interval per technician; at most 1024 retained intervals per
session. Legacy missing metadata means no absences; real jobs still determine BUSY.
Malformed metadata fails closed. No mutation/reordering of config/duration/jobs,
component ages, records, physical counters or lane assignments by these writes.

Reuse simulator receipts, actor-row lock → actor/key advisory lock → session-row
lock. Scope/active/global role are rechecked before replay and final persistence.
Bridge runs outside transaction; final transaction rechecks revision and busy/
absence guard. Payload, audit and exact response receipt commit atomically. Retry
with the same key returns the original response even after later commands; a
different request on the same key conflicts. Automatic end audit is separate from
user-start/early-return audit, and emitted exactly once from newly appended events.

Snapshot save copies metadata and absolute ticks without a schema migration.
Restore and every command/incident carrying metadata require the availability-
aware bridge, including when all previous absences have ended. Never silently
pass these sessions into the old runtime. Reopen preserves IDs/history/version,
changes session ID, and remains paused. Snapshot hashes include the metadata.

Comparison identity includes session ID, revision, tick, source/checkpoint policy
identity, branch and workforce version/hash. User changes establish a new origin
event/tick/version. Automatic expiry is already in the calendar; version does not
increment on automatic expiry, but tick/revision/cache identity do. Expose origin
and `requiresCommonSnapshot=true` after a workforce change: a fresh policy
comparison must fork every policy from the same frozen physical state/calendar.
Do not relabel the two existing, potentially different job states as identical.
The base has no backend live-comparison.js/cache. Frontend currently computes
comparison in comparison-view.tsx; its integration must honor this origin and
common-snapshot requirement. No frontend changes in this backend task.

## Flex protocol proposal (must be jointly accepted)

Protocol `jcst-technicians/1`:

* `demo_technician_change`: input original `session`, complete planned `metadata`;
  output `{protocol,session}`. Validate schedule; retain both lane physical states,
  clear pending/deferrals, return RUNNING/paused and supplied metadata exactly.
* `demo_technician_command`: input `session,command,actor`; output
  `{protocol,session}`. Execute existing commands while enforcing shared calendar
  in policy observation AND the legal catalogue AND final dispatch validation.
  Process every internal autoplay/advance/approve/override boundary, expire at
  returnTick before assignment, preserve baseline active jobs, append preallocated
  automatic end events once, never change calendar version on expiry. Invalidate
  a pending proposal when a boundary changes availability. Replay/audit must
  include interventions rather than claiming unchanged scientific physics replay.
* `demo_technician_restore`: input full snapshot wrapper; output
  `{protocol,session}` with byte-equivalent JSON values of frozen runtime after
  validating pinned engine/config/releases/calendar. No rebase or tick reset.
* `demo_technician_incident`: availability-aware version of the existing incident
  operation, output `{protocol,session,event}`; no calendar change at zero time.

Structured errors: `{protocol,error:{code}}` for the documented business conflicts
or DEMO_RELEASE_UNAVAILABLE / DEMO_SNAPSHOT_INCOMPATIBLE /
DEMO_INTERVENTION_REPLAY_UNSUPPORTED. Unsupported/unavailable bridge maps to
503 TECHNICIAN_RUNTIME_UNAVAILABLE; malformed output is 502
TECHNICIAN_RUNTIME_INVALID_OUTPUT. Never fall back to the old engine.

The availability-aware runtime entered main in PR #72. Backend contract tests use
an explicit bridge double. The real-service acceptance harness exercises the
calendar, dispatch, restoration and review flow across PostgreSQL, Express, the
Python runtime and Chromium. See the [runtime runbook](../../docs/research/technician-availability-runbook.md).

## Run / handoff

OpenAPI: `jcst-technicians.openapi.yaml`; DTO: `contracts/jcst-technicians.d.ts`;
fixtures: `jcst-technicians-examples.json` (AVAILABLE/BUSY/ABSENT).

```sh
BASE=http://localhost:5000/api/v1/research/demo/sessions
curl "$BASE/$SESSION_ID/technicians" -H "Authorization: Bearer $TOKEN"
curl "$BASE/$SESSION_ID/technicians/1/absence" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: technician-absence-001' \
  -d '{"revision":0,"durationTicks":3,"reason":"Short break"}'
curl "$BASE/$SESSION_ID/technicians/1/return" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: technician-return-001' \
  -d '{"revision":1,"reason":"Returned early"}'
```

Run `npm test -- --runInBand` and
`node tests/helpers/run-situations-local.js --technicians` (private PostgreSQL18
loopback cluster, owned schema cleanup; no dev DB). Runtime-dependent calls return
503 until Flex installs the protocol. Rollback must quiesce availability-bearing
sessions before deploying old code; keep payloads/snapshots/receipts/audit. Never
remove calendar metadata merely to make an older runtime accept the session.
