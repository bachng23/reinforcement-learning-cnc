# Operations browser E2E and demo runbook

This runbook exercises the real integration path:

```text
isolated PostgreSQL schema
  -> canonical demo snapshot
  -> authenticated browser
  -> backend Decision Case API
  -> Decision Case worker
  -> real FastAPI /v1/operations/plan
  -> persisted RecommendationPackage
  -> browser Recommendation Center
```

The harness never enables the frontend fixture adapter. It sets
`NEXT_PUBLIC_OPERATIONS_API_MODE=real` and fails if a recommendation is not
available from the persisted backend artifact.

## Prerequisites

- Node 22.22.2 or newer in the Node 22 release line
- Python 3.12, `uv`, and the locked `ai_services` environment
- PostgreSQL 16 reachable through a dedicated database ending in `_test` or
  `_ci`
- Backend and frontend dependencies installed
- Playwright Chromium installed

Example setup:

```bash
npm ci --include=dev --prefix backend
npm ci --include=dev --prefix frontend
uv sync --frozen --group dev --python 3.12 --project ai_services
npm --prefix frontend exec playwright install chromium
```

Do not point the commands below at a development or production database. The
harness rejects database names that do not end in `_test` or `_ci`.

## One-command integration run

```bash
export TEST_DATABASE_URL='postgresql://operations_test:operations_test_only@127.0.0.1:5432/operations_test?schema=public'
export OPERATIONS_SCHEMA_JOURNAL='/tmp/operations-browser-e2e-schemas.jsonl'
node scripts/run-operations-browser-e2e.js
```

The command creates a random `product_api_it_browser_*` schema, deploys all
migrations, seeds the platform admin and canonical `factory-demo-01` snapshot,
then starts FastAPI, the backend API, the Decision Case worker, and Next.js on
temporary ports. Readiness is checked before Chromium starts. All processes,
ports, and the schema are cleaned in `finally`, on SIGINT, and on SIGTERM.

Expected positive states are:

```text
CREATED -> ANALYZING -> GENERATING -> VALIDATING
        -> EXPLAINING -> AWAITING_APPROVAL
```

The browser verifies 1–3 valid candidates, matching factory/snapshot/case IDs,
ordered event history, and the same persisted package after reload.

## Three consecutive demo runs from reset

Each repetition uses a newly migrated schema, so it starts from a complete
database reset rather than deleting selected business rows:

```bash
node scripts/run-operations-browser-e2e.js --repeat=3
```

Evidence is written under:

```text
artifacts/operations-e2e/<git-sha>/
  summary.json
  summary.md
  run-1/evidence.json
  run-2/evidence.json
  run-3/evidence.json
  run-*/{migration,seed,backend-api,decision-worker,fastapi,frontend,playwright,cleanup}.log
  run-*/playwright/{html-report,test-results}/
```

Within every run, the suite reconstructs the exact persisted
`RunDecisionCaseRequest`, submits it to the real FastAPI endpoint twice, and
requires both complete responses to equal the artifact persisted by the worker.
This is the deterministic replay check for identical input.

Across the three reset runs, newly generated Decision Case IDs intentionally
change case-scoped plan IDs and Monte Carlo seeds. The cross-run semantic
fingerprint therefore compares the strategy set, deterministic planning KPIs,
validation verdicts, resource assignments, statuses, and schedule times. It
excludes case-scoped identifiers, measured latency, and seeded risk-simulation
KPIs; candidates are sorted by strategy before hashing.

## Negative checks

The current suite verifies:

- unauthenticated Operations API access returns `401`;
- a stale plan version cannot create a case;
- discarding the first create response and replaying its idempotency key returns
  the stored receipt without creating another case;
- a `SIMULATION_ONLY` case cannot commit;
- a real planner failure leaves the current snapshot, plan version, and schedule
  byte-for-byte unchanged;
- a browser reload reads the same persisted recommendation and complete event
  sequence.

The base revision used when this harness was added exposes read/create and
planning APIs through `AWAITING_APPROVAL`, but it does not expose the
`POST /decision-cases/:id/decision` approval/commit capability or live frontend
decision controls. Evidence records this as `not_available_on_base` when the
endpoint returns `404`. The harness must not claim that APPROVE/COMMIT, competing
commits, command receipt replay, actor attribution, or plan-version publication
passed until those Backend/Frontend capabilities land. Adding that domain logic
or its migration here would violate this integration task's scope.

## Explicit long-lived demo schema reset

For a local demo schema, use a dedicated database ending in `_demo`, `_test`, or
`_ci` and a schema beginning with `operations_demo_`:

```bash
export NODE_ENV=test
export OPERATIONS_DEMO_DATABASE_URL='postgresql://operations_demo:password@127.0.0.1:5432/operations_demo?schema=operations_demo_local'
npm --prefix backend run operations:e2e-reset
```

The reset script validates both database and schema names, confirms the actual
database connection, and drops/recreates only the explicit
`operations_demo_*` schema. It cannot target `public`.

After reset, deploy migrations and seed the same explicit URL before starting
services:

```bash
export DATABASE_URL="$OPERATIONS_DEMO_DATABASE_URL"
npm --prefix backend exec prisma migrate deploy --schema prisma/schema.prisma
export ADMIN_PASSWORD='choose-a-local-demo-password'
node backend/prisma/seed.js
node backend/scripts/seed-operations.js factory-demo-01
```

## Failure recovery

1. Open `run-N/playwright/html-report/index.html` and inspect the retained trace,
   screenshot, and video.
2. Review service logs in the same run directory. Request and correlation IDs
   are preserved by the backend and worker.
3. Run the journal cleanup if an external hard kill prevented normal cleanup:

   ```bash
   node backend/tests/integration/run-integration-tests.js --cleanup
   ```

4. Confirm no `product_api_it_browser_*` schema remains and rerun from a fresh
   schema. Never manually clean `public` or a development database.

In CI, evidence is uploaded even when the gate fails. The final `always()` step
uses the same schema journal to recover an interrupted runner while preserving
the existing migration-history, fresh-install, base-SHA upgrade, contract,
backend, frontend, planning, and worker gates.
