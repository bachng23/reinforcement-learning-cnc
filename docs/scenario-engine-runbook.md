# Scenario Planning integrated runbook

The implementation joins Backend #56, Frontend #57 and `scenario-engine:1.0` on
`backend/scenario-planning-engine`. The user authorized the Backend worker/job
extension on 2026-10-28. Acceptance evidence must identify the integrated commit;
a component test or dirty-tree benchmark is not three-run product acceptance.

## Configuration

Use Node 22.22.2+, Python 3.12 and PostgreSQL 16. Install locked dependencies:

```sh
npm ci --prefix backend
npm ci --prefix frontend
uv sync --frozen --group dev --project ai_services
export OPERATIONS_PYTHON="$(uv run --no-sync --project ai_services python -c 'import sys; print(sys.executable)')"
export SCENARIO_ENGINE_VERSION=scenario-evaluator:1.0.0
export SCENARIO_CONTRACT_VERSION=scenario-engine:1.0
export SCENARIO_SAMPLING_VERSION=scenario-crn:1
```

API and worker need the same database and version configuration. Configure
`AI_SERVICE_URL` explicitly; there is no localhost or fixture fallback. The
Backend image includes the canonical Python validation runtime and RFC8785.
`npm --prefix backend run operations:scenario-worker` runs the independent worker;
the episode and Decision Case workers retain their own lifecycles.

## One-command real browser acceptance

Supply `TEST_DATABASE_URL` for a dedicated database ending `_test` or `_ci`.
The runner rejects development database names, creates a fresh schema per run,
migrates/seeds it, starts real FastAPI/API/Scenario worker/Decision Case worker/
Next/Chromium, and cleans services, ports and schema in `finally`. Install
Chromium once with `node frontend/node_modules/@playwright/test/cli.js install chromium`.

```sh
node scripts/run-operations-browser-e2e.js --scenarios --repeat=3 --acceptance
```

`--acceptance` requires a clean commit and exactly three repetitions. Output is
under `artifacts/scenario-e2e/<SHA>/`: each run has service logs, Playwright
failure trace/video/screenshot, migration/cleanup logs and `scenario-evidence.json`.
The summary verifies stable semantic hashes across the three independent schemas.
Only assertions actually reached are written as passed. Debugging can omit
`--acceptance`; such runs retain `source_tree_dirty` and do not qualify as acceptance.

Reset means starting another harness run, which creates another isolated schema.
Never truncate application tables or delete receipts to reset a demo. If a runner
is killed, use its printed `OPERATIONS_SCHEMA_JOURNAL` with the same explicit test
database and `node backend/tests/integration/run-integration-tests.js --cleanup`.
The journal checks schema naming and database identity before dropping anything.

## Expected flow and recovery

Create a workspace from the current pinned baseline, save typed assumptions,
then choose Run baseline or Run saved scenario. Expected job states are QUEUED →
RUNNING → SUCCEEDED, with FEASIBLE/NO_FEASIBLE_PLAN point outcomes. Infeasibility
has diagnostics and no synthetic KPI. Infrastructure failures are bounded by
the original 300-second deadline and three persisted attempts. Transport retries
are at most one per call, only for transport/retryable 5xx; 422 is terminal.

Run IDs, workspace IDs, correlation IDs and attempts do not randomize planning.
Reload reads the stored job. An uncertain UI submit retries the same body/key;
after a definitive rejection, review inputs before starting a new action.
SIGINT/SIGTERM abort the engine request and release the claim; a crash is recovered
by an expired-lease claim. Old owners cannot persist after reclaim. HTTP engine
subprocesses also watch their owner PID so a forced server exit cannot leave
planning running indefinitely.

Physical sensitivity replans each value. Weight sensitivity keeps schedules,
KPIs, normalization reference and non-swept raw weights fixed. Compare reports
raw KPI deltas with units/direction and null reasons. It never compares independent
relative scores as absolute quality. Rank changes are sampled intervals only.

LIVE handoff creates a new case and recommendation. It supports objective weights
and typed maintenance earliest-start bounds; technician availability and duration
require authorized ingestion of actual facts. No simulation candidate is copied
into the published schedule. Current-head checks, human approval and atomic commit
remain the existing Backend responsibilities.

## Verification commands

```sh
uv run --project ai_services python ai_services/scripts/export_scenario_contracts.py --check
uv run --project ai_services python -m pytest ai_services/tests -q
node backend/tests/planning/run-planning-tests.js --scenario
node backend/tests/integration/run-integration-tests.js --scenario
uv run --project ai_services python scripts/check-contracts.py
uv run --project ai_services python ai_services/scripts/benchmark_scenario_engine.py --output artifacts/scenario-engine-benchmark.json
bash scripts/check-operations-integration.sh
```

The full gate additionally requires `MIGRATION_BASE_SHA` (CI uses the PR event's
base SHA), Docker, and test database configuration. It keeps history immutability,
fresh/upgrade migrations and existing planning/worker/browser gates. Browser suites
run sequentially. The benchmark measures actual typed physical and weight sweeps
at 1/5/7 points and 100/1000 draws, with environment and dirty-tree metadata; these
local callable timings do not establish production latency guarantees.

The Scenario worker PostgreSQL suite also starts two actual Node processes: it
kills an owner after the persisted claim, waits for its lease to expire and lets
a fresh process complete the same frozen input through the real FastAPI engine.
It verifies attempt history and rejects the old owner's late result. A separate
HTTP/PostgreSQL test injects deterministic monotonic deadline exhaustion after
one real physical sample, preserving that result and persisting later TIMEOUT
points as PARTIAL_FAILED with no invented KPI. This is fault-injection evidence,
not a measured latency claim. Consumer setup/curl: `backend/docs/scenario-handoff.md`.

Public strategy enum names are mapped explicitly to the planner's canonical
lowercase IDs by `scenario-engine.adapter.js`. Generated result schemas come from
Python and are consumed by Backend/OpenAPI and Frontend; never hand-edit generated
KPI/normalization models. Frozen input hashes are echoed, not recomputed from the
transport wrapper. Source JSON is preserved when hashing timestamps/defaults.
