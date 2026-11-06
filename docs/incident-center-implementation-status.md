# Incident Center implementation

Milestone: IN_PROGRESS. This is not final acceptance evidence.

- Task: completion brief dated 2026-10-23 (new implementation, not the old contract PR).
- Branch: `backend/incident-center-implementation`.
- Exact base: `ff9a3aeec7d6f3b19e655a326cea214a968764c0` (includes Work Orders #51 and desktop #50).
- Checkout: `incident-center-implementation`; original unfinished checkout remains untouched.
- Incident-owned migration: `20261022020000_factory_incidents`.
- Producer: `work-order-read.service.js::lookupWorkOrderSummaries`, inherited from exact base.
- Policy/evidence: reuse reviewed main modules; no competing lifecycle policy.

## Checks performed during implementation

- 47 policy/evidence/source/Work Order adapter unit tests passed.
- 17 authenticated HTTP/PostgreSQL and populated-upgrade tests passed on isolated schemas,
  including coordinated Incident resolution versus real Work Order cancellation.
- Populated upgrade from exact base passed, preserving a real Work Order,
  publications, memberships and append-only history.
- 234 frontend unit/component tests passed; production build and TypeScript passed.
- Real browser manual and linked planner/Work Order smoke flows passed, with
  desktop screenshots and clean schema/process/port shutdown. These were dirty-tree
  development runs, not final-SHA acceptance.
- Fresh deployment of all 17 migrations, including both modules, passed.
- Test runner dropped its schema after both successful and failed runs.
- These are local intermediate results, not three final-SHA E2E runs.
- Browser negative/navigation smoke passed: stale confirmation, duplicate append/link,
  audited unlink, keyboard confirmation, full-factory counts exceeding the page size,
  disjoint cursor pages, Back/reload and server-side status filters. Cleanup passed.
- Draft implementation PR: https://github.com/AIVIETNAM-AIO-BachNguyen/reinforcement-learning-cnc/pull/54.
- Contracts passed at `f8e69d0`. Operations integration reached the browser stage
  and exposed an existing test's global case/publication counts after the Incident
  suite created records in its separate factory. Assertions now scope those counts
  to the Operations test factory; the corrected full gate still needs verification.
- At `50eb879`, CI completed all three browser runs and cleanup, then rejected
  the Incident cross-reset fingerprint. The new test incorrectly compared only
  the recommended strategy across different case IDs (which affect simulation
  seeds). The correction compares complete packages on exact-request replay and
  all physical candidate plans across resets. Final checks must restart on the
  corrected SHA. Local runs 1 and 2 passed; run 3 was interrupted and is not passed.

## Still pending

Final negative/concurrency/browser recovery audit; three clean-schema browser
runs at the final SHA and final CI gates. See [demo runbook](incident-center-demo-runbook.md).

## Targeted local API check

Use an explicitly supplied disposable `TEST_DATABASE_URL`, never development DB.
Set `OPERATIONS_PYTHON` to the environment containing the Operations validator.
Set `OPERATIONS_SCHEMA_JOURNAL` to a writable artifact file for interrupted-run cleanup.

```sh
cd backend
node tests/integration/run-integration-tests.js --incidents
# Recovery after an interrupted runner, with the same explicit URL and journal:
node tests/integration/run-integration-tests.js --cleanup
```

Normal integration runs (without `--incidents`) still include all integration tests.
No skip, unavailable dependency, or unexecuted assertion counts as passed.
