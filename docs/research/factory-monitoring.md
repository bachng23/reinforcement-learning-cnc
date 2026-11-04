# Factory monitoring and incident response

## M0 integration basis

- Exact base: `761a4520a53b8f0a3e35295d316bc68342bf6d41` on `integration/jcst-live-context`.
- Backend read API/context producer: `5279cc88d45c838a8212324ca42be16a67a508c7`; original runtime integration: `3359d97a0b2bbef35b9d7ae02fe4200acaa7fb64`.
- No backend, physics, model, checkpoint or catalogue changes in this frontend task.
- Types are generated from `backend/research-openapi.yaml`; physical configuration/state remain the existing JCST generated types.
- No separate Flex scenario catalogue or portable learned-release registry is present at M0. Case/seed inputs use existing capabilities and session creation; no scenario is labelled catalogue-verified without producer evidence.
- The base still contains the older timed Auto demo presentation. This task replaces that UI scheduler with explicit live tick playback, without changing the simulator commands or physics.

## Flow / light wireframe

Overview → Create session → Run ×1/×2/×5 → new failure pauses → click machine/incident → inspect context + evidence → review full matching → approve/override → Factory → explicitly resume → CM completion.

```
Heading / new session
Sticky playback: tick · status · Pause / Step · speed · pause-on-failure
Factory / Decision Center / AI workflow / Compare (explicit links)
┌ Factory map: API zone/bay coordinates ───┬ Compact incident summary ┐
│ M1 → M2 → M3; status + failed parts     │ Open / In service / Done │
│ actual/proposed technician commitments │ explicit history/filter  │
└ Component cards (expand) ───────────────┴──────────────────────────┘
Machine dialog: API profile / current state / incident-specific timeline
```

## Read and identity contract

`GET /demo/sessions/:id` restores session state, without POST or automatic resume. `GET /observation?expectedRevision=r` returns the atomic factory context, current machines, incident list and service history. Dialog reads `/machines/:machineId` and `/incidents/:incidentId` at the same expected revision; stale responses are discarded, not mixed with another boundary. Missing legacy context shows an explicit machine-list fallback, without invented positions.

`session`, `machine`, `incident` are URL selections. Indexes in JCST state/matching remain zero based; human labels and API IDs are M1/C1/T1 (index + 1). Times are abstract ticks; assignment lines do not represent travel. API context origin/version stays visible: illustrative batch/line metadata is not MES production state. Incident identity is API-produced, including recurrence; only linked evidence creates completed timeline stages. Read markers are browser-local and do not update incident status.

409 pauses playback, reloads authoritative state, and requires a fresh explicit review; it never silently reapplies approval at a new revision. Busy/uncertain commands block duplicate actions. Reload restores selection but never sends a command, approves, or resumes.

## Verification / handoff

```powershell
npm --prefix frontend run contracts:check
npm --prefix frontend run contracts:jcst:check
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run lint
# Isolated output while another dev server is open:
$env:CNC_BUILD_DIR = '.next-live-factory-production'
npm --prefix frontend run build
npm --prefix frontend run test:simulation:browser
```

The last command uses producer API examples through intercepted HTTP **only for
component/layout evidence**. It records both desktop sizes, unavailable/missing
context, selected incident reload, read-only navigation and keyboard behavior.
It is also appended to the existing `test:research:e2e` CI entrypoint. The real
flow is `frontend/tests/research-browser/live-factory-flow.spec.ts`; the existing
research browser runner starts an isolated PostgreSQL schema/API. Supply an
explicit dedicated `TEST_DATABASE_URL`, `JCST_PYTHON` and actual
`JCST_RELEASE_REGISTRY` as documented in `live-demo.md` before that test can run.
It records real video/screenshots and never intercepts simulator API responses.
Without the registry it is explicitly skipped, never counted as acceptance.

Current integration status: **INTEGRATION_PENDING**. The user confirmed no
registry/checkpoint/DEMO-01 bundle is available. Full real Start→failure→review→CM
completion/reload acceptance and its actual video remain unverified; generated
DTOs, static examples or a green component test do not close that requirement.

Component/API tests cover loading/error/missing context, selected machine/incident, recurrence/filter/timeline evidence, focus/Escape, stale responses and playback scheduling. Run frontend tests, generated-contract checks, typecheck and isolated production build. Real acceptance additionally requires actual PostgreSQL, registered S/F learned releases and the existing JCST runtime; mocked screenshots cannot establish DONE. Capture 1440×900 and 1920×1080 plus a short Start→failure→inspect→approve→completion video. Record exact head/integrated/producer SHAs and cleanup in the final evidence, with any missing producer artifact stated explicitly.
