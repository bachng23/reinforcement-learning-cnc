# Snapshot and controlled-incident runtime

Approved contract: [M0](situation-runtime-m0.md). The implementation uses the
existing JCST physics engine and policies. It does not modify vendor physics,
natural random draws, the baseline lane or application persistence rules.

## Runtime checks

From the repository root, with the JCST Python environment installed:

```powershell
& $env:JCST_PYTHON -m pytest ai_services/tests/test_jcst_situations.py ai_services/tests/test_jcst_research.py ai_services/tests/test_jcst_inference.py -q -p no:cacheprovider
& $env:JCST_PYTHON scripts/generate-situation-runtime-fixtures.py
```

The generated fixture is `ai_services/tests/fixtures/jcst-situations-runtime.json`.
It contains real base/990000001 corrective-versus-wait states: healthy, REVIEW,
repair with one interval remaining, and completed. Fixtures document the wire
contract; the real-service harness does not substitute them for runtime output.

Tests cover exact continuation, both lanes, review preservation/conflicts,
at-most-once incidents, overlapping targets, busy/failed skips, natural uniforms,
completion-before-injection ordering, invalid snapshots/releases, finite replay
rejection, and continuation after the 256-record trace window has rolled over.

Registered-checkpoint regression tests require `JCST_RELEASE_REGISTRY` pointing
to real registered releases. Skipped tests are not evidence of learned-policy
acceptance. The integrated scenarios below use the supported heuristic policy.

## Integrated real-service acceptance

Run on an integration checkout containing all three implementations. The tested
partner commits are Backend `be8b299c4169eeb8e2d7bb8c6c2d13a24b43607e` and
Frontend `3a56317991fb1840c0804eac2be2dc17d45227bf`.
Install dependencies with `npm ci` in `backend` and `frontend`. Use an isolated
PostgreSQL database whose name ends in `_test` or `_ci`; never a development DB.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:PORT/jcst_situations_test'
$env:JCST_PYTHON = 'C:\path\to\jcst-runtime\Scripts\python.exe'
# Optional installed Chromium/Edge; otherwise install Playwright Chromium.
$env:OPERATIONS_BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node scripts/run-jcst-situation-acceptance.js
```

The command migrates a unique test schema, creates an ENGINEER account, starts
the real API and Next server on temporary ports, and opens real Chromium. There
is no API interception or bridge double. A six-minute deadline bounds the run.
Run suites using Next sequentially; the harness temporarily uses a separate
build directory and restores Next's generated configuration afterward.

Assertions exercise healthy replay, immediate injection, health provenance,
receipt replay, REVIEW conflict/reopen/approval, restored repair completion,
scheduled step/autoplay parity, immutable saved snapshots and GET, and browser
save/open/inject/reload. The browser must display APPLIED after reload and keep
the restored session paused. API work-order evidence references the injected UUID.

Each run writes `artifacts/situations-real/<HEAD SHA>/<schema>/evidence.json`,
HTTP status logs, migration/server logs, screenshots and a Playwright trace.
PASS is recorded only after assertions. Schema deletion and closed service ports
are checked in cleanup. SIGINT/SIGTERM request cancellation and enter cleanup;
an OS-level forced kill cannot execute a process's finally block.

For a forced termination, read the exact schema and ports from evidence.json,
stop only the owned service processes, and drop only that named
`product_api_it_situations_<16 hex digits>` schema in the isolated test database.
Never reset a shared database. An ordinary rerun creates a fresh schema.

## Interpretation and limitations

An injected event uses the Backend UUID and APPLIED/SKIPPED status. Engineering
evidence reports `source: INJECTED`; the health adapter reports the same UUID as
`provenance: CONTROLLED_INCIDENT`. Physics failures retain their original uniform.
Bridge metadata exposes `{physics, injected, total}` without changing the natural
failure counter or charging a synthetic failure cost.

`demo_situation_audit` independently validates retained transitions and injected
boundaries. It reports its retained-interval scope and gaps; it does not certify
discarded historical intervals. The full saved runtime remains authoritative.
Scientific finite replay through interventions returns
`DEMO_INTERVENTION_REPLAY_UNSUPPORTED`. Cross-policy intervention Compare is not
enabled: the unchanged baseline is not a fair post-intervention comparison.

Runtime code is delivered independently of partner DB/API/UI changes. Integration
evidence establishes compatibility at the recorded SHAs, not merge or CI status.
