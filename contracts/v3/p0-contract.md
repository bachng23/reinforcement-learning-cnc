# P0 Operations integration contract v1.0

Status: implementation baseline for review, 2026-10-15. Domain schema: **3.0**.
Reviewed against main `07033e3`. This freezes the existing compatible integration
boundary for P0 data integration and P0 human decision lifecycle. It does not
claim that the redesigned `/overview` is already connected to that boundary.

## Authority and change policy

| Boundary | Authoritative source |
| --- | --- |
| Domain payloads/invariants | `ai_services/domain/operations/contracts.py`, generated `operations-domain.schema.json` |
| Backend HTTP requests, envelopes, metadata | `backend/openapi.yaml`, extracted [Operations OpenAPI](operations-http.openapi.json) |
| Planner RPC | `ai_services/main.py`: `POST /v1/operations/plan` |
| Planning-engine port | `ai_services/domain/operations/planning.py`, [engine contract](planning-engine-v1.md) |
| Browser transport adapter | `frontend/lib/operations-api/client.ts` and `decision-case-reads.ts` |
| Product behavior and assignment acceptance | This document |

The domain schema and the HTTP transport are separate contracts. A canonical
payload nested inside `data` does not turn the whole response into a canonical
model. Domain `schema_version: "3.0"` applies to models that declare it, not every
nested object (for example Schedule has no schema_version).

Regenerate artifacts from their sources; never hand-edit generated schemas/types.
Any change to fields, units, enums, error shape, concurrency semantics or endpoint
behavior requires producer and consumer review plus updated examples/checks.
Breaking domain changes require a new major version. The transport baseline v1.0
does not rename existing 3.0 fields or change their meaning.

## Public HTTP boundary

Base path: `/api/v1`. Seven paths, eight operations:

| Method and path | Success | Data and required context |
| --- | --- | --- |
| GET `/operations/snapshot?factory_id=…` | 200 | Current FactorySnapshot, head snapshot ID and published plan version |
| GET `/schedules/current?factory_id=…` | 200 | Published Schedule or null, immutable basis_snapshot, publication metadata |
| GET `/decision-cases?factory_id=…` | 200 | Scoped case summary page and opaque next cursor |
| POST `/decision-cases` | 202 | Canonical DecisionCaseStatusResponse plus metadata; Location header |
| GET `/decision-cases/{id}` | 200 | Canonical status plus current context, revision, processing and human/publication metadata |
| GET `/decision-cases/{id}/recommendation` | 200 | Immutable RecommendationPackage and the case basis snapshot |
| GET `/decision-cases/{id}/events` | 200 | Sanitized durable history page in sequence order |
| POST `/decision-cases/{id}/decision` | 200 | Canonical status plus metadata after APPROVE, REJECT or COMMIT |

Success responses use `{success:true,data,…}`. List/events pagination metadata
must survive the client adapter; case metadata must survive alongside canonical
status. See the extracted OpenAPI for exact required fields and nullability.
Snapshot and schedule reads are individually consistent; separate GETs can observe
different heads. Never combine different head tokens into one authoritative view.

**Errors currently have two deployed formats.** Snapshot/current-schedule route
errors use top-level canonical ErrorResponse (`schema_version,error_id,code,
message,correlation_id,retryable,details`). Decision-case routes use the product
API envelope `{success:false,error:{code,message,details?},requestId}`.
Global body-parser failures (invalid JSON/oversize body) also use the product
envelope, including on snapshot/schedule paths. Preserve both branches of
OperationsApiError; do not pretend that every endpoint returns canonical errors.
An error-format unification needs an explicit compatibility change.

Reads require an authenticated active database user and factory access. Current
policy grants ADMIN access to existing factories; other roles require explicit
server-side factory grants. VIEWER cannot mutate. OPERATOR/ENGINEER/ADMIN may
create and decide within their factory scope. Missing/inaccessible case IDs,
including malformed UUIDs, return the same 404. Auth is checked on every poll,
page and idempotency replay. Client-supplied actor/time/role is never trusted.

## P0-A: authoritative factory data and presentation

Backend owns ingestion, immutable snapshots, published schedules and mutable
OperationsHead. Frontend uses current observation for factory overview and the
returned `basis_snapshot` for a published schedule. After S2 ingestion the head
can contain S2 with published P1 based on S1. P1 lanes, technician names, job
priorities and dependencies must still come from S1. A missing required basis is
an integrity error, never a reason to mix current entities into historical P1.
A factory with no publication has plan_version 0 and a null schedule/basis.

Use domain machine status IDLE/RUNNING/WARNING/MAINTENANCE/FAILED/UNAVAILABLE.
Presentation labels may translate these values but must preserve the original
status. Missing health is unknown; it is neither healthy nor zero. Health and
probabilities are 0..1; presentation can format percentages. Duration is minutes;
timestamps require timezone. Do not convert research steps into scheduling time.

