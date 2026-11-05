# JCST demo scenarios — M0 proposal

Preparation base: `3359d97a0b2bbef35b9d7ae02fe4200acaa7fb64` (`frontend-redesign`).
Integrated live-observation baseline: `0dc38d54a4bb2c8ed4d7fe9d55e986757b9ae326`
(`frontend/live-factory-monitoring`), which contains Backend `761a452` and the
new live workspace. The task checkout has been fast-forwarded to this baseline.
This establishes a common code baseline, not registered-policy acceptance.

Scope: scripts, tests, catalogue and evidence. Do not modify Node business logic,
Frontend behavior, vendor physics, durations, checkpoints or scientific datasets.
Route integration defects to the relevant owner with reproduction evidence.

## Criteria fixed before searching

- DEMO-01: a real failure is followed by a legal corrective start and matching
  completion. Preserve the decision boundary, legal catalogue, action, free/busy
  jobs and remaining ticks. CLI approvals are always `automatic`; UI acceptance
  must separately demonstrate a real signed-in user's approval.
- DEMO-02: failures of distinct machines separated by **at most 2 ticks**,
  including zero. At the second failure boundary inside the learned policy
  horizon, both components must still need repair. Each can be dispatched
  separately to a shared technician, but no legal matching can dispatch both.
  Record the catalogue and commitments at that boundary.
- DEMO-03: a failed component with at least one compatible busy technician.
  Compatibility means `config.duration[machine][component][technician] > 0`.
  Distinguish `WAIT_REQUIRED`, `FREE_ALTERNATIVE`, and `MACHINE_IN_SERVICE`;
  a longer positive duration never means missing skills. Only WAIT_REQUIRED
  inside the learned policy horizon satisfies the strict resource-shortage demonstration.
- DEMO-04: corrective completion on A followed by failure on a different B
  at the same boundary or later. Preserve both event ticks. UI notice/pause
  behavior requires separate browser evidence, never inference from a trace.

## Initial search budget

Default: 16 seeds, 300 seconds total, 120 seconds per seed, 64 MiB output.
Start by verifying seed 990000001, base/incident, S versus F. Extend only within
the explicit CLI bounds; never scan the entire engineering range by default.
No training, test-set access, statistical comparison or fabricated traces.
An exhausted search with no match is NOT_FOUND_WITHIN_BUDGET; unavailable policy
runtime is BLOCKED, not a successful skip. One seed can satisfy several criteria.

## Catalogue v1 proposal for Frontend review

Top level: schemaVersion, preparationBaseSha, integratedSha, criteria,
searchBudget, scenarios. Each scenario has id/title/case/mode/seed/controller,
verificationStatus, approvalAssumption, milestones, provenance and evidence.
Indices are zero-based; display labels add one. `milestones` are assertions,
never synthetic events. Only VERIFIED entries may be described as verified.
Engine verification and browser acceptance have independent statuses.
Provenance records exact source SHA, dirty-tree state, pinned vendor source,
release IDs/checkpoint hashes, runtime versions and trace SHA256.

## Dependencies and isolated environment

- Backend/Frontend integration baseline is recorded above; final evidence must
  record the task's own committed head including the harness changes.
- Explicit JCST_PYTHON and JCST_RELEASE_REGISTRY containing registered base S/F
  (and generalist S/F if that case is searched). Never commit checkpoint binaries.
- PostgreSQL dedicated database ending in `_test` or `_ci`, unique schema per run.
  Never inherit DATABASE_URL or reset an existing demo session/database.
- Real API, Next.js and Chromium for acceptance; no whole-API mock substitute.

The isolated runtime is installed from `jcst_runtime/uv.lock` and import-tested:
Python 3.12.10, Torch 2.14.0+cpu, NumPy 2.4.4, Pydantic 2.13.3. No registered
checkpoint path is available. Checkpoint artifacts are requested from the user. Acceptance starts only
after those dependencies are resolved; three clean runs must use one integrated
SHA, with at least one full H48+tail16 episode and two PASS replay audits.
