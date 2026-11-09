# Machine health — P0 contract and handoff

Base: `2a87081` (main). Endpoint: `GET /api/v1/research/demo/sessions/{id}/machines/{machineIndex}/health`.
This is an additive session read, not an Operations factory read. The existing
session owner or ADMIN can read; all other users receive `404 DEMO_NOT_FOUND`.
Authentication still checks the active user in the database. No simulator,
inference, audit insert, migration or revision update is needed for this read.

## M0 contract

- `machineIndex` is a canonical unsigned decimal, zero based, checked against
  **this session's** component array. Display labels M/C/T use index + 1.
- `limit` defaults to 64, range 1..256. It selects the latest retained transition
  records, not component rows. Unknown/repeated queries are invalid. Optional
  `expectedRevision` fences a grouped frontend read (`409 DEMO_STALE`).
- Success is `{success:true,data:MachineHealth}`; errors reuse the product
  envelope. Responses (including errors) have `Cache-Control: no-store`.
- Snapshot metadata: `sessionId`, `revision`, `tick`, `stepSeconds`,
  `lane:primary`, `source:JCST_SIMULATION`. Revision is not simulation time:
  preparing/configuring a review can increment revision without advancing tick.
- Current `machineStatus`: service job => `IN_SERVICE`, otherwise any failed
  component => `BREAKDOWN`, otherwise `WORKING`. Each component independently
  exposes `failed`, `ageTicks`, `failureRisk`, `riskUnavailableReason`.
- History samples are sorted by `(tick, componentIndex)`. `sampleKind:INTERVAL`
  uses record.before age and covers `[tick,tick+1)`; `sampleKind:CURRENT` is an
  additional sample at the current tick, evaluated against current state only.
  Thus at most `(limit+1)*componentCount` samples are returned.
- Risk is conditional probability of failure in the **next operating interval**,
  `-expm1(-(((age+1)/scale)^shape-(age/scale)^shape))`, from pinned JCST/1.1.
  This is not a diagnosis, RL confidence, cumulative risk or real telemetry.
  Service/occupancy (including service starting during the interval) takes
  precedence over breakdown; risk is null with `IN_SERVICE` or `BREAKDOWN`.
  A healthy sibling retains `failed:false` even while the machine is stopped.
- `history.fromTick` is the first selected record tick (or current tick if no
  records), `toTick` is current tick, `availableFromTick` the earliest retained
  record tick or null. `returnedIntervals` counts selected records.
  `truncated` is true if any elapsed interval is omitted by limit, retention or
  missing data. `gaps` lists missing half-open intervals **within the returned
  window**. Never interpolate across gaps or render missing risk as zero.
- Events include only failure/start/completion from selected records for this
  machine. Keep original event tick; expose `recordTick` and original
  `eventIndex` (including occupancy in that ordinal), machine/component index,
  nullable technicianIndex/kind. Sort `(tick,recordTick,eventIndex)`.
- Shared Backend 2 event identity algorithm (v1): `je1_` + base64url UTF-8 JSON
  `[sessionId,"primary",recordTick,eventIndex]` (compact JSON, no padding).
  Never use position in the retained array, revision, or the event tick alone.
  Backend 2 must use this helper/algorithm for the same physical evidence;
  this contract does not rename its existing incidentId/serviceId.
- New/legacy sessions with empty records still return current components.
  Missing step_seconds in older sessions uses the established 900-second step.
  Missing/malformed physical state is `500 DEMO_TRACE_INVALID`, never synthetic
  data. Missing/out-of-range machine: `404 DEMO_MACHINE_NOT_FOUND`; invalid path,
  query: `400 VALIDATION_ERROR`; unauthenticated: 401; DB unavailable: 503.

## Reproducible common case and fixtures

Create with `{case:"base",seed:"990000001",mode:"policy",primary:"corrective",
baseline:"wait",continuous:true}`. Advance with autoApprove=false. At a REVIEW
boundary, explicitly approve the pending action. With this deterministic policy,
M3/C2 fails at tick 5; approve T2's CM at tick 5, then approve any tick-6 review
(e.g. M1/C1) so the clock reaches tick 7. Do not use autoplay here: it confirms
actions automatically. No learned checkpoint is required for these two policies.

`tests/fixtures/machine-health/t{5,6,7}.json` contain success-envelope fixtures;
`source.json` contains exact physical input/traces and hazard oracle values.
The consumer TypeScript DTO is `docs/contracts/demo-machine-health.d.ts`.
Regenerate with `python tests/helpers/build-machine-health-fixtures.py`, then
`node tests/helpers/export-machine-health-fixtures.js`. The Python helper uses
the byte-verified vendored physics and controllers, without modifying them.
The fixed fixture session UUID is illustrative, not a live persisted session ID.
On CRLF Windows checkouts, the fixture/test helpers create an isolated temporary
copy, restore canonical LF bytes and verify every pinned SHA256 before execution.
They do not edit vendor files or relax the production manifest verifier.

```sh
curl -H "Authorization: Bearer $TOKEN" \
  "$API/api/v1/research/demo/sessions/$SESSION/machines/2/health?limit=64"
```

