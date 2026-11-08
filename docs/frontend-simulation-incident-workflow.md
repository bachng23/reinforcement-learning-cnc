# Simulation incident workflow — frontend handoff

Status: **M1 frontend implemented; M2 joint acceptance pending**. No Backend or Flex
implementation is changed by this branch. Component/browser fixture evidence is
not real API or joint acceptance evidence.

## M0 integration basis and producer gaps

- Frontend base: main `ddf7a05a2ee3b6f3276241eac698fa3150796203` (PR #65).
- Machine health producer: PR #64, `feat/jcst-machine-health`, pinned at
  `eff27fef2fec4c770c4a252b9c3dc0200d819466`. It is **not on the base main**.
  Consumer schemas are extracted from that producer's OpenAPI, with local JSON
  Schema reference paths; t5/t6/t7/source fixtures are copied from the producer.
  Generated TypeScript is checked locally.
- Backend 2 session-scoped work/service history API: **not supplied/implemented**,
  confirmed by the task owner. No speculative endpoint, durable work-order ID,
  status enum, or database write is invented. Joint contract freeze is pending.
- Current work is read from `Simulation.primary.state.jobs`. Historical service
  evidence is grouped from health API `start/completion` events. The UI calls
  these **physical service records**, not durable Operations Work Orders.
  The start `eventId` identifies the evidence card, never a made-up work-order ID.
  A current job without a retained start has an explicit presentation-only key
  and “Not retained” timestamps. It is not a history receipt.
- Once Backend 2 supplies its DTO, join by the producer's stable event IDs,
  session, primary lane, machine and matching revision. Do not join unrelated
  Operations work orders or change the command/recovery path.

## API / UI mapping

| Read/command | Authority and use |
| --- | --- |
| `GET /api/v1/research/demo/sessions/{sessionId}` | Owned session snapshot, revision, primary tick/components/jobs, decisions; reload is read-only |
| `GET /api/v1/research/demo/sessions/{sessionId}/machines/{machineIndex}/health?limit=256&expectedRevision={revision}` | PR #64: risk probabilities, applicability, retained history, stable event IDs; no physics in React |
| `POST .../sessions/{sessionId}/commands` | Existing approve or override (empty legal matching for defer); **current simulator revision**, key/body preserved on retry |
| Backend 2 work/service read | Producer gap; no call until route/DTO is supplied |

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
401/403 hide retained history. 404/503/network errors offer retry; 409/mismatched
reads require session synchronization. There is no fixture fallback.

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
Service grouping does not pair events across a reported gap. Unknown starts,
outcomes and waiting times stay unknown. Machine status always uses machine
snapshot components/jobs, never “a service completed, therefore working”.

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

For M2, integrate the pinned health backend and the still-missing Backend 2 DTO
without changing them to accommodate frontend tests. Use authenticated API,
PostgreSQL and real JCST engine, not intercepted responses:

1. Create `{case:'base',seed:'990000001',mode:'policy',primary:'corrective',baseline:'wait',continuous:true}`.
   The existing advanced Comparison policy field permits the `wait` baseline.
2. Turn off auto-approve and pause on failure; step explicitly to t5. Select M3
   from 3D/Activity. C2 has failure at t5; there is no new service yet.
3. Approve T2/M3/C2 at current revision. Return to M3 at t6: CM, in progress,
   one interval left. Approve the M1/C1 review at t6 if needed to reach t7.
4. At t7, verify the same service evidence is completed, start t5/completion t7,
   with the completion marker. Reload and verify same session/history without POST.
5. Inspect M1/M2 separately; defer without a service; change machines quickly;
   test retained/partial legacy histories, VIEWER/cross-owner reads and stale commands.
6. Record all three producer/consumer SHAs, auth/HTTP/browser logs, actual
   screenshots and test-owned data cleanup before claiming M2 verified.

Local real-engine verification is additionally blocked by Windows Application
Control rejecting `.tools/ai-venv/Scripts/python.exe`. No policy bypass or synthetic
runtime is used. This task does not claim an integrated browser run.
