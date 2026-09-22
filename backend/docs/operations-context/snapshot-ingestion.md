# Immutable Operations snapshot ingestion

## Scope and internal interface

`src/services/operations-snapshot.service.js` exports:

```javascript
await ingestFactorySnapshot({
  factoryId: 'factory-demo-01',
  expectedHeadRevision: 1,
  snapshot: canonicalFactorySnapshotV3,
  sourceId: 'simulator-v1',
});
```

This is a trusted internal adapter function, not a public or role-authorizing API. Source adapters must be configured for their permitted factories; the service verifies requested factory and all references through the canonical v3 validator. `sourceId` is a required stable identifier for provenance, not an authenticated human actor. The optional second Prisma client argument exists for dependency injection/isolated tests.

Input identifiers follow v3 syntax; expectedHeadRevision is an integer in [0, 2147483646]. Zero means no head exists. Schema validation and canonical SHA-256 hashing happen before opening a DB transaction. Hashing uses the existing `operations-json-sha256-v1` algorithm after Pydantic normalization; sourceId and DB timestamps are not part of the immutable domain payload hash.

## Successful behavior

| Before | Operation | After |
| --- | --- | --- |
| No head | Ingest S1 with expected revision 0 | S1 persisted; head revision 1; schedule pointers null; planVersion 0 |
| Head S1/P1, revision 1, planVersion 1; P1 basis S1 | Ingest S2 with expected revision 1 | Head S2/P1, revision 2, planVersion 1; P1 basis remains S1 |
| Head S2/P1 | Replay S1 with identical hash | Success/replayed=true; head remains S2/P1 and no rows/timestamps/audits change |

The incoming snapshot's embedded `current_schedule` is observation evidence, not publication authority. It may be null or differ from the published head schedule as long as its references satisfy the v3 contract. Ingestion never creates an OperationSchedule or changes scheduleId, scheduleRevision or planVersion. At bootstrap an embedded schedule is preserved in snapshot JSON but not published; canonical `operations:seed` remains the explicit demo initializer for a published baseline schedule.

Return value includes requested snapshotId/hash, original persisted sourceId, replayed, and the current head's snapshotId/revision/scheduleId/scheduleRevision/planVersion. On historical replay, returned head.snapshotId can differ from snapshotId. Original source provenance wins on replay; a different sourceId with identical content does not alter it or create another audit.

## Transaction and concurrency explanation

1. Validate input and canonical FactorySnapshot v3; reject factory mismatch; compute normalized hash outside the transaction.
2. Begin READ COMMITTED transaction; acquire `pg_advisory_xact_lock(hashtextextended(factoryId, 0))`. This is the same key and transaction-scoped lock as canonical seed. A hash collision only serializes unrelated factories; it cannot mix data because all queries/FKs retain factory IDs.
3. Read existing snapshot key `(factoryId,snapshotId)` and head after obtaining the lock. Existing ID/different hash yields 409 SNAPSHOT_CONTENT_CONFLICT, even if expected head revision is stale. Same ID/hash yields replay before CAS and never republishes an old snapshot. Stored hash is independently recomputed to detect corruption. An impossible orphan snapshot with no head fails rather than silently constructing state.
4. For a new snapshot, compare actual head revision (0 if absent) with expectedHeadRevision. Mismatch returns 409 HEAD_REVISION_CONFLICT with no writes.
5. Insert immutable snapshot plus sourceId. Existing head: `updateMany WHERE factoryId AND revision=expected`, changing only snapshotId and incrementing revision (plus Prisma updatedAt). Zero updated rows rolls back. New head: insert at revision 1, no schedule, planVersion 0. Unique/serialization races become HEAD_REVISION_CONFLICT.
6. Insert AuditLog with action OPERATIONS_SNAPSHOT_INGESTED, entityType SYSTEM and entityId factoryId. Payload contains sourceId, snapshot ID/hash, previous/new snapshot and head revisions, and retained schedule/version. Existing AuditLog.createdAt is the server timestamp; actorUserId is null for an internal source.
7. Commit snapshot, head and audit together. Any audit/write failure rolls back all changes, including first-head creation. Do not catch an audit failure and return success.

Two distinct snapshots submitted against the same expected revision: one wins, the other returns 409. Two identical snapshots: first writes, second succeeds as replay. Validation/agent computation never holds DB locks. All future head writers must increment revision with CAS and preferably use the same advisory lock; the CAS fences writers that omit the advisory lock but still obey revision semantics. Direct SQL that ignores both protocols is outside this concurrency guarantee. Seed never overwrites a changed head. No automatic retry replaces a caller's expected revision.