A client may count returned entities or format measurements, with the scope and
coverage shown. It cannot invent authoritative risk, availability, utilization,
simulation KPI or feasibility. In particular `load_factor` is a planning input,
not a measured utilization series. FactorySnapshot supplies no general sensor
history endpoint. The existing recorded health/load charts must remain explicitly
demo until a separate history contract is implemented. Never substitute fixtures
on real API failure or combine demo machine IDs with unrelated research IDs.

P0-A acceptance:

1. The factory overview and schedule use the Operations API in real mode; the
   factory ID is explicit and shared by filters/navigation.
2. Loading, empty, unknown, unauthorized, unavailable and integrity-error states
   remain distinguishable. Demo data is visibly labeled and explicitly selected.
3. Snapshot/head changes trigger a consistent refetch; old requests cannot replace
   the newly selected factory. Stale historical cases remain inspectable.
4. A real S1/P1 → ingest S2 check proves the overview changes while P1 still uses S1.
5. The redesigned overview exposes the live Operations workflow; record any
   remaining demo-only panel instead of claiming it is connected.

## P0-B: decision lifecycle

Creation requires factory_id, schema_version 3.0, expected_snapshot_id,
expected_plan_version and strict request input (mode, canonical trigger input,
planning_config). The server supplies event identity/time/actor. WHAT_IF requires
SIMULATION_ONLY. Creation stores the immutable basis/request and returns CREATED;
it does not run the planner inside the HTTP handler.

A dedicated decision worker (distinct from the research episode worker) claims a
lease and invokes the planner. Persisted success exposes AWAITING_APPROVAL and
processing SUCCEEDED. The intermediate GENERATING, VALIDATING and EXPLAINING
transitions commit with the artifact; polling need not observe each phase, but
history preserves their order. Heartbeats can advance revision without an event.
Processing vocabulary is PENDING/RUNNING/SUCCEEDED/FAILED. The worker discovers
CREATED/PENDING cases and expired leases; failed cases are not automatically
retried by the worker. A crash can recover after lease expiry; graceful shutdown
requeues owned work. Only the current lease token/revision can persist a result.

| Command | Required state | Additional input | Effect |
| --- | --- | --- | --- |
| APPROVE | AWAITING_APPROVAL | Exact recommendation, candidate ID/version; optional note | Immutable human approval; published schedule unchanged |
| REJECT | AWAITING_APPROVAL | Exact recommendation; nonblank note, at most 4000 characters; no candidate fields | REJECTED; published schedule unchanged |
| COMMIT | APPROVED, LIVE | Same recommendation and exact approved candidate ID/version/hashes | Publish exact validated schedule and transition COMMITTED atomically |

All commands include schema_version, path-matching decision_case_id,
recommendation_id, expected_snapshot_id, expected_plan_version and
expected_case_revision. Actor, timestamps, hashes and statuses are server-owned.
MODIFY and replacement schedule input are rejected by this HTTP baseline, even
though the broader domain vocabulary reserves modification/revalidation. No
public cancel, arbitrary status PATCH, SSE or machine-control API is introduced.
COMMITTED means schedule publication; it does not acknowledge physical execution.

### Four independent version values

| Field | Meaning | Example |
| --- | --- | --- |
| HTTP expected_plan_version | Published factory head, >=0; must also match case base | 0 → 1 on COMMIT |
| HTTP candidate_version | Selected CandidatePlan.plan_version, >=1 | 17 |
| expected_case_revision | Latest mutable case revision from metadata | 6 → 7 → 8 |
| Schedule.revision | Immutable schedule revision; published unchanged | 9 |

The canonical HumanDecisionRequest.expected_plan_version means **candidate**
version. The backend maps HTTP candidate_version to that canonical field.
COMMIT is a transport command, not a HumanDecisionType. Do not send the HTTP head
version as the canonical candidate version; do not revive candidate_revision.
Use [checked-in command examples](../../backend/examples/decision-commands.json),
which deliberately keep all four values different.

Snapshot IDs and candidate IDs are opaque canonical identifiers; case IDs are
server UUIDs. A snapshot token must match both case basis and current observation;
the HTTP head version must match both case basis and current head. A stale basis
returns 409 and cannot be silently rebased, autoapproved or force-published.
Create a new case after inspecting refreshed context. After a successful COMMIT,
that case can itself have stale=true because its original base plan version is
older than the new head: render COMMITTED before applying stale-action rules.
`available_commands` is advisory; all guards run again on writes.

### Idempotency, concurrency and audit

