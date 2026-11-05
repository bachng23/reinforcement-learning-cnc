# Integration issue and evidence log

No learned-policy browser defects are asserted before that flow is run.
The items below are observed prerequisites or harness findings, not fabricated
session failures. Session/seed/revision/tick are N/A where execution never started.

## ENV-01 — registered release artifacts unavailable (acceptance blocker)

- Scope: local environment; seed 990000001, base/incident, S/F intended.
- Reproduce: unset JCST_RELEASE_REGISTRY/JCST_PYTHON and run CLI verify.
- Expected: explicit BLOCKED, zero executed seeds, no policy fallback.
- Actual: BLOCKED, zero seeds, browser NOT_RUN. Harness behavior is correct.
- Resolution: supply trusted original S/F registry/checkpoint bundle. Do not train
  replacement checkpoints or use existing synthetic examples as acceptance.

## ENV-02 — Windows checkout changed pinned source line endings (locally resolved)

- Scope: baseline checkout created before the integrated `.gitattributes` update.
- Reproduce: run the source-manifest test on the old CRLF-converted vendor files.
- Actual: `pinned JCST source mismatch`; engine refuses to load.
- Resolution: verify tracked Git blob against the declared hash, confirm the
  working copy differs only by CRLF, then restore the exact tracked bytes.
  No physics, duration, checkpoint or hash manifest was modified.
- Prevention: create future worktrees from the integrated baseline containing
  the vendor attributes; verify source bytes before executing any seed.

## TEST-01 — existing browser completion test checked only one audit (fixed)

- File: `frontend/tests/research-browser/live-factory-flow.spec.ts`.
- Observation from code review: primary audit was asserted, baseline audit was not.
- Change: require both primary and baseline audit status PASS at COMPLETE.
- Execution status: NOT_RUN with registered policy; this is a prepared assertion,
  not evidence that the full episode passed.

## New bug report template

Severity / integrated SHA / session / case-mode-seed / revision / tick / actor role.
List UI steps, expected behavior, actual behavior, sanitized response code and
trace/screenshot/video paths. State whether API + PostgreSQL + registered policy
were real. Assign the relevant Backend or Frontend owner in this document; do not
send external messages or edit their product code without coordination.