## Migration impact

Migration: `20260923000000_operations_snapshot_ingestion`.

- Add nullable FactorySnapshot.sourceId. Historical seed records remain null; no payload/hash/timestamp is rewritten. Existing immutable triggers protect provenance once inserted.
- Keep migration `20260922000000_operations_context` byte-for-byte identical to main. It already defines nonnegative OperationsHead.planVersion and the factory-scoped schedule FK independent of the current snapshot.
- No plan-version addition/backfill or FK replacement: existing publication versions, schedule bases, JSON, hashes and timestamps remain unchanged.
- Only the nullable source_id column and its format constraint are added. PostgreSQL ALTER TABLE takes a table lock; schedule a brief deployment window and regenerate Prisma before restarting processes.

Read API adjustment: snapshot endpoint returns S2 and schedule endpoint returns P1. P1 is validated against its immutable basis S1 rather than S2. Metadata adds `plan_version` and `schedule_basis_snapshot_id`; `snapshot_id` is still the current head observation. A head with no published schedule returns data.schedule:null even if the observation embeds a schedule. Separate GET requests may observe different heads; compare head_revision if combining responses.

## Development-only CLI

From backend with canonical validator dependencies installed (see [read API setup](operations-read-api.md)):

```powershell
npm.cmd run prisma:generate
npx.cmd prisma migrate deploy
$env:NODE_ENV = 'development'
$env:OPERATIONS_DEMO_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:5433/cnc_research?schema=public'

# New factory, exact canonical scenario from scripts/demo-seed-plan.py:
npm.cmd run operations:ingest -- factory-demo-01 0 simulator-v1

# Existing head revision 1; snapshot-s2.json must contain a full valid v3 snapshot
# with a new stable snapshot_id and the same factory_id:
npm.cmd run operations:ingest -- factory-demo-01 1 simulator-v1 snapshot-s2.json
```

The no-file path imports/validates the canonical seed plan but persists no Decision Case. The CLI does not fabricate a new snapshot ID or rewrite timestamps. Replaying the canonical S1 on a seeded database is intentionally a no-op. Production/test NODE_ENV and missing explicit demo URL are refused before connecting; there is no fallback to DATABASE_URL. Service tests still run under NODE_ENV=test using explicit Prisma injection.

## Verification and PR evidence

Run `npm test -- --runInBand` and `npm run test:integration`. The integration runner creates a fresh randomized schema in TEST_DATABASE_URL, applies all migrations and drops only that schema in finally. It does not reset public or disable immutability triggers.

`tests/integration/operations-snapshot.postgres.test.js` covers initial ingestion, S2/P1 with S1 retained, identical historical replay, same-ID content conflict, stale head revision, concurrent first-head and subsequent ingestion, concurrent identical retries, validation before any transaction, cross-factory payload and FK rejection, and injected audit failure for both first and existing heads. Read API regression tests use the same persisted records. Test output/evidence is recorded after running below; a committed schedule is arranged directly only as a test precondition, not via a new approval/commit implementation.

No Decision Case, candidate persistence, approval/commit, public snapshot mutation, SSE or normalized machine/job/technician tables are included.

### Upgrade regression

`tests/integration/operations-upgrade.postgres.test.js` pins main commit `b8f716efff200d3058b17d1c1b7203c3b5da9618`. It deploys that commit's real migrations to a separate randomized PostgreSQL schema, inserts S1/P1 with planVersion 7 and head revision 9, then deploys the branch migrations twice. Assertions cover unchanged historical migration checksums, persisted payloads/schedule/head, nullable historical source_id, and successful S2 ingestion retaining P1 and planVersion 7. The schema and temporary migration files are cleaned in finally. Git history for the pinned baseline must be available in CI (fetch it if using a shallow checkout).

Run with `npm run test:integration`; the suite includes both fresh-schema tests and this populated-main upgrade regression.

### Verified after rebase onto main

- Unit tests: 196 passed, 4 skipped (17 suites passed).
- PostgreSQL integration: 29 passed across 5 suites, including the populated-main upgrade regression.
- Fresh deployment: all 6 migrations applied in isolated schema product_api_it_33136_3ebc20607c18, cleaned successfully.
- Upgrade: deploy from pinned main, then branch deploy and repeated deploy succeeded; historical checksums and S1/P1 data retained, planVersion 7 unchanged, S2 advances head revision 9 to 10.
- The original operations-context migration has no diff against main. CI checks out full history for the pinned baseline.
