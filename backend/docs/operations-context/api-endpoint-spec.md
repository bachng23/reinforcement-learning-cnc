# Operations Context — API endpoint spec draft v1

Status: DESIGN DRAFT, 2026-09-21; not registered in the running API or existing openapi.yaml. The incoming Operations Context field contract is not present in this checkout. Payload shapes below are proposed wire DTOs, not a generated canonical contract.

Related: [Prisma design note](prisma-design-note.md), [state transitions](state-machine.md).

## Endpoint list (fixed for this draft)

Prefix: `/api/v1`. All six routes require existing cookie or Bearer authentication. JSON uses snake_case for the new domain; do not silently change legacy camelCase APIs.

| Method | Relative path | Purpose | Successful response |
| --- | --- | --- | --- |
| GET | /operations/snapshot | Read current immutable factory snapshot and concurrency tokens | 200 |
| POST | /decision-cases | Create a case pinned to current context; queue processing | 202 + Location |
| GET | /decision-cases/:id | Read lifecycle, candidate, evidence summaries and processing status | 200 |
| GET | /decision-cases/:id/events | Poll durable ordered lifecycle/audit events | 200 |
| POST | /decision-cases/:id/decision | APPROVE, MODIFY, REJECT or COMMIT command | 200; MODIFY 202 |
| GET | /schedules/current | Read authoritative published schedule and head tokens | 200, including null schedule before first commit |

No extra `/approve` or `/commit` route: COMMIT is an explicit command on the decision endpoint. No PATCH case/status, external tool execution or machine-control endpoint is included. Snapshot ingestion is an internal adapter workflow, outside these six routes, and must obey the OperationsHead concurrency protocol.

## Common contract

- UUID for database resource IDs; opaque string for factory_id and source IDs pending canonical contract. Timestamps are server UTC RFC3339. Do not convert research steps into wall-clock scheduling units without a contract.
- Read scope: explicit `factory_id` query for snapshot/current schedule; case scope is resolved from persisted case. Unknown query/body fields rejected. An unauthenticated request gets 401; VIEWER mutation gets 403; inaccessible factory/case behaves as 404 to avoid disclosure.
- VIEWER may read; OPERATOR, ENGINEER and ADMIN may create/review/commit within granted factory scope. This reuses current role names but requires a new factory access resolver. Separate approver/committer identities are not required by this draft; confirm enterprise policy before implementation.
- Success envelope: `{ "success": true, "data": ..., "request_id": "..." }`; list events also has `meta`. Errors: `{ "success": false, "error": { "code": "...", "message": "...", "details": {} }, "request_id": "..." }`. Serialization for these proposed routes must explicitly map the existing middleware's requestId convention rather than mixing names.
- Mutating requests require `Idempotency-Key`: 1–128 ASCII letters, digits, `._:-`. Scope `(factory_id, actor_id, operation, key)`; canonical body hash includes target path/case ID. Same key/body returns original status/body with `Idempotency-Replayed: true`, even if versions have since changed; same key/different input → 409 IDEMPOTENCY_KEY_REUSED. Persist receipts for at least the case/audit retention period; do not expire them silently while accepting replays.
- Mutations require `expected_snapshot_id` (UUID) and `expected_plan_version` (integer >= 0). Here plan version means **published factory schedule version**, not candidate revision. Snapshot ID comes from server, not a client timestamp. Human commands additionally require `expected_case_revision` and `candidate_revision` (integers >= 1). All expected values are mandatory; missing values → 400, no last-write-wins default.
- `schema_version` is required on create; it must be a supported Operations Context contract version. Examples use `operations-draft-1` only as a placeholder, not an asserted canonical version. Opaque payload objects must ultimately be validated against that pinned schema, not accepted as arbitrary JSON.
- Initial request size limit remains 100 KiB; return 413 above it. Large plan/artifact uploads require a later agreed artifact transport, not increasing limits implicitly.

## GET /operations/snapshot?factory_id=factory-01

Read head and its snapshot in one consistent DB statement/transaction. Return the stored full FactorySnapshot payload without deriving new risk values in the client.

```json
{
  "success": true,
  "data": {
    "factory_id": "factory-01",
    "snapshot_id": "a935403f-08c7-4a47-bca0-366a60d7368b",
    "schema_version": "operations-draft-1",
    "captured_at": "2026-09-21T02:00:00Z",
    "plan_version": 7,
    "current_schedule_id": "d5394c33-164f-4f4e-ae53-6b53a9fc933b",
    "snapshot": {}
  },
  "request_id": "example-request"
}
```

