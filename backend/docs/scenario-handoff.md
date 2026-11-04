# Scenario API consumer handoff

Use the exact integrated head/dependency SHAs and CI/evidence links in draft PR
`integration/scenario-acceptance`. This branch combines Backend #56, engine #58
and Frontend #57; it is not merged or deployed. Generated contract:
`docs/scenario-planning.openapi.json` relative to backend; consumer types:
`frontend/types/generated/scenario-planning.ts` relative to repository root. The old handwritten M0
TypeScript proposal is historical, not the current result DTO.

## Two-factory test setup

Use an owned dedicated PostgreSQL database ending `_test` or `_ci`, with an owned
schema. Never point reset/acceptance commands at a development database. The joint
harness creates the schema, administrator, scoped test users and canonical factory
snapshot; the Scenario E2E adds a second factory with the independently specified
90-minute-slot golden input. It cleans both factories by dropping only its owned
schema. No production telemetry or external machine control is involved.

```sh
export TEST_DATABASE_URL='postgresql://USER:PASS@127.0.0.1:PORT/scenario_test'
export OPERATIONS_PYTHON='/absolute/path/to/ai_services/.venv/bin/python'
node scripts/run-operations-browser-e2e.js --scenarios --repeat=3 --acceptance
```

This starts real FastAPI/API/Scenario worker/Decision worker/Next. Install locked
dependencies and Chromium as described in `docs/scenario-engine-runbook.md` first.
Windows may select installed Edge with `OPERATIONS_BROWSER_EXECUTABLE`; Playwright
FFmpeg is still needed for video capture. API and both workers share the explicit
database, factory access mode and reviewed engine versions:
`scenario-evaluator:1.0.0`, `scenario-engine:1.0`, `scenario-crn:1`.

For a persistent owned test setup, migrate and seed the product administrator using
the existing trusted seed CLI, then explicitly seed each factory with
`OPERATIONS_DEMO_DATABASE_URL` set to that same owned schema:

```sh
export DATABASE_URL='postgresql://USER:PASS@127.0.0.1:PORT/scenario_test?schema=OWNED_SCHEMA'
export OPERATIONS_DEMO_DATABASE_URL="$DATABASE_URL"
node backend/scripts/seed-operations.js factory-scenario-a
node backend/scripts/seed-operations.js factory-scenario-b
```

Authenticate normally as the seeded administrator. In database access mode, grant
existing active user UUIDs through the Factory API. Grant only A to one user and
A/B to another for isolation checks. ADMIN has global access without memberships.
Membership endpoints return a mode error in environment mode; do not mistake a DB
grant for effective authorization in that mode. `FACTORY_ACCESS_SOURCE` must match
on every API instance. User role comes from the DB and remains global.

```sh
curl -H "Authorization: Bearer $TOKEN" -X PUT "$API/api/v1/factories/factory-scenario-a/members/$USER_ID"
curl -H "Authorization: Bearer $TOKEN" "$API/api/v1/scenario-workspaces?factory_id=factory-scenario-a&limit=20"
```

## Create, save, enqueue and reload

Read `/api/v1/operations/overview?factory_id=factory-scenario-a` first. Copy its
current snapshot ID, plan version and head revision into `workspace.json` below;
never silently rebase a rejected write. The shown tokens match a fresh canonical
demo seed only. Keep the planning horizon within its actual planning window.

```json
{
  "factory_id": "factory-scenario-a",
  "name": "Maintenance duration analysis",
  "expected_head": {"snapshot_id": "snapshot-demo-20260922-0800", "plan_version": 1, "revision": 1},
  "planning_config": {
    "horizon_minutes": 720, "candidate_limit": 3, "solver_timeout_seconds": 30,
    "simulation_runs": 100, "base_seed": 17,
    "objective_weights": {"production": 1, "reliability": 1, "maintenance": 1, "workforce": 1, "schedule_stability": 0.25},
    "allowed_strategy_ids": ["PRODUCTION_PRIORITY", "BALANCED", "RELIABILITY_PRIORITY"]
  }
}
```

```sh
curl -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $WORKSPACE_KEY" --json @workspace.json "$API/api/v1/scenario-workspaces"
curl -H "Authorization: Bearer $TOKEN" "$API/api/v1/scenario-workspaces/$WORKSPACE_ID/baseline-entities"
curl -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $DRAFT_KEY" --json @draft.json "$API/api/v1/scenario-workspaces/$WORKSPACE_ID/scenarios"
```

