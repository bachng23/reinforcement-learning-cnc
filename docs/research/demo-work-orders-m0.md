# Simulator work orders — M0 proposal

Status: storage and legacy policy APPROVED by user on 2026-11-08.
Backend 1 identity aligned with eff27fef2fec4c770c4a252b9c3dc0200d819466;
direct projector parity passed. Frontend consumer validation remains pending.
Base: main `ddf7a05` (updated 2026-11-09). Branch: `backend/jcst-maintenance-work-orders`.

## Storage and atomicity

Use an additive `DemoSession.workOrdersJson` JSONB column (nullable for legacy
sessions), separate from the Python payload. This is a durable primary-lane
projection, not an Operations work order. Store version, processedThroughTick,
coverage, unresolved component failures, and orders keyed by startEventId.
Update it in the existing revision-checked transaction together with payloadJson
and audit. Initialize an empty complete projection on session creation.
No Python physics or scientific schema changes are needed.

For a command, consume records with record.tick >= processedThroughTick, in
trace order, including every interval returned by autoplay. Advance the cursor
only across contiguous records. The current maximum command span is eight
intervals and trace retains 256; a missing interval must fail the command rather
than silently publish incomplete new history. Existing completed orders survive
trace eviction. Latest-key replay returns before projection; stale revision or
transaction failure writes neither session, orders nor audit.

## Shared event identity — aligned with Backend 1

Use `je1_` + unpadded base64url of UTF-8 compact JSON
`[sessionId,"primary",recordTick,eventOrdinal]`, matching Backend 1 eff27fe. Ordinal is the
zero-based position in the ORIGINAL record.events array, including occupancy.
Use recordTick, not event.tick: a completion/failure belongs to the end boundary
of its interval. IDs do not depend on revision, array position in the rolling
records window, command key, or JSON serialization. Work order ID is
`wo:{startEventId}`. The initial colon-delimited proposal was replaced before
deployment. Backend 1 defines the shared format on its machine-health branch;
golden fixture vectors and direct cross-projector checks match this format.

## Read contract

`GET /api/v1/research/demo/sessions/:id/work-orders?machineIndex=2&limit=20`

Use existing session visibility (owner or ADMIN); no mutation, including legacy
reads. Strict query: optional nonnegative machineIndex within session config;
limit integer 1..100, default 20. Return the standard `{success:true,data}` envelope.
Newest first by startedTick DESC, startEventId DESC. Return `total` before limit
and `items`; filtering does not change historyCoverage.

Snapshot fields: contractVersion `jcst-work-orders/v1`, sessionId, revision, tick,
stepSeconds (session step_seconds, legacy fallback 900), lane `primary`, source
`JCST_SIMULATION`, historyCoverage `COMPLETE | PARTIAL`, total, items.

Each item: workOrderId, machineIndex, componentIndex, technicianIndex, kind
`PM | CM`, status `IN_PROGRESS | COMPLETED`, startedTick, completedTick,
plannedDurationTicks, remainingTicks, waitTicks, startEventId, completionEventId,
failureEventId, decisionTick, assignmentSource
`AUTOMATIC | MANUAL_APPROVAL | OVERRIDE | UNKNOWN`.
Unknown optional evidence/time values are null; zero is valid. Indexes are
zero-based; display labels add one. COMPLETED is execution evidence only, not a
claim that the machine is healthy or production-ready.

## Projection semantics

- Only a primary start creates an order. Review, WAIT/defer and baseline never do.
- Completion matches the open machine/component/technician/kind tuple and sets
  completedTick and remainingTicks=0. Process start and completion in event order
  even when both occur in one command or interval.
- For open work, use matching snapshot jobs.remaining; never infer it from a
  nominal clock or elapsed wall time. Missing legacy snapshot evidence => null.
- Retain each unresolved failure by machine/component until consumed by CM
  start; waitTicks=start.tick-failure.tick. PM waitTicks=null. Never reuse a
  previously consumed failure for a later repair.
- Link a recorded decision only when tick and assignment match its action.
  Explicit command approve/override provenance distinguishes user intent;
  automatic commands are AUTOMATIC. Legacy decisions with actor automatic are
  AUTOMATIC; override=true is OVERRIDE; matching human decisions are
  MANUAL_APPROVAL. No linked decision/command evidence => UNKNOWN.
- A single decision can link many starts. decisionTick is null when no recorded
  decision exists, even if command provenance establishes automatic execution.

## Legacy policy

When projection is null, derive a transient projection from retained primary
trace. COMPLETE only when contiguous trace covers tick 0 through snapshot.tick;
otherwise PARTIAL. Never invent a start for an orphan completion or active job.
Never infer missing failure time from failed=true. First successful mutation
persists the available projection and its coverage; GET never backfills.

## Delivery gates

M0: agree storage, shared event IDs and DTO; real-engine fixtures for pre-approval,
tick 6 in progress and tick 7 completed. Fixtures are not API/PostgreSQL evidence.
M1: projector, migration, OpenAPI, read route, unit and isolated PostgreSQL tests
(retry, stale, rollback, permissions, autoplay, legacy, GET purity).
M2: consumer validation with Frontend and Backend 1 event-ID parity. Real joint
case uses base/990000001/policy/corrective/wait/continuous; no learned checkpoint
is required for these built-in policies. Do not mark missing gates as passed.