`snapshot: {}` is a documentation placeholder for the full validated FactorySnapshot, not a valid fixture. Missing current snapshot → 404 SNAPSHOT_NOT_AVAILABLE. Unknown/inaccessible factory → 404 FACTORY_NOT_FOUND. Set Cache-Control: no-store for mutable-head reads. Separate GETs can observe different head versions; the client must compare tokens and refetch rather than combine inconsistent results.

## POST /decision-cases

Required header: Idempotency-Key. Proposed body:

```json
{
  "factory_id": "factory-01",
  "schema_version": "operations-draft-1",
  "expected_snapshot_id": "a935403f-08c7-4a47-bca0-366a60d7368b",
  "expected_plan_version": 7,
  "request": { "objective": "Review the production schedule", "constraints": {} }
}
```

`request` is the proposed contract-owned analysis input; objective/constraints must be reconciled with the actual contract before implementing validators. The server supplies id, creator, timestamps and status; clients cannot supply traces or claim a validated plan.

In one transaction fence head pair, insert case (status CREATED, revision 1), CASE_CREATED event sequence 1, and command receipt. A DB-polling worker can discover CREATED rows; a broker implementation must insert an outbox message in that same transaction. No agent execution in the HTTP transaction.

202 response data: `id`, `factory_id`, `status: CREATED`, `case_revision: 1`, `basis_snapshot_id`, `base_plan_version`, `candidate: null`, `processing: {status: QUEUED, attempt: 0, last_error: null}`, `created_at`, `updated_at`. Header `Location: /api/v1/decision-cases/{id}`. Stale pair → 409 with no new case.

## GET /decision-cases/:id

Return case fields above, plus:

| Field | Proposed meaning |
| --- | --- |
| candidate | null until generation, otherwise `{schedule_id, candidate_revision, content_hash, payload}` for selected immutable Schedule |
| validation | null or `{status, candidate_revision, candidate_hash, artifact_id, checked_at, errors}`; status PENDING/PASSED/FAILED |
| explanation | null or sanitized explanation artifact summary tied to candidate_revision/hash |
| current_context | `{snapshot_id, plan_version}` from current head |
| stale | true when case basis differs from current_context; computed, not a new case state |
| available_commands | Server-derived list from role, status, staleness and validation; informational, rechecked on POST |
| processing | `{status: QUEUED/RUNNING/BLOCKED/IDLE, stage, attempt, last_error}`; safe error code/message, no secrets |
| latest_event_sequence | Durable sequence for polling |
| latest_human_decision | null or id, kind, actor_id, timestamp, reason, evidence references |
| commit | null or `{schedule_id, plan_version, committed_at, human_decision_id}` |

Read case/head/selected candidate consistently. The response can become stale immediately after reading; POST preconditions remain authoritative. Full trace data is accessed only as sanitized event summaries/references in v1, not an unrestricted trace dump.

## GET /decision-cases/:id/events?after_sequence=0&limit=100

JSON polling in v1, not SSE. after_sequence defaults to 0, integer >= 0; limit defaults to 100, range 1–200. Query by caseId, sequence > cursor; sort sequence ASC. UUID/timestamp sorting is not a cursor substitute.

Each event has `id`, `case_id`, `sequence`, `type`, `from_status`, `to_status`, `actor: {kind: HUMAN|AGENT|SYSTEM, id}`, `occurred_at`, and sanitized `payload`. Human action events link their immutable evidence and decision ID; trace events link run/call IDs. No credentials, raw private reasoning or unfiltered tool arguments are returned.

Response: `{success:true, data:[events], meta:{next_after_sequence, has_more}, request_id}`. Fetch limit + 1 to compute has_more; next_after_sequence is last returned sequence or the input cursor if empty. New events are discovered by polling again, including after a terminal state if the client has not drained history. Event inserts and case mutation commit together, so no half-written transition appears.

## POST /decision-cases/:id/decision

Required Idempotency-Key. Shared body fields: command, expected_snapshot_id, expected_plan_version, expected_case_revision, candidate_revision; reason optional except MODIFY. Reject unknown fields and command-specific invalid combinations.

```json
{
  "command": "APPROVE",
  "expected_snapshot_id": "a935403f-08c7-4a47-bca0-366a60d7368b",
  "expected_plan_version": 7,
  "expected_case_revision": 6,
  "candidate_revision": 1,
  "reason": "Reviewed resource availability and schedule constraints."
}
```

