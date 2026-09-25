# Decision case creation, polling and planning worker

Creation persists a case at `CREATED`, revision 1. A dedicated worker, separate from the episode worker, claims the case and can persist one immutable canonical RecommendationPackage. Human decision and schedule commit endpoints remain out of scope.

Subsequent internal processing is described in [leased recommendation persistence](decision-recommendation-persistence.md). Creation still stops at CREATED; leased services can now advance an existing case and attach its recommendation. The status DTO shape is unchanged.

## Create

`POST /api/v1/decision-cases` requires authentication, OPERATOR/ENGINEER/ADMIN, factory access and an `Idempotency-Key` (1–128 visible ASCII characters). ADMIN follows the existing Operations access policy; other roles require an explicit factory grant. Body:

```json
{
  "factory_id": "factory-demo-01",
  "schema_version": "3.0",
  "expected_snapshot_id": "snapshot-demo-20260922-0800",
  "expected_plan_version": 1,
  "request": {
    "mode": "LIVE",
    "trigger": { "type": "MANUAL_REPLAN", "reason": "Review production schedule" },
    "planning_config": { "horizon_minutes": 720 }
  }
}
```

All HTTP objects are strict. Trigger variants and planning configuration use the canonical v3 validator, except server-owned trigger event ID, timestamp and requesting actor are excluded from the input. Machine/technician/maintenance trigger references must exist in the pinned snapshot. WHAT_IF requires SIMULATION_ONLY. Free-form WHAT_IF assumptions remain canonical JSON, never event output. The normalized HTTP request (including default planning values), SHA-256, actor UUID, factory/snapshot and base plan version are stored immutably. The worker builds RunDecisionCaseRequest only from those fields and the pinned snapshot, adding the stored case UUID, creation timestamp and actor. The HTTP creation handler does not invoke planning.

Creation returns 202 and `Location: /api/v1/decision-cases/{uuid}`. `data` is exactly generated `DecisionCaseStatusResponse`; `meta` contains factory, base plan version, case revision, current context and staleness. Recommendation, committed schedule and error IDs are null.

## Idempotency and transaction boundary

Keys are scoped to `(factory_id, actor_id, key)` for this creation endpoint, with no expiry. Identical normalized requests return the persisted original response, 202, original Location and `Idempotency-Replayed: true`. Reusing a key with different content returns `409 IDEMPOTENCY_KEY_REUSED`. Current permissions are checked even on replay. Replay precedes head fencing so a successful command remains replayable after observations/plans advance.

After validation, one transaction obtains `pg_advisory_xact_lock(hashtextextended(factory_id, 0))`, the same factory lock used by seed and ingestion. It checks the receipt, loads OperationsHead and fences snapshot and plan version, then inserts case, CASE_CREATED sequence 1, and receipt. No intermediate rows commit if either event or receipt insertion fails. Competing duplicate requests serialize and the unique receipt key provides an additional database constraint. Head writers must follow the shared lock protocol. Snapshot mismatch returns `409 SNAPSHOT_CONFLICT`; plan mismatch returns `409 PLAN_VERSION_CONFLICT`.

## Read and events

`GET /api/v1/decision-cases/{uuid}` permits all authenticated roles with factory access. Missing, malformed or inaccessible IDs return the same 404 code/message. Case and head are read in a repeatable-read transaction; status snapshot_id always denotes the historical basis, while meta.current_context denotes the head. Nothing is populated from demo fixtures.

`GET /api/v1/decision-cases/{uuid}/recommendation` returns the stored package only after rechecking its SHA-256 and contract v3. Before persistence it returns `409 RECOMMENDATION_NOT_READY`. Status metadata exposes `QUEUED`, `RUNNING`, `BLOCKED` or `IDLE` processing separately from the canonical case lifecycle.

`GET /api/v1/decision-cases/{uuid}/events?after_sequence=0&limit=100` returns `{success,data:[events],meta:{has_more,next_after_sequence}}`. Cursors are nonnegative decimal integers bounded to PostgreSQL INTEGER; limit is 1–200. Queries reject unknown, repeated or malformed parameters. Rows are sorted ascending and fetched with limit + 1. Empty pages retain the input cursor. Each event exposes UUID, case UUID, sequence, type, actor UUID, server timestamp and an allowlisted payload. Arbitrary stored JSON, request text, credentials, stack traces and reasoning are never serialized. The backend CASE_CREATED event DTO is distinct from the generated AI DecisionEvent enum, which has no CASE_CREATED variant; no AI contract is changed.

## Migration and verification

Append-only migration `20260924000000_decision_case_creation` adds the initial tables. Migration `20260925000000_decision_case_worker` extends lifecycle/lease fields and adds the immutable recommendation table without editing history. UUID keys, lease fencing, per-case sequence uniqueness and the composite factory/snapshot foreign key protect persistence. Existing snapshots, schedules and OperationsHead are unchanged.

The worker polls queued `CREATED`/`ANALYZING` cases and reclaims expired `RUNNING` leases with `FOR UPDATE SKIP LOCKED`. Only the lifecycle service performs database transitions. The planning client forwards the lease request ID and case correlation ID, performs its bounded retry, and validates both directions. Success transitions to `AWAITING_APPROVAL`; timeout, no-feasible-plan and invalid/unavailable AI responses retain `ANALYZING` with processing `BLOCKED` and a safe error. Graceful shutdown aborts planning and returns the case to `QUEUED`; a crash is recovered after lease expiry.

Tests cover HTTP role/factory access, strict validation, generated status, concurrency, stale head fencing, replay, event/receipt rollback, immutable rows, event pagination and sanitization, and OpenAPI. The historical upgrade test deploys pinned main migrations with existing S1/P1, upgrades, ingests S2 and creates a case against that head.

Local evidence (2026-09-24): backend unit tests 218 passed / 4 skipped; PostgreSQL integration 45 passed across 7 suites, including the populated historical upgrade and 14 new decision-case tests. All 7 business migrations deployed in an isolated schema which was dropped afterward. `git diff --check` passed. The full `bash scripts/check-operations-integration.sh` command was attempted with explicit test database and main SHA but stopped at `Missing required tool: node` in WSL. Windows Node is 22.13.0, below the gate requirement of Node 22.22.2+; the full gate still needs CI or a configured Linux environment. Frontend and AI source files are unchanged.
