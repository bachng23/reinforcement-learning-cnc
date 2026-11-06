# Incident Center: isolated real-service demo

Status: implementation under acceptance, not VERIFIED_DONE. Production critical
paths use PostgreSQL, authenticated API, the dedicated Decision Case worker and
FastAPI. No recommendation fixture is used by the browser linked flow.

## Baseline and ownership

Implementation branch: `backend/incident-center-implementation`.
Exact base / integrated Work Orders producer: `ff9a3aeec7d6f3b19e655a326cea214a968764c0`
(main includes Work Orders #51). Work Order lookup and lifecycle are producer-owned;
Incident calls them without duplicating their tables or commands.
Incident migration: `20261022020000_factory_incidents`.
Authoritative HTTP specification: `backend/openapi.yaml`; generated artifact:
`contracts/v3/operations-http.openapi.json`.

## Requirements

- Node 22.22.2 or later in the Node 22 line, Python 3.12 with locked
  `ai_services` dependencies, backend/frontend dependencies and Playwright Chromium.
- Explicit disposable PostgreSQL database ending in `_test` or `_ci`.
- `TEST_DATABASE_URL` points only to that database. Never use a development URL.
- `OPERATIONS_PYTHON` points to the Python interpreter with the planner installed.
- `MIGRATION_BASE_SHA` is the exact reviewed PR base (CI uses the event's base SHA).
- Windows: run the harness with permission to terminate its child process trees.
  No unrelated service should be stopped.

Install with `npm ci --prefix backend`, `npm ci --prefix frontend`,
`uv sync --frozen --group dev --python 3.12 --project ai_services`, and
`node frontend/node_modules/@playwright/test/cli.js install chromium`.

## One command, three clean resets

From the repository root, after setting the variables above:

```sh
npm --prefix backend run operations:incident-demo -- --repeat=3 --acceptance
```

`--acceptance` refuses a dirty source tree. Each run creates a fresh schema,
deploys all migrations, seeds two factories and role users, then starts the API,
dedicated worker, real planner and Next.js with readiness checks. It uses Chromium
for Incident actions and authenticated producer APIs for Work Order execution.
After browser assertions, the harness restarts its API, logs in again and compares
Incident detail, evidence and event history against the pre-restart responses.
It closes owned services/ports and drops the schema after each run.
No existing schema is reset or swept.

For a development smoke run omit `--acceptance` and use `--repeat=1`.
Dirty-tree results are development evidence, never final-SHA acceptance.

For the entire existing gate (Linux/CI):

```sh
bash scripts/check-operations-integration.sh
```

This retains migration-history, fresh/upgrade, backend, contracts, worker/planning,
frontend regressions and both sequential Next/browser stages. Incident browser
assertions run within the real-service stage, not concurrently with another Next
suite. Full CI must still be green on the final PR head.

## Seed and expected states

- `factory-demo-01`: original Operations canonical demo; viewer has scoped access.
- `factory-incident-demo`: independently scoped copy of the canonical snapshot.
- `admin`: manager/verifier; generated password supplied only to the test process.
- `incidents_e2e_engineer`: Incident owner and Work Order executor.
- `incidents_e2e_operator`: operator role; same Incident factory.
- `operations_e2e_viewer`: read-only.
- `operations_e2e_outsider`: no grants to either factory.
- Generated IDs are recorded in the run's `test-users.json`; passwords are not
  committed or included in this runbook.

Incident routes: `/operations/incidents?factory_id=...` and
`/operations/incidents/{id}?factory_id=...`.

Manual flow: UI report → OPEN → assign → owner ACKNOWLEDGED → INVESTIGATING →
RESOLVED → another manager CLOSED → reload/history → REOPEN.
Official severity must be confirmed; operator proposals do not confirm severity.

Linked flow: real LIVE HEALTH_ALERT → worker/FastAPI recommendation → APPROVE →
COMMIT → Work Order from the published maintenance assignment → UI from-case report
and case/order links → Work Order assign/accept/start/block/resume/complete →
independent Work Order close → UI Incident resolve and independent close.
Active and COMPLETED Work Orders block resolution. Work Order closure never
automatically closes the Incident. Incident actions must not change the plan head.

## Recovery

- Unknown write outcome: choose **Recover original request**. Reload retains the
  original actor/body/key. Do not create a replacement report or a new key.
- Revision conflict: **Refresh and review**, then explicitly confirm a new action.
  No automatic token refresh/resubmission.
- Revoked/inactive owner: manager reassigns an eligible OPERATOR/ENGINEER; for a
  resolved/closed incident reopen first as appropriate. Do not impersonate owner.
- Missing/unavailable target: restore the producer/read path. An override reason
  does not bypass an unknown target.
- Planner failure: inspect worker/FastAPI logs. Do not replace its output with a
  fixture and do not mark the linked scenario passed.
- Database/cleanup failure: restore the explicit test database, retain the journal,
  and run the recovery command with the same URL and `OPERATIONS_SCHEMA_JOURNAL`:

```sh
node backend/tests/integration/run-integration-tests.js --cleanup
```

Schema cleanup validates recorded names and database fingerprint. When a service
cannot stop, the browser harness retains its schema and reports failure; inspect
the named owned PIDs/ports before terminating them. Never kill all Node/Docker/WSL
processes or drop a broad set of schemas.

## Evidence

Default directory: `artifacts/operations-e2e/<git SHA>/run-N/`.
Includes migration/service logs, Playwright failure traces, desktop screenshots
at 1280/1440/1920, `incident-evidence.json` with only executed assertions, and
`cleanup-result.json`. Each Incident run replays the exact persisted planning
request twice against FastAPI and compares the complete recommendation with the
worker's persisted package. `incident-summary.json` compares the physical plans
for all strategies across resets; differing fingerprints fail the run. Case IDs
change across resets and participate in the simulator seed, so the selected
strategy and Monte-Carlo risk estimates are not compared across different cases.

Traces may contain ephemeral test-session cookies; handle artifacts as test
diagnostics, not public documentation. Never reuse those credentials elsewhere.
Pending scenarios remain pending. Final delivery also requires populated exact-base
upgrade and the complete permission/concurrency/recovery matrix, plus green
Contracts and Operations integration CI. Any code change restarts the final
three-run sequence.
