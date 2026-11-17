# Simulation — saved situations and controlled incidents

Frontend base: `30a27f820e511567f7fad8199f123f75646cd9f3` (main).
Branch: `frontend/simulation-situations-incidents`.
The frontend consumes the saved situations API and the JCST situation runtime.
See the [integrated acceptance runbook](research/situation-runtime-runbook.md)
for the PostgreSQL, API and browser checks.

## M0: producer contract and remaining gaps

The consumer is pinned to `feat/jcst-snapshots-incidents`, delivery `be8b299`.
See `frontend/contracts/jcst-situations/manifest.json` for the full producer SHA.
`producer.d.ts` and `openapi.yaml` are copies of the Backend handoff. The generated
consumer DTO is copied verbatim, not a second frontend domain model. Contract
checks also cover the additive controlled-event health union from the same SHA.

Snapshot detail returns policies, counts and session status. The library shows
the saved tick and the available detail fields. Per-machine conditions and
technician assignments with remaining time are available when inspecting a
restored session. The policy ranking is unavailable once a controlled incident
changes the primary lane only.

## API mapping

All paths below are relative to `/api/v1/research/demo`; the existing authenticated
research client preserves error status/code and sends no-store reads.

| Operation | Payload / authority |
| --- | --- |
| `GET sessions/{id}` | Latest session after draining an in-flight simulator command; GET never advances |
| `POST sessions/{id}/snapshots` | `SaveSnapshot`: revision, trimmed name/description, current layoutId; backend copies all runtime state |
| `GET snapshots?limit=20&cursor=...` | `SnapshotList`, retain nextCursor, append/deduplicate IDs, search loaded names only |
| `GET snapshots/{id}` | Immutable metadata/detail, selected on demand; no raw runtime JSON |
| `POST snapshots/{id}/sessions` | `OpenSnapshot`: immutable **sourceRevision**, never current live-source revision |
| `POST sessions/{id}/incidents` | `CreateIncident`: expected revision, machine/component indices, absolute scheduledTick, reason |
| `GET sessions/{id}/incidents` | Snapshot-fenced `IncidentList`; no invented query parameters or fixture fallback |

Writes use existing `Idempotency-Key` and producer envelopes. UI command wrappers
carry review context but only their generated DTO `body` is posted. Save body
never includes config, components, jobs, counters or a browser-built snapshot.
Now uses the confirmed current tick; After N converts 1..100000 whole steps into
an absolute tick, capped at the producer's signed-32-bit tick boundary. M/C/T
wire indices are 0-based and display labels add one.

## Interaction / wireframe

Existing AIMS AppShell, Simulation tokens, ReviewDialog, 3D/2D floor and compact
controls are reused. No Operations/What-if/Incident/Work Order redesign.

```text
Simulation controls: [Save situation] [Saved situations]

Save panel                     Saved situations
 latest paused tick/revision    search loaded names / cursor Load more
 workshop, policies, active     name, saved date, workshop, immutable tick
 work + time remaining          selected metadata / available summary
 name + optional description    [Open as new session]
 [Save] → server confirmation

Machine inspection (restored session)
 [Create incident]
 component selector · Now / After N steps · required note
 review M/C, revision, absolute tick/time
 [Create injected incident]
 server SCHEDULED / APPLIED / SKIPPED + reason
 injected queue / existing health and maintenance panels
```

Selecting Save/Create pauses playback **synchronously**, drains the tracked
simulator command promise, and reads the resulting authoritative revision.
Timer callbacks check the playback ref, so a queued frame cannot enqueue another
advance after the user paused. Modals/forms do not auto-submit on mount/reload.

Opening validates the snapshot ID/hash/source provenance, schema, tick, engine
source, branch ID, clock and supported layout. It accepts the new server session
ID, reads current server state to recover an old receipt safely, updates URL and
workshop, clears the old machine selection, and always starts playback paused.
On reload, a restored session's authoritative layout also overrides stale URL
or local-storage workshop preferences.
`machining` and the producer example's `smt-board-assembly` refer to the same
existing AIMS layout; unknown layouts are explicitly unsupported, not replaced
with the default factory.

