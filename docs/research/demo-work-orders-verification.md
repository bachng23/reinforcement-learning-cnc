# Verification — 2026-11-08

## Latest result — 2026-11-09 (supersedes earlier pending backend checks)

Implementation commit: `0995d3067d70efbeee01ba1d4bc491c138a7ae5f`.
Base: `ddf7a05a2ee3b6f3276241eac698fa3150796203` (latest fetched main).

- Full backend unit suite: 359 passed, 4 skipped; 40 suites passed, 2 skipped.
- PostgreSQL + HTTP + real JCST: 5 passed, including concurrent same-key approvals,
  stable receipt/one work order/one additional audit, rollback, legacy reads and autoplay.
- Migration immutability, fresh install, and base-to-candidate upgrade: PASS using
  `check-migration-paths.js` against the exact committed candidate above.
- Direct Backend 1 parity: PASS, three snapshots / seven linked event references.
- OpenAPI parse and whitespace checks: PASS. Vendor source has no content changes.
- All isolated schemas cleaned; database query returned zero matching test schemas.
  Owned container `jcst-work-orders-test-20261109` removed.

The first concurrent test assertion counted earlier WAIT approvals; corrected to
assert one additional audit relative to its pre-command count. The complete
five-test suite then passed on a new schema. No production code was changed to
make that assertion pass.

Frontend branch `frontend/simulation-incident-workflow` now provides maintenance
presentation, but groups health trace rather than consuming this durable DTO.
Consumer integration and real browser M2 remain pending. Handoff is in
`demo-work-orders-frontend-handoff.md`; DTO declaration is in
`backend/docs/contracts/demo-work-orders.d.ts`. Remote CI is not claimed.

## Earlier verification history

Base main: `2a870810d294de6e0b2515f5ff9a83df4f6dd0f9`.
Branch: `backend/jcst-maintenance-work-orders`. Results apply to the local working
tree, not a committed/pushed candidate SHA. No remote CI result is claimed.

## Executed

- Real simulator fixture generator: PASS. base/990000001/policy/corrective/wait,
  continuous, explicit reviews; no registered learned release or fixture fallback.
  t5 review without an M3 start, t6 T2 on M3/C2 with remaining=1, t7 completion.
- Complete backend Jest suite with explicit OPERATIONS_PYTHON and JCST_PYTHON:
  40 suites passed, 2 skipped; 358 tests passed, 4 skipped, 0 failed.
- New PostgreSQL + HTTP + Python suite: 4 tests passed on a fresh schema. Covers
  real approval, immutable ID through completion, duplicate and stale commands,
  authorization including VIEWER read/forbidden write, strict query validation,
  read-only legacy reconstruction, autoplay and injected audit-write rollback.
- All 22 migrations applied successfully to the fresh test schema. Existing
  migration files were not edited. Base-to-candidate upgrade was not run.
- OpenAPI YAML parsed successfully. `git diff --check` passed.
- Both successful PostgreSQL runs cleaned their schema. A retry blocked by a
  Windows Prisma DLL lock also executed schema cleanup. The final run was
  sequential and passed. Owned container removed after testing.

Initial full Jest execution lacked Python environment variables and failed
runtime-dependent tests; the explicit-runtime rerun above passed. This was an
environment correction, not a skipped failure. Windows checkout had converted
pinned vendor LF bytes to CRLF; exact Git/manifest bytes were restored without
changing vendor content. `.gitattributes` prevents recurrence.

## Not counted as passing

- `ai_services/tests/test_jcst_demo.py`: 11 skipped because no registered learned
  checkpoint registry was provided. The new real built-in-policy integration
  tests above are independent of this checkpoint-gated suite.
- M2 joint Frontend rendering: pending. Backend 1 parity is covered in the follow-up below.
- Remote CI, full PostgreSQL repository suite, browser suite and upgrade path:
  not executed for this working tree.

See `demo-work-orders-runbook.md` for commands and consumer behavior. Storage and
legacy M0 are approved. Do not mark the complete cross-team task accepted yet.

## Follow-up remote check and ID alignment — 2026-11-08

Remote main remains 2a87081. Backend 1 is now available on
`origin/feat/jcst-machine-health` at eff27fef2fec4c770c4a252b9c3dc0200d819466.
Replaced the initial event identity proposal with its published `je1_` base64url
format and regenerated consumer fixtures. The direct check executes that branch's
actual health projector against our three real-engine snapshots: PASS, seven
failure/start/completion references matched. A permanent golden test checks its
t7 fixture identities, including completion's original ordinal 4.

After this change, projector and Research API regression: 2 suites / 30 tests
passed, zero skipped. Earlier PostgreSQL results above predate this ID-format
change; they are not a rerun of the latest tree.

No consumer of the new simulator work-order DTO was found on inspected main,
frontend/live-factory-monitoring, frontend-redesign or codex/fix-simulation-main.
Legacy Operations work orders are a separate feature and cannot satisfy M2.
Frontend joint browser acceptance remains pending.
