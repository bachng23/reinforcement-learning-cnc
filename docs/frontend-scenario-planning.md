# Scenario Planning workspace — routes, contract and boundaries

Frontend branch: `frontend/scenario-planning-workspace`. Producer dependency:
[Backend/Flex integration #58](https://github.com/AIVIETNAM-AIO-BachNguyen/reinforcement-learning-cnc/pull/58)
at `d49ddfbbe3ffddb51cea03077aa032e4acb2ee1e`. The frontend is stacked on that
integration until it reaches main; its review diff must exclude Backend/Flex
implementation changes. Previous main was `c926d5d24566834850cf4a16af0792af9c7d50fd`.

The integrated producer now supplies immutable baseline entities, executable
Scenario jobs, comparison, sensitivity and supported LIVE mapping. Earlier M0
gaps G1–G5 are addressed by this pinned dependency. `INTEGRATED_CONTRACT` in the
consumer manifest describes the contract, not frontend `VERIFIED_DONE`.
Three clean-schema browser runs, screenshots, cleanup and final CI remain the
promotion gate; see the [runbook](frontend-scenario-planning-runbook.md).

## Routes and selection

| Route | Responsibility |
| --- | --- |
| `/operations/scenarios?factory_id=F&cursor=opaque` | Factory-scoped workspace directory, current-context creation review and cursor pagination |
| `/operations/scenarios/[workspaceId]?factory_id=F` | Immutable baseline and editor, saved drafts/runs, comparison, sensitivity and LIVE handoff |
| `/operations/what-if?factory_id=F` | Production entry redirects to Scenario Planning |
| `/operations/what-if?demo=1` | Explicit legacy fixture preview, never production Scenario data |

Workspace query parameters preserve `scenario_id`, `run_id`, `compare` (one
baseline followed by up to three scenarios), `sensitivity_id`, `candidate_id`,
`point`, `metric`, `draft_cursor` and `run_cursor`. Candidate and point selection
updates URL and local presentation without enqueueing, rerunning or resetting the
editor. Refresh/reload reads saved records. Section links preserve unsaved input;
leaving the draft/workspace warns before discarding it.

```text
AppShell / Scenario Planning                     Factory / directory / refresh
Workspace sections: Draft | Runs / Compare | Selected run | Sensitivity result
Pinned snapshot + plan / publication / engine + contract / historical status

Saved drafts + revision | Technician/request target forms + five raw weights
                       | Requested diff + Save / explicit saved-revision Run
Saved runs: status, attempt, source revision | baseline + <=3 scenario selection
Authoritative comparison: units / raw / delta / direction / tradeoffs
Selected run: effective diff / constraints / model + sampling / valid candidates
Candidate ranking context + contributions | large machine/technician Gantt
Sensitivity: one axis / <=7 explicit samples / frozen-input confirmation
Saved sensitivity: KPI chart / baseline marker / gaps / per-point inspection
Evaluate LIVE: supported mapping / current context / separate confirmation
              -> new Decision Case -> existing planning and human approval
```

Desktop sizes are 1440×900, 1920×1080 and 2560×1440. Forms reuse AppShell and
existing tokens. Wide records have labelled scroll regions and sticky headers;
candidate, sample and section controls support keyboard navigation. This task
does not redesign mobile or change Incident/Work Order flows.

## Generated contract and API mapping

Source: `backend/docs/scenario-planning.openapi.json` from the pinned
producer SHA. Normalized source SHA-256:
`8a00e38c96b307df531f5963e176d931a19ce63b1dc5604437aa88fc05853ac5`.
`frontend/scripts/generate-scenario-types.mjs` verifies that pin and generates
the DTOs, response schemas and capability manifest under `types/generated`.
There is no parallel frontend result/KPI model or independent proposal schema.

Paths below are relative to `/api/v1`. All calls use authenticated, no-store
HTTP; Scenario production has no fixture adapter or fixture fallback.

| Client method / API | UI and identity checks |
| --- | --- |
| `currentContext(factory)` via Operations API | Synchronizes current snapshot/head for creation and LIVE review only |
| `GET/POST /scenario-workspaces` | Scoped directory; create freezes expected head and the pinned planning window |
| `GET /scenario-workspaces/:workspace` | Basis/publication/config/engine metadata and historical flag |
| `GET .../baseline-entities` | Generated `BaselineEntities`, matching factory, snapshot, hash, plan and publication; never substitutes a current snapshot |
| `GET/POST .../scenarios`, `GET/PATCH .../scenarios/:scenario` | Saved draft revision, full replacement of editable inputs and explicit conflict review |
| `GET/POST .../runs`, `GET .../runs/:run` | Explicit saved-revision/baseline run; persisted job status, attempt, frozen hash and typed engine result |
| `GET .../compare?run_ids=baseline,scenario,...` | Ordered result identities/hashes, backend metrics/deltas/units/direction and tradeoff evidence |
| `POST .../sensitivity-jobs`, `GET .../sensitivity-jobs/:job` | Frozen source, one axis, point outcomes, sampled rank intervals and model/sampling metadata |
| `POST .../live-evaluations` | Separate supported mapping and expected-head confirmation; verify new LIVE case by authoritative Operations GET before navigation |

`assertScenarioContext` rejects a result with the wrong workspace, factory,
engine/contract version, immutable basis/hash, source run/hash, candidate
validation, selected candidate or ranking identity. Sensitivity points must
match their requested axis/order and individual outcomes. Invalid or mismatched
payloads are withheld rather than rendered as plausible results.

## Input and result semantics

- Three templates: Technician unavailability, maintenance duration and
  maintenance earliest start (`DEFER_MAINTENANCE`). Targets come from immutable
  scoped entities; completed/cancelled requests cannot be selected. No raw UUID
  or JSON editor appears in the critical flow.
- At most five unique type/target override pairs. UTC windows must fit the pinned
  window; duration is an integer 1–43200 minutes. Five raw weights are finite
  0–1000000, with positive total above the producer tolerance. This is input
  validation, not snapshot transformation, schedule validation or scoring.
- Saved revision and requested diff are reviewed before a run. Unsaved edits are
  excluded. Historical metadata and saved draft fields remain readable even when
  the immutable entities service is unavailable; target editing fails closed.
- KPI values, raw/delta/percent, unit, preferred direction, change verdict,
  feasibility, constraints, ranks, normalized weights/contributions and
  tradeoffs are displayed from the engine response. Missing/null values retain
  their reason; they are never filled with zero. Colors use the backend change
  verdict, including metrics for which higher is worse.
- Scores retain their candidate-set/reference context. Comparing runs does not
  create an absolute score or rerank in React. Candidate Gantt uses the selected
  validated plan and that result's effective immutable snapshot.
- Sensitivity reranks/replans on the server. Chart geometry and axis ticks are
  presentation calculations only. Failed/infeasible points break the line and
  have no plotted KPI; a sampled rank interval is not an exact threshold.
  Sampling/model assumptions are visible; no confidence band is invented.
- LIVE requires a completed saved scenario, feasible result, backend-supported
  mapping, ADMIN/ENGINEER access and reviewed current context. Physical
  assumptions marked unsupported stay unsupported. A new case replans; it does
  not copy simulation candidates, approve automatically or publish simulation.

## Commands, access and remaining boundary

Writes freeze `Idempotency-Key`, body and revision in scoped RAM, prevent double
submit, and verify a receipt through GET. Lost responses retry the same intent;
409 requires refetch and manual review, never silent token replacement. Reload
does not POST. Hard reload discards unsaved RAM inputs/keys and requires saved
record reconciliation; no automatic replacement command is sent.

Read polling backs off 2s → 4s → 8s → 15s, stops at terminal/error, and aborts
on scope change/unmount. Auth/factory changes clear protected results; 401/403,
404, 409, unavailable/network and unknown-result states remain explicit.

The producer still exposes no public retry-attempt/history endpoint. The UI
shows the authoritative attempt and supports read/original HTTP-intent retry;
it never labels a new latest-draft run as a retry of an old engine attempt.
No simulation COMMIT, manual schedule editor, backend changes or other module
redesign is part of this frontend diff.