Each logical write journals its exact body/key in actor/session/operation-scoped
sessionStorage. Retry sends the stored command unchanged. Known success clears
the journal; changed input/new action gets a new key. After reload, unresolved
operations have explicit Recover controls using their original body and timing.
They never POST automatically. An opening's identity depends on target/body,
not optional metadata enrichment. Server receipts can replay an old response;
the parent refetches the authoritative session before displaying it.

409 never silently changes revision/timing and retries. Refresh displays the
new basis; **Use refreshed snapshot / Confirm updated execution time** is a
separate step before another submit. REVIEW Now directs the operator to the
existing proposal flow. Missing release, incompatible snapshot, unavailable
runtime, auth, not-found and network failures remain visible, without mock data
or fake success. Unknown outcomes can be recovered without duplicate writes.

Controlled events use the API's UUID and status/reason, not a manufactured JCST
transition. They are labelled **Injected incident** in queue, Activity, 3D machine
context and health milestones. Natural engine events retain their own identity.
No risk, KPI, failure application or incident outcome is computed in React.

Session/machine/actor boundaries cancel reads or discard late results; list
pagination and detail reads have separate abort controllers. Incident polling is
revision-driven/coalesced, not frame-driven. The queue only renders a matching
session/revision/tick and never locally transitions a scheduled event by time.

## Verification / evidence boundary

```sh
cd frontend
npm run contracts:check
npm run typecheck
npm run lint
npm test -- --maxWorkers=3
npm run build
npm run test:simulation:situations
```

The desktop/mobile Playwright suite uses **intercepted contract responses** on
test-only ports 3116/5197. It exercises save during repair, independently opening
after the source advances, Now without a tick advance, scheduling after two
steps, reload without POST, server outcomes and runtime-unavailable errors.
The harness composes producer examples with existing physical fixtures solely
as UI evidence. It is not an independent physics oracle, runtime or Backend/Flex
acceptance. No production code imports fixtures. The unit suite additionally
covers request cancellation, lost-response recovery across remount, new keys,
stale confirmation, input bounds, scope/role isolation and cursor pagination.

On this Windows machine, run the full unit suite without a simultaneous Next
build/browser compilation to avoid CPU contention against existing 5-second
test timeouts. No unrelated test timeout or product behavior is relaxed.

Screenshots: `docs/design/screenshots/saved-situations/` (component evidence).
The verification manifest records exact source/screenshot fingerprints and
local check results. Production acceptance must be recorded separately.

## Manual integration checklist

1. Integrate the agreed Backend/Flex SHAs; migrate a dedicated test DB and install
   the real pinned runtime/checkpoints. Sign in as ENGINEER/ADMIN. Create base,
   seed 990000001, 3 machines/2 technicians; choose corrective/wait for the common
   deterministic case. Disable automatic playback decisions as needed.
2. At an in-service boundary, Save situation. Record snapshot hash/source revision,
   ages, work, remaining time and both lane ticks from server evidence. Continue
   the source. Open the saved situation: new session ID, paused, unchanged frozen
   physical state and queued incidents. Check REVIEW/COMPLETE preservation too.
3. Open a healthy snapshot. Inspect M3, choose C2/Now, add a note and review the
   current tick. Create: same physical tick, APPLIED source label, machine status
   and Activity update. Run forward into the existing repair proposal flow.
4. Fresh healthy branch: schedule after two steps. Verify SCHEDULED then the
   server's APPLIED or SKIPPED at the boundary, including in-service/already-failed
   reasons. Reload: same event ID/outcome and no additional POST.
5. Lose a response after real persistence, then Recover with the same key/body;
   verify one snapshot/event/session. Race a revision: refresh, review the new
   absolute tick, explicitly confirm and submit a new action.
6. Check rapid machine/session/workshop changes, keyboard/focus restoration,
   VIEWER/OPERATOR writes, other-owner reads, missing release and runtime failure.
   Record actual HTTP/browser logs, all integrated SHAs, desktop/mobile screenshots
   and cleanup of test-owned data before marking M2 verified.
