# Verification report — 2026-11-05

Status: **PREPARATION_COMPLETE / POLICY_ACCEPTANCE_BLOCKED**.

Original brief base: `3359d97a0b2bbef35b9d7ae02fe4200acaa7fb64`.
Integrated preparation base: `0dc38d54a4bb2c8ed4d7fe9d55e986757b9ae326`;
includes Backend `761a452` and Frontend live monitoring. The CLI records exact
task head and dirty-tree status in each output `verification.json`; base SHA
must not be substituted for the tested head. No final acceptance SHA is claimed.

## Completed and executable

- CLI `search` and `verify`, explicit case/mode/controller/conditions, engineering
  seed bounds, per-seed/global time and output limits, incremental atomic progress.
- Automatic approval labelled honestly. Same seed can cover multiple criteria.
- Event-time classification, strict shortage versus free compatible alternatives,
  matching CM start/completion and completion followed by another failure.
- Catalogue input validation and stored milestone checks; missing seeds cannot
  disappear from overall results. No whole-catalogue PASS from two seeded entries.
- Owned process cleanup on cancellation/deadline; existing output cannot be overwritten.
- Catalogue, guide, acceptance matrix and issue log; no manufactured milestones.
- Real browser completion assertion now checks both primary and baseline audits.
- Existing research CI already discovers the added Python tests. No skipped
  registered-policy test is reclassified as a successful gate.

## Local checks

Runtime installed with the existing frozen lockfile, without changing dependencies:
Python 3.12.10 / Torch 2.14.0+cpu / NumPy 2.4.4 / Pydantic 2.13.3.

```powershell
& .\jcst_runtime\.venv\Scripts\python.exe -m pytest `
  ai_services/tests/test_jcst_scenario_cli.py `
  ai_services/tests/test_jcst_scenario_evidence.py `
  ai_services/tests/test_jcst_research.py `
  ai_services/tests/test_jcst_inference.py -q -p no:cacheprovider
```

Result: **41 passed / 0 failed / 1 skipped**. The skip is the explicitly supplied
historical checkpoint parity test. Six passing adapter tests use temporary
initialized weights solely for adapter parity; they are not registered-policy
scenario evidence, training, scientific comparison or a demo fallback.
Classifier tests use labelled synthetic records. Existing research tests include
real physical transitions/replay, but do not prove the S/F learned demo timeline.

Preflight without registered checkpoint registry: **BLOCKED / 0 seeds executed /
browser NOT_RUN**. No database was reset for these checks.

## Registered checkpoint verification

On 2026-11-06, the corrected classifier on the integrated source recorded in
`demo-scenarios.json` verified all four cases across three seed/mode runs with the
original registered S/F releases. Both replay audits passed for each 64-tick run.
The catalogue records the observed milestones, bottleneck, release hashes and
trace hashes. A bounded policy-mode search of seeds 990000001–990000032 found
DEMO-02 at seed 990000019. The old tick-7 false positive from incident seed
990000001 is excluded because the first component is already healthy.

The catalogue is engineering trace evidence. Browser execution and the broader
failure/recovery acceptance matrix are reported separately.
