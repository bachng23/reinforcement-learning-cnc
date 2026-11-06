# Work Orders verification

Implementation baseline tested locally on 2026-10-24:
`70bb557ebed0b7e2b4515802c37ac0a8bb7af001`, based on main
`f8d94837159ca5fdc1a0f159fc8c28f75e394f7f` (merged #48/#49 contracts).
The final draft PR records the final head and CI run URLs; do not infer its CI
status from an earlier contract-only run.

| Check | Result |
| --- | --- |
| Authenticated HTTP + PostgreSQL 17 integration | 15 suites, 158 tests passed |
| Backend unit regression | 31 suites, 307 tests passed; 4 existing skipped tests |
| Additional nested public-payload sanitization, contract and recovery guard check | 3 suites, 19 tests passed |
| Migration history from exact current base | Passed; no existing migration modified |
| Fresh DB + base-to-head migration paths | Passed; owned schemas removed |
| Populated upgrade | Passed in integration suite: all legacy row dumps/checksums unchanged, including S2 head/P1 basis S1, users/memberships/audit/publications/receipts/events |
| Real FastAPI planning/worker regression | 2 suites, 37 tests passed |
| OpenAPI/generated HTTP export | Matched |
| Two-factory seed and cookie-login smoke | Passed: real APPROVE/COMMIT sources, create/assign/accept/start/block/resume/complete/rework/complete/close, 10 events, cross-factory 404 |

The full PostgreSQL run includes the Work Order suite (16 tests), the populated
upgrade suite, and existing Operations/context/worker/decision/access/user-admin
regressions. Coordination uses separate HTTP requests/connections and observes
PostgreSQL lock waits before releasing the first transaction; no authorization mock
substitutes for the shared service. Both revoke/write serialization orders are
tested for creation, execution, replay and managerial recovery/recovery replay.
Source-plan changes, duplicate creation, competing state transitions and failed
audit/receipt writes assert no unauthorized or partial effects. Completion attempts
and source hashes survive rework and reassignment.

An initial full run exposed canonical-demo fixture interference; the source-negative
test now publishes a seed-style schedule only in its own random factory. The final
158-test run passed after that fix. Earlier timeout/outage runs are not claimed as
passing evidence. The isolated test cluster was separate from development services;
automated runners cleaned their schemas, and the manually exercised demo schema was
dropped after its smoke test.

CI Operations additionally covers real FastAPI planning, contract generation,
frontend typecheck/tests/build, browser workflow and three PostgreSQL-backed browser
runs, plus production Docker build. See the draft PR for completed final-head jobs.
No frontend source is changed by this implementation.

Incident contract #49 at `4469b78` contains no incident migration. Consequently a
combined *incident database migration* upgrade cannot be claimed yet. The shared
scope lookup is implemented and the contract/guard code from #49 remains intact;
repeat the populated upgrade with the real incident migration when Flex supplies it.

Reproduction and deployment/rollback: [runbook](work-orders-runbook.md).
