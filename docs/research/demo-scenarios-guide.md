# Reproducible engineering demo scenarios

Status: preparation only. The catalogue is **not verified**. The live-observation
baseline is `0dc38d54a4bb2c8ed4d7fe9d55e986757b9ae326`; installed registered
checkpoint runtime remains a prerequisite.
See `demo-scenarios-m0.md` for the proposed schema, fixed criteria and budget.

## Commands

Set `JCST_PYTHON` and `JCST_RELEASE_REGISTRY` explicitly. The selected interpreter
must have the pinned JCST runtime dependencies. No checkpoint or simulator fallback
is used. Run from the repository root (the CLI also resolves its own paths).

```sh
python scripts/jcst-demo-scenarios.py verify --output artifacts/jcst-scenarios/verify-01
python scripts/jcst-demo-scenarios.py search --case base --mode incident \
  --seed-start 990000001 --seed-end 990000016 --controller S \
  --condition DEMO-02 --condition DEMO-03 --max-seeds 16 \
  --max-seconds 300 --per-seed-seconds 120 --max-output-mib 64 \
  --output artifacts/jcst-scenarios/search-01
```

Output must be a new directory. `verification.json` is updated after every seed;
each completed seed has an original runtime trace plus classified event evidence.
It records source SHA/dirty status, runtime versions, release hashes and both
physical replay audits. Ctrl+C stops the owned process and keeps progress.
This CLI is automatic policy acceptance, never evidence of human approval.

No match within the explicit budget is NOT_FOUND_WITHIN_BUDGET. Missing registry
is BLOCKED. Runtime errors/timeouts are recorded as failures, not passes. Do not
describe classifier unit tests as real-engine or browser acceptance.

Verify never silently drops unassigned catalogue entries: they remain in
`unassignedScenarios` and prevent a global VERIFIED result. Use `--condition
DEMO-01 --condition DEMO-04` to explicitly verify just the known-seed candidates.
Stored milestones must match real event type, tick and zero-based target indices.
The output budget applies before trace/evidence writes; operational report space
is reserved. Runtime errors are sanitized to exception categories, not raw
paths, tokens or checkpoint internals. SIGTERM and Ctrl+C preserve progress and
join the owned seed process.

## Presentation preparation

DEMO-01 and DEMO-04 initially use base/incident seed 990000001. The brief's t5/t7
timeline is an observation to reverify, not an asserted result of this checkout.
After verification, copy exact observed milestones/provenance into the catalogue.
Changing an approved action requires re-verifying the timeline.

For each accepted scenario, create a fresh authenticated UI session from the
catalogue input. Inspect the real notification, machine state, pending catalogue,
duration and commitments; approve through the UI and observe remaining ticks and
completion. Preserve event time when reopening historical notices. Record actual
wall-clock time separately from simulator ticks.

Reset by creating a new session in a dedicated test schema; never delete a user's
demo data. No fake notifications may be generated from catalogue milestones.

## Browser acceptance still required

Record PASS/FAIL/NOT_RUN independently for playback speeds/Step/Pause/Resume,
failure pause toggles, drilldown identities, REVIEW freeze, approve/override/WAIT,
auto-approval opt-in, reload recovery, retry/stale/two-client races, runtime/API
failures, owner isolation and COMPLETE boundaries. Include session, seed, revision,
tick, steps, expected/actual and sanitized screenshots/video for each defect.

Run the main flow three times from clean schemas on one committed integration
SHA. At least one run must finish all 64 ticks and preserve both PASS audits.
No overall acceptance claim until these observations actually execute.