`draft.json` uses the actual maintenance target from baseline-entities:

```json
{"name":"Ninety minute maintenance","note":"Hypothetical duration","overrides":[{"type":"MAINTENANCE_DURATION","maintenance_request_id":"MR-M03-001","expected_duration_minutes":90}],"objective_weights":{"production":1,"reliability":1,"maintenance":1,"workforce":1,"schedule_stability":0.25}}
```

Store returned workspace/scenario IDs, then create `run.json` with
`{"kind":"SCENARIO","scenario_id":"RETURNED_UUID","expected_revision":1}`.
For a no-overrides baseline use `{"kind":"BASELINE"}`. IDs are read from API
responses, not copied from examples or inferred from display names.

```sh
curl -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $RUN_KEY" --json @run.json "$API/api/v1/scenario-workspaces/$WORKSPACE_ID/runs"
curl -H "Authorization: Bearer $TOKEN" "$API/api/v1/scenario-workspaces/$WORKSPACE_ID/runs/$RUN_ID"
```

Enqueue is 202; poll QUEUED/RUNNING with bounded backoff and stop on terminal/error.
A lost POST response retries the exact same key/body. New engine attempts keep the
original input. Listing uses signed actor/factory/workspace-scoped cursors with
default 20/max 100 and stable created_at/id descending order. Run lists are summary
projections; fetch run detail for accepted results/point progress. All reads are
no-store, scoped and read-only. Historical entity reads stay on the pinned snapshot.

## Compare and sensitivity

Compare two to four completed same-workspace run IDs via
`GET /scenario-workspaces/{id}/compare?run_ids=ID1,ID2`. Metrics, units, direction,
deltas, null reasons, candidates and normalization references are engine-owned.
Never derive cross-run quality from independent normalized scores in Node/UI.

POST `/{id}/sensitivity-jobs` with the completed source run:

```json
{"source_run_id":"RETURNED_RUN_UUID","axis":{"type":"MAINTENANCE_DURATION","maintenance_request_id":"MR-M03-001","values":[30,60,90,120,150]}}
```

For weight-only reranking use an axis such as
`{"type":"OBJECTIVE_WEIGHT","weight":"reliability","values":[0,0.5,1,2,4]}`.
Five explicit values are the UI default; one to seven unique bounded values are
accepted. Physical points replan. Weight points retain candidates/KPIs/reference.
Read `/{id}/sensitivity-jobs/{job_id}`; retain every point outcome. A terminal job
can contain PARTIAL_FAILED: TIMEOUT/FAILED samples have no invented KPI or schedule.
NO_FEASIBLE_PLAN is a valid model outcome. Intervals are sampled rank changes, not
exact breakpoints or calibrated confidence. Simulator assumptions remain estimates.

## LIVE boundary and errors

Only a completed saved run can be reviewed for LIVE handoff. POST
`/{id}/live-evaluations` with `source_run_id`, `confirmation:true`, and the reviewed
current `expected_head`. Objective weights and typed defer bounds are supported;
duration/unavailability require separately updated real facts through authorized
ingestion. A historical workspace cannot silently rebase. The new LIVE case runs
its own planner and requires its own human review/APPROVE/COMMIT. Simulation
candidates/publications are never copied. Timeline includes source provenance.

Errors retain the product envelope and request correlation ID. 400 rejects malformed
or extra fields; 401 inactive/invalid session; 403 role denial; scoped 404 hides
missing/inaccessible IDs; 409 covers revision/head/key/source conflicts; 503 means
unavailable dependency, not an empty or successful result. ADMIN/ENGINEER write;
OPERATOR/VIEWER read permitted factories. Revocation blocks fresh requests and
receipt replay. No arbitrary engine URL is accepted from a request.

## Evidence and cleanup

PR metadata records exact tested SHAs, commands, counts, CI and real test run IDs.
The harness writes `artifacts/scenario-e2e/<SHA>/summary.json`, each run's
`scenario-evidence.json`, logs and three desktop screenshot sizes. These IDs
actually existed during the run; schemas are deliberately removed afterward, so
they are not endpoints in a retained demo. Do not publish test-user credentials.
Interrupted cleanup uses the exact test URL/journal with
`node backend/tests/integration/run-integration-tests.js --cleanup`.

For code rollback retain additive storage/history; coordinate API/worker versions
and pause intake before removing an engine capability. Do not drop run results,
receipts, publications or context to make old code start. Re-run exact-base upgrade
and contracts checks for any changed integration SHA.
