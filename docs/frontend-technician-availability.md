# Simulation technician availability — frontend handoff

Date: 2026-11-19 (Asia/Taipei). Base: `72af5ecda40833e3c9aaa68f6977f08937fa5814`.
Branch: `frontend/simulation-technician-availability`.

**M1_FRONTEND_READY / M2_INTEGRATION_PENDING.** This PR implements the consumer,
not Backend persistence or Flex availability semantics. No Backend/Flex files are changed.
Screenshots and intercepted-HTTP browser tests are component evidence, not a real-engine acceptance claim.

## M0 contract / producer gaps

The actual technician panel was the inline `TechnicianDetails` in
`frontend/components/simulation/factory-preview.tsx`. It is now shared by 2D and 3D
in `frontend/components/simulation/technician-details.tsx`.

Pinned producer: `origin/feat/jcst-technician-availability`,
`145edb0ce73eddee3bfa881ac26730781c1d5d1f` (base is main above). Its consumer DTO,
OpenAPI and labelled examples are copied under `frontend/contracts/jcst-technicians`
and `frontend/tests/fixtures/technicians`. Generated types are verbatim producer
types; UI command wrappers only add operation/session/target/basis-tick context.
No parallel wire model or fabricated endpoint is used.

| Operation | Relative to `/api/v1/research/demo/sessions/{sessionId}` | Wire body |
| --- | --- | --- |
| Read | GET `/technicians`, no query | none |
| Start absence | POST `/technicians/{0-based index}/absence` | `revision`, `durationTicks`, `reason` |
| Return early | POST `/technicians/{0-based index}/return` | `revision`, `reason` |

All requests use existing cookie auth and no-store. Writes carry Idempotency-Key.
The form permits an optional human note; the current producer requires a nonblank
reason, so blank notes send `Temporary absence` or `Returned early`. Durations are
1–100000 integral ticks; simulation minutes must convert exactly to whole ticks,
with no rounding. The session stepSeconds/step_seconds must agree. Absolute return
tick is display-only arithmetic using the producer clock; it is not sent as a
second scheduling authority.

**Unresolved M2 dependencies:**

- This Backend branch is not on the pinned main. Existing main may have no new routes.
- Producer explicitly labels its contract as M0 proposal/M1, pending joint acceptance.
- Flex has not supplied the `jcst-technicians/1` change/command/restore/incident bridge.
  Backend reports `503 TECHNICIAN_RUNTIME_UNAVAILABLE`; UI never replaces it with success.
- Real legal catalogue/observation/dispatch filtering, baseline busy-job completion,
  expiry at returnTick before assignment, snapshot persistence and replay require
  the availability-aware producer/runtime. The frontend does not implement any of them.
- A fresh two-policy comparison after intervention requires a common snapshot.
  Existing comparison is blocked when the server says requiresCommonSnapshot (or
  calendar version is nonzero); no client reranking/replanning is introduced.

## Presentation / route mapping

```text
Simulation / decisions?session=...&workshop=...&technician=0
  Factory HUD: free = count of server AVAILABLE rows
  2D technician cards / 3D identity markers / compact team buttons
    T1 panel: AVAILABLE | BUSY + job/remaining | ABSENT + return tick/time/remaining
      Mark temporarily absent -> pause/drain -> latest session -> read/review -> confirm
      Return now              -> pause/drain -> latest session -> review -> confirm
  Review assignments: absent reason/return time, invalid catalogue disabled
  Activity / factory timeline: server event IDs, start/expiry/early return, actor/reason
```

The 2D panel stays in the factory section; 3D reuses the existing floating inspector,
scrolling internally. Timeline is hidden while that inspector is open to avoid
overlap. The same component handles both views. Qualifications and job occupancy
remain unchanged; no absence time is added to technician utilization.
Panels retain T1/T2 identity, indexed by the full config size, not a hardcoded two.
Machine inspection clears technician selection, and technician selection clears
machine URL/storage context. Close/Escape returns focus to the opener. Narrow-screen
forms wrap, use labelled native controls, and use text in addition to color.

## Consistency, commands and recovery

- Workspace renders inside the existing authenticated AppShell provider. Reads and
  journals are actor/session/technician scoped; actor changes hide the prior panel.
