# Live JCST web demo

The Application now executes simulator transitions and registered policy inference.
It does not use the old Overview fixture. Scientific campaign records remain in
Research, separate from engineering simulation sessions.

## Continuous factory operation (November 2026)

New web sessions run continuously (`continuous: true`, policy control from the
start). Automatic confirmation is enabled and incident pausing is off by default;
both remain user controls. Playback runs while the page is open and resumes paused
after reload. The server persists physical state after every command; it does not
run a background simulation when no client is advancing it.

The main clock and floor timeline display a 24-hour calendar. One engine interval
maps to 15 simulated minutes for presentation; this is not a calibrated industrial
cycle time. The start timestamp is persisted. Real component age, keyed failure
randomness, service commitments and costs remain in the JCST engine.

The visible policy selector supports the registered structured PPO (S), ablated
PPO (A), flat PPO (F), and the existing RiskMatching, corrective, threshold-5 and
WAIT controls. Missing registered releases are disabled. Overview and scenario
setup show only Maintenance policy; inline comparison controls and metrics have
been removed. Applying a policy keeps machine conditions and active jobs. The
existing dedicated comparison page remains separate; further comparison design
is deferred. The API still maintains its second lane, using corrective maintenance
(or RiskMatching when corrective is selected) without requiring an Overview choice.

Continuous learned inference presents each observation as a new 48/16 planning
window (time feature zero); it never resets the actual physical transition time
and never replaces learned control with the evaluation tail. This rolling use is
an engineering demonstration, separate from SE1 evidence. Recent records,
workflow and decision entries are bounded at 256; lifetime counters and technician
completion counts remain cumulative. Existing completed sessions can enable
continuous operation without resetting their state.

Finite protocol runs remain available explicitly with `continuous: false`. They
retain 48 learned intervals, 16 RiskMatching tail intervals and independent final
physics audits. The finite walkthrough below describes that protocol and manual
incident-review settings; new live sessions use the continuous defaults above.

## Workshops and Dashboard

`/simulation` replaces the Overview navigation label; `/overview` remains a valid
legacy link. The Workshop selector offers four proposed server-PSU workshops inspired by
LITEON's public product portfolio: SMT board assembly, power-board insertion and
soldering, PSU final assembly, and reliability/pack-out. Twelve electronics
machine categories and PCB/PSU carriers replace the generic machining and bottle
examples. The process proposal, source links and abstraction boundaries are in
`docs/design/liteon-server-psu-workshops.md`. Orthogonal conveyors connect each
workshop's three controlled stations, and technician paths avoid equipment.

Each workshop opens a separate persisted demo session. Browser storage remembers
the session assigned to each workshop, and links include the workshop identifier.
Switching stops playback and restores the destination session paused. The models
are visual manufacturing context over the same three-station, two-component JCST
maintenance physics; process-specific physics and real production counts are not
claimed. First visits initialize dedicated engineering seeds per layout.

`/dashboard` displays lifetime availability, failures, cost and technician
utilization, with explicitly labelled recent-window state/failure charts, cost
breakdown, maintenance mix, component condition and station reliability.
Unavailable machine-time is reconstructed from pre-transition failure state and
actual occupancy events (including dispatch and completion intervals). Component
risk uses the pinned engine's conditional Weibull hazard for the next operating
interval; it is not a learned failure forecast. Station links open the selected
machine in Simulation. Refresh data reads persisted state without advancing it.

## Local setup

1. Apply additive Prisma migrations and regenerate the backend client.
2. Start API and frontend with the existing local setup.
3. Point `JCST_PYTHON` to `jcst_runtime/.venv/bin/python` and
   `JCST_RELEASE_REGISTRY` to the registered SE1 release registry. Both are required
   for this learned-policy demo. Existing research import/replay still has its
   separate controls-only runtime option.
4. Sign in as ENGINEER or ADMIN. VIEWER cannot create or advance sessions.

Registered releases are fixed to `se1-{case}-{S|A|F}-root0-96k`. The runtime validates
source/configuration/catalogue/checkpoint hashes and Torch compatibility. Missing
or incompatible releases fail explicitly rather than replacing learned decisions
with a heuristic. These files are local artifacts, not committed weights.

## Live observation walkthrough

1. Open `/overview`, choose Base / engineering seed `990000001` / “After first
   failure”, then press **Start simulation**. This creates a real session and
   starts single-interval playback. No automatic screen switching or staged
   confirmation occurs.
2. Playback offers ×1 / ×2 / ×5: 2 / 1 / 0.4 seconds of display delay **plus runtime
   computation** per command. These are presentation speeds, not physical time.
   Pause stops scheduling; an in-flight interval can finish. Reload restores the
   persisted trace paused.
