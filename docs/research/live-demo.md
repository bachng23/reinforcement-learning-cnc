# Live JCST web demo

The Application now executes simulator transitions and registered policy inference.
It does not use the old Overview fixture. Scientific campaign records remain in
Research, separate from engineering simulation sessions.

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

## Live observation and explicit playback

Open Overview and create a real session, then use Run/Pause/Step and ×1/×2/×5.
New failures pause playback by default. REVIEW waits for an explicit decision;
one in-flight interval may complete after Pause. A reload restores the selected
session/machine/incident, without resuming, approving or posting automatically.
The old timed Auto demo/beat scheduler has been removed from the frontend.
Comparison and AI workflow open only by user navigation.

Factory positions/profile metadata and incident identity/status/timelines are
read through revision-scoped Backend APIs. They never fall back to the previous
hardcoded machine context. Missing legacy layout shows a machine list. Read
markers are local to the browser; the server owns incident lifecycle state.
See [factory monitoring](factory-monitoring.md) for exact base/producer SHAs,
API mapping, verification commands and current dependency gaps.

## Manual presentation walkthrough

- Open `/overview`, select Base, engineering seed `990000001`, and “After first
  failure”. Create simulation and press Run simulator with auto-approval off.
- The real simulator emits failure of M3/C2 at boundary 5. S proposes T1 → M1/C1
  (PM) and T2 → M3/C2 (CM), both with 2 ticks of service.
- Open AI workflow to inspect observation, registered-policy inference, catalogue
  validation and pending review. These are actual completed operations; no LLM
  explanation or independent multi-agent RL reasoning is fabricated.
- Open Decision Center. The simulator is frozen at the pending boundary, even
  after a reload. Inspect compatibility and service durations. Approve & dispatch.
- At boundary 6 both technicians are occupied with one tick remaining. Step once:
  boundary 7 completes both jobs and restores M3/C2. New failures can occur
  elsewhere according to the unchanged simulator; service completion does not
  guarantee that the entire factory stays healthy.
- Open Compare controllers and run with auto-approval. Both lanes advance with
  their respective policy, same seed/configuration and common physical noise.
  The UI shows partial/completed results, H/tail/total costs, failures, unavailable
  machine-ticks, busy-ticks and actual cumulative cost curves.
- New session with “At tick 0” runs policies without the shared incident prelude.
  Use Research → SE1 for the existing multi-root scientific evidence.

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

Historical baseline verification (before the factory-monitoring changes): Computer Use verified session creation, automatic incident detection,
manual dispatch, service completion, reload persistence and the live comparison.
Screenshots are in `docs/design/screenshots/simulator-*.png`.


## Inspect a machine or incident

Click a map machine or a persistent incident notification. The dialog reads the
machine profile and incident evidence from the authorized session at an exact
revision. It shows context origin/version, nullable batch metadata, current
components/commitments and API service history. Historical incident ticks remain
unchanged while machine state describes the current boundary. A resolved incident
does not imply that every machine/component is healthy. Escape closes, restores
focus and releases background scroll. Revision conflict, permission failure,
unavailable service and missing context have explicit states; no fixture profile
is substituted. Requesting a policy/step is a separate explicit command.