- Current full-session embedded technician summary is preferred. A missing summary
  is read through GET with cancellation and revision/tick/stepSeconds fences, coalesced
  for 120 ms during playback. Mismatches are errors, never a different-session fallback.
- Legacy sessions with no calendar and no new summary derive AVAILABLE/BUSY only
  from their actual jobs, as the contract specifies. A calendar-bearing session
  cannot use legacy fallback. No production fixtures are imported.
- Entering a form pauses playback, drains the existing command promise, then reads
  the latest session. Saving a form does not advance the simulator clock.
- The reviewed revision and absolute return time remain visible. A changed session
  blocks submission. 409 requires explicit refresh and confirmation of updated context;
  there is no silent revision replacement/resubmit.
- A synchronous write lock prevents double submits. Same operation/body retains
  the journal key across retries/remounts. Mount/reload never POSTs automatically.
  Editing a reviewed action/new successful action uses a new key.
- A lost response (or successful POST followed by a failed authoritative GET,
  including auth failures) retains the original command/key for explicit recovery.
  Receipt recovery is followed by GET, since receipts can predate later commands.
- Accept the server's session, clear old review via its pending/status state, and
  keep playback paused. No local absence expiry, event creation, proposal generation,
  repair completion, risk or utilization computation is added.
- ADMIN/ENGINEER writes only; VIEWER/unknown identity cannot write. Backend retains
  final authorization and conflict enforcement. Loading, stale, busy, history limit,
  auth, unavailable, malformed data and network errors have safe text and retry paths.

## Verification and reproducible M1 demo

Use the workspace portable Node/npm if Node is not in PATH. From `frontend`:

```sh
npm run contracts:check
npm run typecheck
npm run lint
npm test -- --maxWorkers=3
npm run build
npm run test:simulation:technicians
```

Browser config owns loopback ports 3119/5199 and an isolated Next cache. Set
`OPERATIONS_BROWSER_EXECUTABLE` to installed Edge when bundled Chromium is absent.
It intercepts HTTP using pinned fixtures; it is never a runtime physics oracle.
One mobile WebGL case is intentionally skipped; mobile interaction uses the same
form in 2D, and desktop runs the actual 3D scene/markers.

The contract harness covers: three-step absence, pending double-submit guard,
same-tick early return, reload without POST, REVIEW invalidation, saving/reopening
an absent snapshot, prescribed server expiry, stale explicit reconfirmation,
runtime-unavailable recovery with identical key/body, VIEWER denial, actual BUSY
job, and restored-session Create incident -> server T2-only proposal with T1 absent.
Unit tests also cover config-sized arrays, actor/scope changes, late reads,
request cancellation, HTTP envelopes/headers, mismatch rejection, all-absent WAIT,
and post-acknowledgement GET auth failure recovery.

## M2 real integrated acceptance — still required

1. Pin jointly approved Backend/Flex SHAs and run real API/database/runtime. Check
   the four availability-aware bridge operations; do not bypass 503 or strip metadata.
2. Start base / seed 990000001 / policy / corrective / wait / continuous true.
   Disable auto-approve and pause-on-failure as needed for reproducible inspection.
3. Select idle T1; pause, review three-step absence and confirm. Verify same tick,
   one revision increment, ABSENT marker, free count, event actor/reason and cleared REVIEW.
4. Save/reopen the situation and reload: new session remains paused and preserves
   absolute returnTick, jobs and remaining work. Create M3/C2 incident through the
   existing restored-session flow. Verify actual policy catalogue/dispatch exclude T1.
5. Advance to returnTick: T1 can receive work exactly there; verify one SYSTEM expiry
   event. Separately exercise early return at the same tick and a busy-primary conflict.
   Verify the baseline finishes an existing repair before respecting the same absence.
6. Exercise all-absent WAIT, VIEWER/cross-owner denial, stale revision, same-key lost
   response recovery, rapid machine/session/layout changes and saved-snapshot replay.
7. Capture actual desktop/mobile screenshots/video, service logs and integrated SHAs.
   Update the evidence status only after these pass. Do not call M1 VERIFIED_DONE.

No development DB, migration, environment file, local auth bypass or unrelated
Operations/Incident/Work Order module is changed by this task.
