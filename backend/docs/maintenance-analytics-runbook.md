# Maintenance Analytics setup and verification

Base main `ff9a3aeec7d6f3b19e655a326cea214a968764c0`; draft PR #52.
The Incident–Work Order shared acceptance is separate and remains outstanding.

## Prerequisites

Node matching repository CI, PostgreSQL 17 test database ending `_test` or `_ci`,
backend npm dependencies and generated Prisma client, Python Operations validator
dependencies. Set `OPERATIONS_PYTHON` to that environment's Python executable.
Use an isolated database/schema; never point these commands at the user's dev schema.
No PostgreSQL service needs to be stopped. Registry/access source must be `database`.

```powershell
npm.cmd ci
npm.cmd run prisma:generate
$env:FACTORY_ACCESS_SOURCE='database'
$env:JWT_SECRET='replace-with-dedicated-test-secret-at-least-32-characters'
$env:ANALYTICS_DEMO_PASSWORD='replace-with-dedicated-demo-password'
$env:DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/cnc_research_test?schema=analytics_demo_'+[guid]::NewGuid().ToString('N')
node scripts/seed-maintenance-analytics.js analytics-demo-manifest.json
```

The tool refuses an existing schema or output file. It creates two scoped factories,
validates and commits real publications, and creates the golden history through
authenticated HTTP. Only the Work Order server clock is controlled during this
synthetic seed, restored in `finally`; no analytics formula/auth/DB is mocked.
All IDs are real UUIDs in the manifest; event timestamps and expected values are
deterministic. Passwords/tokens are not stored in the manifest. The explicit successful
demo schema is retained so a separate API process can serve it; failures clean only
the owned schema. Keep the same DATABASE_URL/JWT_SECRET when starting `npm start`.

## Consumer calls

Use a manifest username and the password supplied above. Auth sets the `pdm_token`
HttpOnly cookie; no bearer token is returned in the login body.

```sh
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"username":"MANIFEST_VIEWER_USERNAME","password":"DEMO_PASSWORD"}' \
  http://127.0.0.1:5000/api/v1/auth/login
curl -b cookies.txt 'http://127.0.0.1:5000/api/v1/maintenance-analytics/definitions'
curl -b cookies.txt 'http://127.0.0.1:5000/api/v1/maintenance-analytics/overview?factory_id=MANIFEST_FACTORY_ID&from=2026-09-22T04%3A00%3A00Z&to=2026-09-22T04%3A04%3A00Z'
```

Use the same common query for `/trends?metric_key=active_execution_time&bucket=day`,
`/machines?sort=active_p90&limit=25`, and
`/drilldown?metric_key=rework_decision_rate&population=denominator&limit=25`.
Append parameters with `&` when using the common query. Copy `next_cursor` verbatim
and URL-encode it. Every page rechecks access. Cursor does not persist a report
snapshot; refresh when workflow changes between observations.

Expected golden: 1 created/closed/successfully verified order, 2/3 rework decision
rate, 0/1 first-pass rate; active samples 40/30/20 seconds, median30, p90=38;
first acceptance10 seconds; verification waits20 seconds each. Closed is not always
successful: VERIFIED_STOPPED is counted only in closed and its verification breakdown.
Duration drilldown includes excluded cohort samples with explicit reason: total equals
sample_count + excluded_count, never silently hides corrupt samples.

Current snapshot counters ignore the period; completed-but-unclosed is open and may
be overdue. No historical backlog series. Definitions/DTO/examples live in OpenAPI,
`examples/maintenance-analytics-*.json` and the generated Operations HTTP contract.

## Automated gates and benchmark

```powershell
$env:TEST_DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/cnc_research_test'
npm.cmd test -- --runInBand
npm.cmd run test:maintenance-analytics
npm.cmd run test:integration
node scripts/export-operations-http-contract.js --check
$env:DATABASE_URL=$env:TEST_DATABASE_URL+'?schema=analytics_bench_'+[guid]::NewGuid().ToString('N')
node scripts/benchmark-maintenance-analytics.js analytics-benchmark-report.json
```

Run benchmark alone, without other test suites. It creates and drops only its new
owned schema on success/failure/handled interrupt. If forcibly killed, inspect the
explicit schema name before dropping that single schema; never sweep schemas.
The fixture uses batch SQL with guards enabled for 10,000 orders/110,000 events,
three active machines and additional empty machines, plus another isolation factory.
Publications still pass canonical semantic validation and real APPROVE/COMMIT.
Batch workflow rows are synthetic historical data, not evidence that operators actually
executed these commands. Reports contain all 20 measured timings after 5 warmups,
p95, hardware/PostgreSQL metadata, dataset/filter and EXPLAIN ANALYZE/BUFFERS output.
A nonzero exit means a budget or setup failure; retain the report for investigation.

Analytics read transactions set PostgreSQL `work_mem` to 32 MB locally for the
aggregate projection. This is a limit per sort/hash operation, not a 32 MB limit
for the entire request; concurrent requests and parallel query operators can use
more memory. Monitor database memory under expected concurrency before rollout.
There is no process cache, materialized rollup, or change to global DB settings.

## Rollout and rollback

No workflow semantics, authorization mode, telemetry or planner changes. Deploy only
after final contract, PostgreSQL, performance, migration-history and CI evidence pass.
Any later index migration must be additive and validated on fresh and populated base.
Rollback application analytics routes; retain all immutable workflow/source/history.
Never drop production data or restore stale environment grants to roll back analytics.

Current milestone and pending evidence are tracked in the draft PR; initial tests are
not a claim of COMPLETE or VERIFIED_DONE. Reproduce all final evidence at the final SHA.
