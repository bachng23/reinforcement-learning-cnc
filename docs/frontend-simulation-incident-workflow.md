# Simulation incident workflow — frontend handoff

Machine inspection reads machine health from #64 and durable simulator work
orders from #67. The component fixture captures describe the earlier fixture
flow. The authenticated acceptance test below exercises both live endpoints.

## Integration basis

- Machine health #64 is on main at `8887d5b`. The local consumer schema and
  t5/t6/t7 fixtures use the pinned producer contract.
- Work-order history comes from #67's `jcst-work-orders/v1` DTO. Work-order IDs,
  lifecycle status and assignment source come from the API. Active job context
  comes from the session snapshot.
- Merge #67 before #66 so both read endpoints are available on main.

## API / UI mapping

| Read/command | Authority and use |
| --- | --- |
| `GET /api/v1/research/demo/sessions/{sessionId}` | Owned session snapshot, revision, primary tick/components/jobs, decisions; reload is read-only |
| `GET /api/v1/research/demo/sessions/{sessionId}/machines/{machineIndex}/health?limit=256&expectedRevision={revision}` | PR #64: risk probabilities, applicability, retained history, stable event IDs; no physics in React |
| `POST .../sessions/{sessionId}/commands` | Existing approve or override (empty legal matching for defer); **current simulator revision**, key/body preserved on retry |
| `GET /api/v1/research/demo/sessions/{sessionId}/work-orders?machineIndex={machineIndex}` | #67: durable simulator history, coverage, total, lifecycle status and assignment source |

`revision` is a concurrency fence, **not** `tick`. A REVIEW preparation can
increment revision at the same tick. `stepSeconds` / session `step_seconds` is a
display scale, not physical calibration. M/C/T indices are zero-based on the
wire and in the URL, and displayed with +1. Event ticks are already boundaries:
failure/completion is `recordTick+1`, start is `recordTick`; never add 1 again.

Only a matching session/revision/tick/machine/lane/step duration/physical state
is accepted. The last consistent pair can remain visible **for the same session
and machine only**, with an updating label. Abort cleanup and a result fence
discard obsolete requests even if transport cancellation is ignored. A 180ms
revision debounce coalesces playback bursts; animation frames never fetch.
A failed or unauthorized read clears the prior pair. 404/503/network errors
offer retry. A 409 or mismatched response requires session synchronization.

Commands on a stale revision are disabled until a read-only reload. Reload never
re-submits a decision. A retry after a lost response uses the same body/key.
Defer is only enabled if the server catalogue contains the empty matching.
It appears as a recorded decision in Activity and does **not** create a service.
VIEWER controls fail closed; the backend remains the permission authority.

## Panel layout and navigation

Uses existing AppShell, ReviewDialog, Simulation tokens, button/table styles,
3D selection/inspector and the existing 2D fleet. No other module is redesigned.

```text
Inspect machine [M3 name]                    [close]
current machine status · clock
[machine selector] [C1 healthy] [C2 FAILED]
session / revision / tick
active technician · component · PM/CM · time left
[View dispatch proposal]
Component health [component selector]
server risk (%) / applicability / model note
risk vs simulated time, discontinuities + event markers
keyboard-readable milestone list / optional sample table
Maintenance work and history
technician · component · kind · state · remaining / start / completion / known wait
[Production context] [ages and qualifications]
```

`?session=<id>&machine=2&inspect=1&workshop=machining` restores M3 inspection.
Selection is retained through review and dispatch; returning to an open inspection
pauses playback so immediate start/completion responses remain inspectable.
3D highlight and Activity links select the same machine. Session/workshop changes
clear the old inspection. Component choice survives same-machine revision refresh.

Risk is formatted from the API probability (0..1) to percent only. No hazard,
risk level, KPI, score or confidence is computed. Null values and history gaps
break the plotted line. Zero remains valid; tiny nonzero values show `<0.01%`.
Work-order cards use the producer’s history coverage and stable workOrderId.
Missing times display as unavailable. Machine status uses the machine snapshot
components and jobs.

## Verification and reproduction

From `frontend`:

```sh
npm ci
npm run contracts:check
npm run typecheck
npm run lint
npm test
npm run build
npx playwright test --config playwright.simulation-inspection.config.ts
```

The Playwright suite starts an isolated Next development server on 3114 and
intercepts API responses with the producer fixtures. Desktop is 1440×900;
narrow is 390×844. Set `OPERATIONS_BROWSER_EXECUTABLE` for installed Edge/Chrome.
Screenshots/traces are under `frontend/test-results/simulation-inspection` and
selected review images are under `docs/design/screenshots/simulation-inspection`.
They are **component evidence only**.

With both producers checked out, run the authenticated browser acceptance on a
dedicated PostgreSQL test database ending in `_test` or `_ci`:

```sh
npx playwright test --config playwright.research.config.ts simulation-work-orders.spec.ts
```

The test uses the existing research browser harness to create a disposable
schema. It signs in, prepares the corrective/wait scenario at t5 and verifies
that M3/C2 has no work order before approval. At t6 it checks T2's active CM,
manual source and one remaining interval. The next step completes the same
order at t7. The test also checks reload without a command, machine switching,
and defer without creating a work order. It runs when the #67 migration is
present in the checkout.