| Command | Required current status | Extra body | Success and effect |
| --- | --- | --- | --- |
| APPROVE | AWAITING_APPROVAL | Optional reason (trimmed 1–4000 chars when supplied) | 200 APPROVED; immutable HumanDecision; does not update current schedule |
| MODIFY | AWAITING_APPROVAL | Required nonblank reason <=4000 chars; required `replacement_schedule` full contract-valid plan | 202 MODIFIED; new immutable candidate revision; validation queued; no publication |
| REJECT | AWAITING_APPROVAL | Optional reason | 200 REJECTED; history persisted; no publication |
| COMMIT | APPROVED | Optional reason; no replacement_schedule | 200 COMMITTED; approved exact candidate becomes current schedule atomically |

MODIFY must materially change the candidate after canonical normalization, remain in the same snapshot/factory, and reference resources from that snapshot. Structural validation occurs before storing; feasibility validation then runs asynchronously. Schema errors → 400; asynchronously infeasible edits stay VALIDATING with processing BLOCKED and recorded errors. Do not report them as approved. A successful modified plan must be explained and separately approved before commit.

All successes return data `{case_id, status, case_revision, candidate_revision, human_decision_id, actor_id, recorded_at, current_context:{snapshot_id,plan_version}, commit:null|{schedule_id,plan_version}}`. For MODIFY, include the new candidate_revision; for COMMIT, include the newly published plan_version. Actor and timestamp always come from server, never request fields. Events may show later processing state by the time the client polls.

Approve/commit transaction algorithm is specified in the design note. Exact retries use the same Idempotency-Key and body. A genuinely new decision uses a new key and refreshed expected values. If the case basis is stale, refreshing only the request tokens cannot make it valid; create a new case and review its new evidence.

## GET /schedules/current?factory_id=factory-01

Return one consistent head+schedule read:

```json
{
  "success": true,
  "data": {
    "factory_id": "factory-01",
    "snapshot_id": "a935403f-08c7-4a47-bca0-366a60d7368b",
    "plan_version": 0,
    "schedule": null,
    "commit": null
  },
  "request_id": "example-request"
}
```

After publication, schedule contains id, basis_snapshot_id, candidate_revision and contract payload; commit contains case_id, actor_id, plan_version and committed_at. Top-level snapshot_id is current head snapshot; schedule.basis_snapshot_id is the historical basis and can differ after fresh observations arrive. Current schedule remains until another explicit commit. Unknown/inaccessible factory → 404. Cache-Control: no-store.

## Error matrix

| HTTP | Code | Meaning / caller action |
| --- | --- | --- |
| 400 | VALIDATION_ERROR / UNSUPPORTED_SCHEMA_VERSION | Invalid IDs/body/query/command, missing concurrency fields or unsupported contract; fix input |
| 401 | UNAUTHORIZED | Sign in |
| 403 | FORBIDDEN | Authenticated role cannot execute command |
| 404 | FACTORY_NOT_FOUND / CASE_NOT_FOUND / SNAPSHOT_NOT_AVAILABLE | Missing or inaccessible scope/resource |
| 409 | SNAPSHOT_CONFLICT | Expected/current/case snapshot mismatch; obtain fresh context and create new case if needed |
| 409 | PLAN_VERSION_CONFLICT | Published plan changed or expected version differs from case basis |
| 409 | CASE_REVISION_CONFLICT / CANDIDATE_REVISION_CONFLICT | Another transition/edit won; refetch case |
| 409 | INVALID_CASE_TRANSITION / PLAN_NOT_VALIDATED | Command/state mismatch or evidence does not cover selected candidate |
| 409 | IDEMPOTENCY_KEY_REUSED | Same key with different command content |
| 409 | CONCURRENT_WRITE_CONFLICT | Serialization/lock conflict; refetch or retry identical command with same key |
| 413 | PAYLOAD_TOO_LARGE | Request exceeds configured body limit |
| 503 | DB_UNAVAILABLE | No successful transaction assumed; retry same command key after recovery |

Conflict details may include current snapshot/plan/case/candidate versions only after access checks. If the connection drops after DB commit, the caller must retry using the same idempotency key rather than assume failure. No success response is emitted before commit.

## Implementation verification (future work)

Validate OpenAPI against this draft after the canonical contract is available; implement full authorization and transition matrix tests, PostgreSQL race/rollback tests and UI polling/replay tests. The current deliverable specifies endpoints only; none is claimed deployed or tested end-to-end here.
