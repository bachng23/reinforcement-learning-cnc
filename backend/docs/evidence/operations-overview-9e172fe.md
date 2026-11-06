# Overview verification — implementation 9e172fe

- Baseline: `64dc3917033db148515b484ea3f4a3ad0bcebc34`.
- Shared contract: `1b57380bc6aefd98ef0fdb8c997be6eab4d136a0`.
- Tested implementation: `9e172feb03cc13dea3b22cd46c8d381ca39ca7e1`.
- [Draft PR #45](https://github.com/AIVIETNAM-AIO-BachNguyen/reinforcement-learning-cnc/pull/45).
- Executed on 2026-10-21, Windows, PostgreSQL 17. Backend tests used Node 22.13.0;
  backend validator used Python 3.13.12. Combined contract/frontend checks used
  Node 22.22.2 and Python 3.12.13 / Pydantic 2.13.3.

## Results and commands

| Gate | Command (repository root unless specified) | Result |
| --- | --- | --- |
| Backend unit/HTTP | `cd backend && npm test -- --runInBand` | 26 suites, 250 passed; 2 suites / 4 tests skipped by existing configuration |
| Real PostgreSQL/HTTP | `cd backend && npm run test:integration` | 11 suites, 123 passed, no skips; fresh deployment and populated historical upgrade included |
| Domain + HTTP + consumer compatibility | `python scripts/check-contracts.py` with AI environment and frontend dependencies | 49 Python tests; HTTP exporter check; generated domain types check; frontend typecheck; 9 transport tests passed |
| Exporter | `node backend/scripts/export-operations-http-contract.js --check` | PASS |
| Migration history | `MIGRATION_BASE_SHA=64dc3917033db148515b484ea3f4a3ad0bcebc34 node scripts/check-migration-history.js` | PASS; no changed or added migrations |
| Authenticated curl | Curl within live integration fixture; see runbook | HTTP 200; [executed response](operations-overview-9e172fe.json) |

Set `TEST_DATABASE_URL` to a dedicated test database and `OPERATIONS_PYTHON` to a
Python environment containing canonical validation dependencies. The integration
runner creates/drops its own schema; no application database was modified.
`OVERVIEW_EVIDENCE_FILE` optionally captures the real curl response in the
lifecycle test. That fixture factory/UUID is ephemeral and is not a production
navigation target. Contract examples in `backend/examples/operations-overview.json`
are illustrations; the linked evidence JSON is an actual executed response.

The migration regression suite intentionally exercises a duplicate-column failure;
that expected diagnostic in its log is not a failed gate. The populated upgrade
suite verifies original checksums, rows and published schedule/head preservation.

## Verified behavior

- All six machine statuses with absent health measurements; no publication is null.
- Full-factory aggregate oracle over 87 cases, separate modes and persisted
  lifecycle/processing buckets; reserved MODIFIED/CANCELLED remain zero under
  current write guards. Preview limit, UUID/time ties, stale items and sanitized
  projection agree with the paginated list. No artificial agent/health metrics.
- Active ADMIN, granted OPERATOR/VIEWER, inaccessible factory, access revocation,
  inactive user, missing authentication and spoofed role; strict single query.
- Real create, worker success/failure, APPROVE, REJECT and COMMIT update counts;
  worker counts change with unchanged head revision.
- Coordinated HTTP reads paused after head selection while separate transactions
  complete COMMIT, ingest or worker success. Response stays wholly pre-write;
  subsequent read is wholly post-write. No timing-only concurrency assertions.
- S2 observation retains P1's immutable S1 basis. Canonical schema/hash corruption,
  missing validator executable and actual unreachable PostgreSQL connection return
  errors, never empty success.
- Repeated reads preserve case rows/head and create no event, receipt, audit,
  snapshot or publication. Existing publication race/idempotency/rollback tests pass.

## Local logs

Logs are under the isolated checkout `backend/` (ignored runtime files):

| File | SHA-256 |
| --- | --- |
| overview-unit-9e172fe.log | `50e3a18fe2b9c94cfc7feb0d5c95f11ea33a3619c1f13e7b7967958d207d456f` |
| overview-integration-9e172fe.log | `8b48a8642d369096f2d1c02929e1e4261a39dda5a794ec2af45bda8454025bbf` |
| overview-contracts-9e172fe.log | `5c81f49cdaa70cf6a05085510e08f4e3fd3282dd9e38e97567827df24872b61a` |

CI run links and final documentation-only head SHA are recorded in the PR body.
No new index: reuse factory/created_at/id for bounded preview; aggregate in SQL
with a factory predicate and bounded mode/status/processing group result. No
frontend hooks/pages, domain schema, worker lifecycle or write semantics changed.
Health/risk/utilization/history/agent metrics remain unsupported by this endpoint.
