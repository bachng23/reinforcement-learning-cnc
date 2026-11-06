# Scenario Planning frontend — setup and verification

Read the [route, wireframe and API map](frontend-scenario-planning.md).
Actual captures and SHA-bound local checks are in the
[verification record](frontend-scenario-planning-verification.md).
Producer integration is pinned to #58, `d49ddfbbe3ffddb51cea03077aa032e4acb2ee1e`.
Main without this producer does not satisfy Scenario dependencies; missing APIs
produce an explicit unavailable state. No frontend fixture can replace them.

## Local application

Use the locked dependencies and the existing authenticated Operations API setup:

```sh
npm --prefix frontend ci
npm --prefix frontend run contracts:check
npm --prefix frontend run dev
```

Configure the existing local API base URL/factory and HttpOnly-cookie login.
Run the integrated Backend API, PostgreSQL, FastAPI evaluator, Scenario worker
and normal Decision worker using their owner-maintained configuration. The
Decision worker is required after Evaluate LIVE. Do not edit Backend/Flex,
invent engine version strings, or commit credentials/authentication bypasses.

`/operations/scenarios?factory_id=F` is real-only. Explicit `demo=1` stops at a
preview boundary, with no Scenario reads or writes. The legacy What-if fixture
remains explicitly labelled at `/operations/what-if?demo=1`.

## Review the product flow

1. Open/create a workspace in the selected factory. Review synchronized current
   context and publication. The planning horizon is the complete pinned window,
   not a shortened local alternative. Counts are page counts, not invented totals.
2. Select a draft or create one. Targets come from the immutable baseline
   projection, including historical baselines. Choose Technician/request targets,
   use the three templates and five bounded weights, then review requested changes.
3. Save with `expected_revision`. A 409 keeps the user's form and requires reading
   and reviewing the newer revision before a new intent. The original body/key
   never changes automatically.
4. Run a saved revision or explicit no-overrides baseline, confirm frozen inputs,
   then inspect the saved job. Reload reads status/result only. Pending jobs poll
   with backoff; attempt, deadline and safe failure are shown separately from
   computed feasibility. A network-lost receipt can be retried with its exact key/body.
5. Inspect backend metrics, assumptions, validation, normalization/contributions
   and selected candidate Gantt. Choose candidates without resetting the page.
   Compare one completed baseline with up to three completed scenarios. Each
   ranking retains its own normalization reference; no React reranking occurs.
6. Select one duration/weight and up to seven explicit points. Review frozen
   source/hash, overrides, fixed weights and sampling before enqueue. Inspect
   chart/table, baseline marker, sampled rank-change intervals and per-point
   constraints. Clicking a point changes selection only. Failed/infeasible samples
   remain gaps; unavailable metrics are not zero-filled. Weight reranking requires
   a feasible candidate set. Physical sweeps may report no feasible plan.
7. For a completed saved scenario, review LIVE eligibility/mapping and current
   context. Confirm separately. Only backend-supported mappings are submitted;
   a verified new LIVE case opens Recommendation Center and replans normally.
   A changed head requires review and never silently replaces expected context.
   There is no simulation COMMIT button.

ADMIN/ENGINEER can issue supported commands; VIEWER/OPERATOR read only. UI gates
are supplementary to server authorization. Identity is checked after reads and
before writes. Factory/user changes cancel and clear old scoped data.

## Recovery and limits

Every write freezes its key/body/revision in actor/factory-scoped RAM; pending
blocks duplicate submit and changes. Follow-up GET failures are uncertain
outcomes, not success or permission for a new body. Manual uncertain retry keeps
the original request. Definitive 4xx requires review; 409 never auto-rebases.

Unsaved input and uncertain intent survive supported SPA transitions in memory,
not a full browser reload. Leaving warns; hard reload reconciles saved records
without submitting anything. No note/reason/token is persisted in browser storage.
There is no public engine retry-attempt/history API: retry GET and retry the
original uncertain request are distinct from a new run.

