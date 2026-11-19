# Technician availability runtime

Approved [M0](technician-availability-m0.md). Base main `72af5ec`.
Partner Backend `145edb0ce73eddee3bfa881ac26730781c1d5d1f` and Frontend
`42521ad0c923f6b97555f390451bccaef2cbd73b` are needed for real API/UI acceptance.
The runtime branch contains the Python engine, fixtures and optional harness;
the integration branch includes the partner API/UI implementations.

## Runtime and contracts

Bridge `jcst-technicians/1` implements change/command/restore/incident and a
read-only `demo_technician_summary` helper. Backend supplies complete validated
metadata, user IDs and preallocated automatic end IDs. Unknown/invalid calendars
fail closed. Empty/missing metadata retains physical job semantics.

Intervals are absolute [startTick, returnTick), shortened by early endedTick.
Primary busy starts conflict. Both lanes share the calendar; existing baseline
jobs continue, and no absent worker can receive a new start. Boundary completion
precedes expiry and incident handling, which precede policy observation. Expiry
does not increment calendar version; Backend still increments command revision.
User changes clear review/deferral and pause playback without advancing time.

`repair_warnings` derives per-technician ABSENT/BUSY/NOT_QUALIFIED reasons from
physical jobs, positive duration eligibility and the calendar. WAIT remains legal.
Physics occupancy counters do not increase just because a worker is absent.

## Policy and replay limits

Heuristics receive filtered complete action catalogues. S/A/F use the same
checkpoint, weights, feature arrays and action ordering with an intersected
availability mask before argmax. The original idle bits describe jobs; they do
not encode absence or remaining absence duration. No claim is made that the
original learned model was trained for workforce absence.

`availability.compare_from_snapshot(snapshot, policies, max_ticks)` is a bounded
Python callable (1..8 ticks, up to seven unique supported policies). Every policy
forks the exact same primary state/calendar; old lane divergence is not used.
Output `jcst-workforce-comparison/1` includes commonInitialState, workforceVersion,
calendarHash, cacheIdentity, per-policy lane, deltaCost and independent audit.
Learned policies require releases already pinned in the snapshot. Cache identity
covers the whole snapshot, policies and bound. Input is not mutated.
The existing UI correctly requires a common snapshot instead of presenting the
two old lanes as a fair new comparison. This callable is a Backend handoff; no
new public Compare API is introduced here.
Node consumers can call the existing Python bridge with operation
`demo_technician_compare`, protocol `jcst-technicians/1`, snapshot, policies and
maxTicks. Its response is `{protocol, comparison}` with the versioned result above.

Saved-snapshot continuation and retained-transition audit consume the calendar.
Audit checks both physical replay and the filtered catalogue/action. Finite paper
Episode replay through an absence returns DEMO_INTERVENTION_REPLAY_UNSUPPORTED;
engineering counterfactual results must not be attributed to the paper evaluation.

## Reproduce

Use a JCST Python environment with torch and pytest. From the repository root:

```powershell
New-Item -ItemType Directory -Force artifacts | Out-Null
& $env:JCST_PYTHON -m pytest ai_services/tests/test_jcst_availability.py ai_services/tests/test_jcst_situations.py ai_services/tests/test_jcst_inference.py ai_services/tests/test_jcst_research.py -q -p no:cacheprovider --basetemp=artifacts/pytest-workforce-new-run
& $env:JCST_PYTHON scripts/generate-technician-runtime-fixtures.py
& $env:JCST_PYTHON scripts/probe-technician-mask.py
```

The probe and synthetic checkpoint tests establish shape/mask compatibility,
not registered-policy acceptance. Set JCST_TEST_RELEASE_REGISTRY for historical
release regression and JCST_RELEASE_REGISTRY for learned demo sessions when real
trusted releases are available. Missing registries are reported as skips/errors.

For the integrated checkout install backend/frontend dependencies with npm ci.
Use an isolated PostgreSQL DB ending `_test` or `_ci`, never development data:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:PORT/jcst_workforce_test'
$env:JCST_PYTHON = 'C:\path\to\runtime\Scripts\python.exe'
$env:OPERATIONS_BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$env:JCST_TECHNICIAN_ACCEPTANCE = '1'
node scripts/run-jcst-situation-acceptance.js
```

The optional flag adds real workforce API and browser assertions to the existing
snapshot harness. It creates a unique schema and real ENGINEER account, invokes
the real Python bridge and starts Next/Chromium without HTTP interception.
The scenario is base/990000001, corrective/wait, continuous. T1 is absent [0,3),
M3/C2 receives a controlled failure, T2 repairs it in two intervals. Early return
is zero-time. A separate wait/threshold5 case obtains a real busy baseline job.

Evidence is stored under artifacts/situations-real/HEAD/schema with JSON, logs,
screenshots and browser trace. Only executed assertions are marked PASS. Finally
closes owned services/ports and drops only the unique test schema. SIGINT/SIGTERM
abort the run; after forced OS termination recover using the exact schema/PIDs
in evidence rather than resetting any shared database. Run Next suites sequentially.