## Validation evidence — 8 November 2026

Verification ran on the local working tree based on main
`2a870810d294de6e0b2515f5ff9a83df4f6dd0f9`, before the delivery commit was
created. No deployment is claimed. No database schema or vendored physics changes
are required.

| Check | Result |
| --- | --- |
| `node node_modules/jest/bin/jest.js --runInBand tests/demo-health.test.js` | 18 passed |
| `node node_modules/jest/bin/jest.js --runInBand` | 366 passed, 4 conditional tests skipped; 40 suites passed, 2 skipped |
| `node tests/integration/run-integration-tests.js --machine-health` | Final run: 5 HTTP/PostgreSQL tests passed, 26.392s |
| Fresh PostgreSQL schema | All 21 existing migrations applied successfully |
| Common-case real engine | Authenticated create + explicit advance/approve; t5/t6/t7 DTOs matched physics fixtures, including both review revisions at an unchanged tick |
| Long-running real engine | 320 ticks, 256 retained records; default 64 and explicit 256 both verified through authenticated HTTP; no 64-tick ceiling |
| Isolation/read purity | All roles, forged JWT role ignored, inactive user, other owner, session-specific indices, malformed/repeated query, stale fence, bounded history/gaps, invalid stored data; no GET state/audit/revision changes |
| `git diff --check`, Node syntax checks | Passed |

The configured localhost:5433 test service was unavailable. Validation therefore
used a newly initialized PostgreSQL 18 cluster owned exclusively by this task,
on localhost:49676, not the development database. Final test schema:
`product_api_it_28500_3ad43f274f12`. The harness successfully dropped that schema,
its ownership journal is empty, and the temporary server was stopped in finally.
Local server/init logs are under
`%TEMP%/jcst_health_pg_d63926aa500144deae2fcc31000782a5`.

Tested SHA256 fingerprints (LF/CRLF-sensitive file bytes):

| File | SHA256 |
| --- | --- |
| `src/research/demo-health.js` | `8b42a0953f893ab347ce22a240c1880f15f054b2413ca7b9cd0bef574a7bfe2e` |
| `src/research/routes.js` | `3870cdea11245e23dc042a8c7ab6896d24e03303a9f5068abeed2e769c934b32` |
| `research-openapi.yaml` | `0da8928b70dd8ddda9bcc4b0e91b002400eea34c2ee79331e9cc5520b9cc78a3` |
| `tests/fixtures/machine-health/source.json` | `68ebe0bcc2435323a00f6613c742a2035b9805546eb7f47586426c97cde31a69` |

To repeat PostgreSQL validation, set `TEST_DATABASE_URL` explicitly to a dedicated
test database, then run the integration command above. The runner creates and
drops only its own random schema. Set `OPERATIONS_SCHEMA_JOURNAL` to a writable
JSONL path if interruption recovery is needed; use the existing runner `--cleanup`
against the same explicit test database and journal. Set `JCST_PYTHON` to a Python
environment with the repository's existing AI-service dependencies if the local
`ai_services/.venv` is not available. This common-case suite needs no learned
checkpoint registry and does not test learned-policy proposals.

M0 contract/DTO/fixtures are available for review; joint consumer freeze is not
claimed. M1 backend implementation and local verification are complete. M2
requires a joint check with Backend 2 and the frontend: link all three milestones
by eventId, verify current/repaired component state, reload and confirm the same
session/tick provenance. Backend-only tests do not establish M2 acceptance.

## PR #64 P2 regression fix — 8 November 2026

Reproduced against delivery commit
`4fa68ed65c20b732070ea2eaed8543372fd854af`: a correctly shaped failure event at
tick 1 for M3/C2 was returned even though that transition's after state remained
healthy. Added a check against the same record's before/after component state:
failure evidence requires `failed:false` -> `failed:true`. Contradictory evidence
now returns `500 DEMO_TRACE_INVALID` before projection can issue an eventId.
The wire contract, identity algorithm and t5/t6/t7 fixture files are unchanged.

Two new unit regressions failed before the fix (healthy after; already failed
before), then passed with it. The full backend suite passed: **368 tests**,
4 conditional skips, 40 passing suites and 2 skipped suites (48.45s).
The original reproduction now reports `500 DEMO_TRACE_INVALID`.
Existing milestone fixture equality tests confirm valid event IDs are unchanged.

HTTP/PostgreSQL suite: **6 tests passed** (24.948s), including the exact injected
failure repro, a response containing no data/eventId, and unchanged persisted
session and audit count after that rejected read. All 21 migrations applied to
fresh isolated schema `product_api_it_26260_5045a1907e98`; the harness dropped it
successfully and the task-owned temporary PostgreSQL instance stopped in finally.
An initial test setup attempt hit a Windows Prisma DLL lock while unit tests
were running; rerunning sequentially after they finished passed without stopping
any unrelated service. No production schema, simulator or fixture rewrite.

Tested implementation SHA256 (`src/research/demo-health.js`):
`cbb2f17b8c034c83c0a3a932e81e2440544c3352177fe82f067a564f017d3b9b`.
