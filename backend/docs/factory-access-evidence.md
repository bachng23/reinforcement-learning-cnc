# Factory access validation and handoff

Draft PR: https://github.com/AIVIETNAM-AIO-BachNguyen/reinforcement-learning-cnc/pull/46

Base: `4c7aae108942a363a4dc4ee40f4ccb81bdfd8a53` (Overview #45 merged).
Contract-first commit: `1d15a8b934dc04e98db7f9bcdd9e179294cf5d09`.
Initial implementation: `c9fb966a245d8530f1f5e7d68474f58cb07e392e`.
The PR records final head SHA and links to both final-head CI runs; passing an
older run is not the release gate.

## Local evidence, 2026-10-21

Windows, Node 22, isolated PostgreSQL 17 test schemas; Python 3.12 for real
FastAPI planning. No development database reset or service interruption.

| Gate | Result |
| --- | --- |
| Full PostgreSQL integration at initial implementation | 141 tests / 13 suites passed |
| Factory HTTP/concurrency/import tests after follow-up fixes | 16 passed |
| Backend unit tests after follow-up fixes | 256 passed, 4 existing skips |
| Real FastAPI planning and Decision Case worker after CLI fixture fix | 37 passed |
| Cross-stack snapshot flow with explicit registry bootstrap | 7 passed |
| Exact-base migration history | Existing migration files unchanged |
| Fresh migration and base-to-head upgrade | Passed; owned schemas removed |
| Populated exact-base upgrade | Passed; snapshots, schedules, S2/P1 basis S1, human record, publication, events and receipts unchanged |
| Inconsistent receipt scope upgrade | Fails atomically; registry creation rolled back and historical rows unchanged |
| Contracts | 49 Python tests, OpenAPI export check, generated types, frontend typecheck and 9 transport tests passed |

The first implementation CI exposed a planning CLI fixture missing the required
database actor ID. The follow-up supplies an actual active ADMIN created in that
isolated test schema. It also checks empty legacy configuration fails closed and
an opaque factory ID named `constructor` cannot resolve an inherited object key.

HTTP tests use signed identities and real database roles, not role claims from
JWT. Coordinated requests use separate PostgreSQL connections and observe a
blocked advisory lock before releasing the winner. Both serialization orders are
checked for create, APPROVE, COMMIT, create receipt replay and COMMIT receipt
replay. A revoke winner denies the waiting write with unchanged Operations
state. User downgrade/deactivation while a write waits is checked again at the
write boundary. No-op membership retries preserve timestamps and audit count.
Injected audit failures roll back both membership mutation and whole imports.

## Reproduce

Use an explicit dedicated `TEST_DATABASE_URL` ending in `_test` or `_ci`, never a
development database. Set `OPERATIONS_PYTHON` to an environment containing the
locked AI dependencies and set `MIGRATION_BASE_SHA` to the full base above.

```sh
node scripts/check-migration-history.js
node scripts/check-migration-paths.js
npm --prefix backend test -- --runInBand
npm --prefix backend run test:integration
npm --prefix backend run test:operations-planning
python scripts/check-contracts.py
```

Linux CI runs `bash scripts/check-operations-integration.sh`, including frontend
regression, browser E2E on three clean schemas, production frontend build and
backend image/validator smoke checks. The workflow owns its PostgreSQL service
and has an always-run schema cleanup step.

## Frontend/Flex handoff

- [Frozen OpenAPI](../openapi.yaml) and [response examples](../examples/factory-access.json).
- [ERD, role matrix, locks, pagination, curl setup, cutover and rollback](factory-access.md).
- `GET /factories` discovers registry-only factories with `has_snapshot=false`.
- In database mode grant factory A only; the same non-admin token sees A but not B.
  Revoke A and repeat read/write/replay: access is denied without changing global role.
- In environment mode membership administration returns 503
  `FACTORY_ACCESS_MODE_MISMATCH`. It never claims a DB grant is effective.
- Import defaults to dry-run; explicit apply creates missing memberships only.
  Revoked conflicts require deliberate administrative review, never automatic regrant.

No frontend source changes, domain schema changes or automatic PR merge.