3. **Pause on new failure** defaults on. M3/C2 fails at boundary 5 for the seed
   above. Overview stays visible; a clickable incident notification appears.
   Notifications come from primary-lane failure/CM-completion events and retain
   history across reloads. Historical notices open the machine's current state.
4. Click the notification or the machine name. Inspect machine type, line, batch,
   position, failed components and service commitments. Factory context remains
   illustrative and does not alter JCST physics.
5. Click **View dispatch proposal**. This requests the next decision boundary,
   then opens Decision Center. If only WAIT is legal, one interval can advance;
   this is disclosed in the dialog. At boundary 5, S proposes T1 → M1/C1 (PM)
   and T2 → M3/C2 (CM), both taking two ticks.
6. Inspect the proposal, technician compatibility and actual AI workflow.
   **Approve & dispatch** advances one interval and returns to Factory with
   playback running. The checked “Continue simulation and auto-approve subsequent
   policy decisions” option enables automatic confirmation for later decisions;
   uncheck it to keep reviewing every choice. New failures still pause by default.
   Explicit approval/override remains recorded as human; later automatic decisions
   retain their automatic actor. No LLM explanation is fabricated.
7. Boundary 6 shows both technicians occupied with one tick left. Boundary 7
   completes the jobs and restores M3/C2, emitting a completion notification.
   Another machine can fail in the same interval, causing a new pause.
8. Switch to **S vs F comparison** whenever desired. Both lanes advance under
   the same seed/configuration/noise; comparisons during playback are partial.
   Turn off incident pauses and enable auto-approval to run through to completion.
   The final 64-record traces still require independent physical replay.

The bounded `autoplay` API remains available for batch clients, but the live web
playback uses one `advance` command per interval so each state can be observed.

All times are simulator ticks. The dispatch connections show assignments, not
physical travel times. Unavailable machine-ticks include both service and
breakdown. Busy-ticks indicate occupancy, not policy effectiveness.

## Semantics and persistence

`DemoSession` is separate from research campaigns. Creation is idempotent by
owner/key/scenario hash. Every command requires an exact revision; concurrent
commands cannot advance the same boundary twice. Retrying the latest identical
command returns its persisted result. Changed inputs under the same key and stale
revisions are rejected. Commands and audit records commit transactionally.

Human matching overrides are validated by JCST and labelled “S + human override”.
The baseline continues independently; it is not modified to manufacture an
advantage. Original checkpoints and scientific artifacts are unchanged. The
engineering seed range is restricted to 990000000..999999999.

Failure-event uniforms are stored as exact decimal strings in engineering demo
records to avoid JSONB/client floating-point rounding. Replay converts those
strings back to the exact Python float. A bounded legacy-demo transport repair
accepts at most two ULP of drift against the keyed simulator value; materially
changed values fail. Scientific evidence records are never rewritten.

H=48, tail=16. In the tail both lanes use the same fixed RiskMatching rule. At
completion, both 64-record traces pass the independent upstream physical replay
before the final state is saved. A session cannot advance after COMPLETE.

Incident mode shares WAIT until the first failure. This intentional demonstration
prelude is shown in the UI and is not the SE1 evaluation protocol. Comparisons
are single-seed engineering illustrations; either controller can win. No new
statistical claim, training run, confirmation run, or test-set opening occurs.

## Verification commands

```bash
JCST_RELEASE_REGISTRY=/absolute/path/registry.json PYTHONPATH=ai_services \
  jcst_runtime/.venv/bin/python -m pytest ai_services/tests/test_jcst_demo.py -q
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix backend test -- --runInBand
# Explicit isolated test database and Python paths are required for integration:
npm --prefix backend run test:integration
```

Direct Computer Use verified session creation, automatic incident detection,
manual dispatch, service completion, reload persistence and the live comparison.
Historical screenshots are in `docs/design/screenshots/simulator-*.png`.

On 2026-11-03, Computer Use verified the new live observation flow against the
local API: session `917dc0f7-bea2-4897-aba7-7489e1054098` stopped at the real M3/C2
failure (tick 5), notification opened M3 context, requesting the proposal held
tick 5, approval dispatched both technicians at tick 6, and tick 7 completed both
services while a new M2/C2 failure paused playback. Reload retained tick 7 and the
incident history without resuming. Current screenshots:
`live-machine-incident.png` and `live-simulator-notifications.png`.


## Inspect a machine

Click the M1/M2/M3 machine name in the factory cards (also available in the
comparison fleets). The dialog shows illustrative machine type, production
line/sequence, assigned demo batch, product and factory position. These labels
are scenario context and do not enter the learned policy or change physics.
Component condition/age, technician commitments, compatible service durations
and recent physical events are read from the current simulator lane. Escape or
Close dismisses the dialog and restores focus to its trigger.
