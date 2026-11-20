# Technician availability — local verification

Date: 2026-11-19 (Asia/Taipei).
Base: `72af5ecda40833e3c9aaa68f6977f08937fa5814`.
Branch: `feat/jcst-technician-availability` (local implementation, not a CI claim).

| Check | Result |
| --- | --- |
| `npm test -- --runInBand` | 45 suites passed; 396 tests passed, 4 conditional skips |
| `node tests/helpers/run-situations-local.js --technicians` | 4 suites / 45 HTTP+PostgreSQL tests passed |
| Fresh migrations in private PostgreSQL 18 schema | All 23 existing migrations applied |
| OpenAPI references, request DTOs and AVAILABLE/BUSY/ABSENT fixtures | Passed |
| `node scripts/export-jcst-technicians-examples.js --check` | Passed |
| `git diff --check` | Passed |

The test runner created a loopback-only task-owned PostgreSQL cluster, dropped
its owned schema and stopped/removed the cluster. No development DB migration,
seed, service interruption or broad schema cleanup was performed. No schema or
migration change is needed: engineering calendar/events persist inside the
existing DemoSession JSONB, snapshot wrapper and immutable receipt machinery.

Coverage: active/inactive users; ADMIN/ENGINEER writes; VIEWER/OPERATOR denial;
owner isolation; spoofed JWT role ignored; strict body/query/index/duration/reason;
config-sized technician arrays including three technicians; real job BUSY reads;
busy-primary conflict before bridge; baseline existing job preserved; no-time
absence/return with one revision increment; independent interval state; duplicate
absence and non-absent return conflicts; identical and changed-body key retries;
two-client races; REVIEW/pending/deferral invalidation and stale proposal dispatch;
exact preallocated automatic expiry IDs through advance/autoplay/approve/override;
SYSTEM expiry audit versus USER action audit; snapshot reopen with absolute
returnTick and unchanged calendar/hash; changed branch comparison identity;
read purity; bridge errors/malformed output/audit failure rollback; role/revision
changes while runtime executes; calendar removal, missing WAIT and illegal absent
dispatch rejected by runtime-output validation.

## M1 / M2 boundary

Technician operation tests use `tests/helpers/technician-bridge-double.js`, an
explicit M1 protocol double, not physical simulation or planner evidence. Existing
health and work-order HTTP regressions use the pinned real JCST runtime. The
situation regression suite uses its existing contract double.

All fetched remote JCST bridges were searched for availability/absence operations;
none implement the proposed `jcst-technicians/1` protocol. Current main contains
the real snapshot/incident bridge from PR69, which does not enforce absences.
Sessions with calendar metadata therefore never fall back to that bridge for
restore, command or incident execution. Missing support fails with
503 TECHNICIAN_RUNTIME_UNAVAILABLE, without a committed calendar/event/receipt.

Outstanding M2: Flex protocol acceptance/fixtures; actual inference/legal catalogue
and final-dispatch filtering (WAIT remains legal); baseline real-job completion;
exact end-boundary assignments during multi-tick autoplay; availability-aware
restore/replay audit; common-snapshot policy comparison; frontend acceptance of
new origin/cache identity and paused/invalidated review. Existing frontend Compare
is a component calculation, not a backend live-comparison.js cache; frontend/Flex
must honor requiresCommonSnapshot before claiming a new comparison is valid.

Contract, DTO/fixture locations, curl and rollback guidance:
`jcst-technician-availability.md`. The M0 document is a backend proposal pending
partner agreement. Verification was performed locally before commit/push; use the
branch history to identify the delivered commits. These results are not CI results.