Every create/decision write requires a 1–128 printable non-space ASCII
Idempotency-Key. Scope is factory + authenticated actor, shared across creation,
cases and commands. Use distinct keys for create, APPROVE and COMMIT. Same
normalized request returns the original status/body and Idempotency-Replayed:
true, with original Location for create. Reuse with a different case/body/command
returns 409 IDEMPOTENCY_KEY_REUSED. Keys have no expiry. Creation normalizes
planning defaults; command hashing ignores object property order but distinguishes
omitted and explicit fields. Current authorization precedes replay; successful
receipt lookup precedes stale/state guards. A replay is historical, so refetch
before using its metadata for a new command.

Lost response: retry the original key/body. Known 409: show conflict, refresh
context and let the user choose a new logical action with a new key. Never
blindly regenerate keys and retry publication. Snapshot ingestion, create and
human commands share the factory advisory-lock protocol. COMMIT also locks
case/head and atomically writes schedule, publication provenance, head increment,
case transition, audit event and receipt. Two cases on one basis cannot both
publish. Failed transactions leave no partial effects or success receipt.

### Discovery and history

Case discovery requires factory_id, accepts one status and one mode combined
with AND, defaults to 25 rows and allows 1..100. Ordering is created_at DESC,
UUID DESC. Signed opaque cursors bind actor/factory/status/mode; reset pagination
when that scope changes. A changing result set is not a cross-request snapshot.
Refresh from page one; do not fabricate a total count or reverse-engineer cursors.

History uses after_sequence exclusively (default 0), limit 1..200 (default 100),
sequence ASC and next_after_sequence. An empty page retains its cursor. Poll and
append by event identity/sequence. This backend HistoryEvent is distinct from
canonical AI DecisionEvent: CASE_CREATED is not an AI event enum member. Render
sanitized public payloads only; notes live in authorized decision metadata.

P0-B acceptance:

1. Real create → worker → recommendation → APPROVE → COMMIT survives refresh and
   rediscovery through the scoped case list and durable history.
2. Approval/rejection leave the published plan unchanged; only explicit COMMIT
   changes the head, exactly once. Simulation-only cannot commit.
3. Stale snapshot/head/case/candidate tokens, lost-response replay, competing
   decisions/publications, permission failures and rollback are covered through
   authenticated HTTP and PostgreSQL, with no partial publication.
4. UI sends selected candidate identity/version and latest server metadata,
   requires rejection reason, disables duplicate in-flight writes and exposes
   failures without optimistic success or fixture fallback.

## Planner and validation boundary

`POST /v1/operations/plan` accepts RunDecisionCaseRequest and returns a canonical
RecommendationPackage. It returns canonical ErrorResponse: 422 invalid input,
409 no feasible plan, 504 planning timeout, 500 planning/internal failure. Backend
maps failures to safe persisted case errors; raw tracebacks never reach users.
Planner engine ID/version, validator version, assumptions, warnings and evidence
must describe the actual producer. A deterministic planner is valid for this
baseline; no RA-QMIX checkpoint or LLM claim is required.

PlanningEngineInput carries factory_snapshot, trigger and config.
PlanningEngineOutput aligns every candidate with exactly one PlanValidation.
Recommendation may contain only VALID candidates. Structural schema validity is
insufficient: backend semantically revalidates every candidate against the exact
immutable snapshot before persistence/read/publication. INVALID and ERROR are
not equivalent to VALID; the browser cannot infer feasibility from a green badge.

## Assignment and integration gate

| Owner | Deliverable | Handoff |
| --- | --- | --- |
| Backend | Snapshot/schedule/case/history/command services, worker orchestration, auth, immutable persistence, concurrency | Frozen HTTP DTOs, command examples and real integration tests |
| AI/planning | Canonical planner request/result, deterministic semantic validation, honest evidence/provenance | Generated schema, valid/invalid fixtures, planner endpoint tests |
| Frontend | Apply redesigned desktop UI to real data and complete human workflow | Existing typed Operations adapter, explicit modes, basis-aware views and browser tests |
| Integrator | Align fields/versions, regression checks, review and PR | Both P0 acceptance lists and CI evidence; no duplicate competing API definitions |

Main already implements substantial parts of these deliverables. Reuse and verify
those paths before assigning new implementation; the remaining UI integration
must be assessed on the updated checkout.

Required gates: `uv run --frozen --project ai_services python scripts/check-contracts.py`,
backend unit/contract tests, and the affected Operations integration/browser suites
with a dedicated test database. Do not report P0 done solely from typechecks/mock
tests. Regenerate the HTTP baseline with
`node backend/scripts/export-operations-http-contract.js`; `--check` detects drift.

The historical drafts under backend/docs/operations-context remain historical
and are superseded for this baseline. Deferred extensions: MODIFY/revalidation,
public cancellation, streaming transport, sensor history, persisted membership
policy and physical execution acknowledgement.