Errors expose safe messages/request IDs, not raw backend stacks. Real mode never
falls back to static candidates, current snapshots or claimed success. Unknown
or cross-context result DTOs fail closed.

## Component and production checks

```sh
npm --prefix frontend run contracts:check
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run test:browser
npm --prefix frontend run build
```

The browser script runs the existing desktop/mobile regressions, then Scenario
at 1440×900, 1920×1080 and 2560×1440. Do not overlap Next dev/browser suites with
production build: they share `.next`. Windows can set
`OPERATIONS_BROWSER_EXECUTABLE` to installed Edge; Playwright recording also
requires its ffmpeg install/cache. CI uses Node 22, Python 3.12 and PostgreSQL 16.

`frontend/tests/fixtures/scenario-engine-ui.json` contains producer-evaluated
component evidence, not a production adapter or independent golden oracle.
The static transport desktop suite tests URL, identity, filters and rendering;
it cannot prove integrated acceptance. Legacy screenshots under
`docs/screenshots/scenario-planning/contract-harness` are also component evidence.

## Real API / worker acceptance

Use a dedicated disposable PostgreSQL database whose name ends `_test` or `_ci`.
Set `TEST_DATABASE_URL`, `OPERATIONS_PYTHON` and, on Windows, the browser executable
and Playwright cache. Never run acceptance against a user's normal or production
database. From a clean committed integration checkout:

```sh
node scripts/run-operations-browser-e2e.js --scenarios --repeat=3 --acceptance
```

The existing runner creates/migrates/seeds three independent random schemas,
starts actual FastAPI, API, Scenario/Decision workers and Next, uses real cookie
login in the browser, then stops its processes and drops its schemas. Schema
journals support cleanup after interruption. The runner rejects dirty acceptance
trees, unsafe database names and inconsistent semantic hashes across schemas.

The expanded browser test verifies:

- Real workspace/draft/run creation, computed result persisted in PostgreSQL,
  candidate URL/Gantt selection and read-only reload.
- One deliberately lost **real accepted POST response**, manual exact key/body
  recovery and one persisted job; revision-conflict review preserves input.
- Replay after a new run UUID with identical semantic result/hash; duration and
  weight sweeps use real evaluation, with weight-only KPI/schedule stability.
- Saved baseline/scenario comparison; no publication by simulation commands.
- Supported LIVE confirmation, new source-linked case, new Decision worker
  recommendation; stale expected-head rejection without a replacement case.
- Historical immutable entities remain readable after a trusted new observation.
  This intentional stale probe advances observation context, not publication.
- An independently maintained producer golden factory is ingested into the test
  schema; real 91/120-minute samples fail feasibility, producing actual gaps.
- VIEWER UI/server denial, cross-factory not-found, revoked-session clearing and
  server-side `SIMULATION_ONLY` commit rejection. No fake success or fixture API.

No endpoint result is stubbed in this real suite. The lost-response probe forwards
the POST to the real server before aborting only its response.

## Evidence and completion

Evidence is under `artifacts/scenario-e2e/<integration-SHA>/`:

| Artifact | Meaning |
| --- | --- |
| `summary.json` | Exact SHA, clean-tree flag, three runs and semantic replay |
| `run-N/scenario-evidence.json` | Actual workspace/job/case IDs, hashes and checked assertions |
| `run-N/scenario-desktop/*.png` | Actual browser captures at all three desktop sizes |
| `run-N/playwright/` and process logs | Trace/video/failure diagnostics and actual service output |
| `run-N/cleanup.log` and runner schema journal | Cleanup outcome, no disposable schemas retained |

The Operations integration CI runs migration/fresh/upgrade checks, Backend/Flex
regressions, frontend checks/builds, existing Operations/Incident browser flows
and the three Scenario acceptance runs. Its evidence artifact is retained for
14 days. PR evidence must link the exact final head/run and report actual cleanup;
`API_READY`, component fixtures or one dirty debug run cannot substitute for
frontend `VERIFIED_DONE`.
