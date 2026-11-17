# Verification — saved situations / controlled incidents

Date: 2026-11-16 (Asia/Taipei).
Working branch: `feat/jcst-snapshots-incidents`.
Exact integration base: `30a27f820e511567f7fad8199f123f75646cd9f3`.
Verification was performed locally before commit/push. These are local test
results, not CI results; use the branch history to identify the delivered commits.

| Check | Result |
| --- | --- |
| `npm test -- --runInBand` | 43 suites passed; 387 tests passed, 4 conditional skips |
| `node tests/helpers/run-situations-local.js --regression` | 4 suites, 30 HTTP/PostgreSQL tests passed |
| Fresh `prisma migrate deploy` | All 23 migrations applied |
| Populated upgrade from exact base | Passed; all original table fingerprints unchanged, old migration checksums unchanged |
| `node node_modules/prisma/build/index.js validate` | Passed |
| Focused runtime/contract tests after health DTO union update | 8 passed |
| `node scripts/export-jcst-situations-examples.js --check` | Passed |
| `git diff --check` | Passed |

PostgreSQL 18 ran on task-owned loopback clusters with isolated schemas. Successful
runs dropped their schemas and stopped/removed their clusters. The initial Windows
pipe/startup diagnostic cluster was stopped; its logs were retained. No developer
DB was migrated/seeded, no existing service stopped, no frontend files changed.

Coverage includes owner/ADMIN reads, ENGINEER/ADMIN writes, VIEWER/OPERATOR denial,
JWT role spoofing, inactive/downgraded users, rechecking role/revision after runtime,
stable pagination with deliberately equal timestamps, malformed/scoped cursors,
strict input, save/open/inject retries including concurrent identical keys,
different-key races, key/body conflict, stale revisions, source trace/policy changes,
REVIEW/in-service/COMPLETE preservation, queue persistence across reopen, immediate
tick preservation, scheduled handling through advance/autoplay/approve/override,
APPLIED/SKIPPED provenance, no-write GETs, immutable DB guards, malformed runtime
output, unavailable runtime and transaction rollback on forced audit insertion error.

## Evidence boundary

The new situation operations use an explicitly labelled M1 bridge double in
PostgreSQL tests. Existing machine-health and work-order regression suites execute
the pinned real JCST runtime. These results do not establish physical intervention
semantics or checkpoint compatibility for the new feature.

Remote fetch and inspection found no implementation of the three new operations
in any remote JCST bridge or the relevant local JCST worktrees. Main also does not
contain the requested `live-comparison.js`. No existing partner branch was merged.

Outstanding M2: obtain/jointly accept the Flex protocol, install the real bridge,
verify restore against pinned engine/config/checkpoints, immediate and scheduled
application at every internal tick, independent reopen after trace eviction,
intervention-aware Compare/decision replay (or explicit unsupported response), and
the joint frontend acceptance case. Current real-runtime requests for open/inject
fail closed with 503 DEMO_SCENARIO_RUNTIME_UNAVAILABLE, without creating a session,
event, receipt or audit. M0 remains a backend proposal until partner acceptance.

Contract, curl and rollout/rollback instructions: `jcst-snapshots-incidents.md`.
