# Leased recommendation persistence

Internal services in `src/services/decision-planning.service.js` accept a Prisma client first, then an object. No worker loop, planner invocation, human decision or schedule publication is added.

```javascript
const lease = await claimDecisionCase(db, {
  caseId, expectedRevision: 1, workerId, leaseSeconds: 120,
});
await persistDecisionRecommendation(db, {
  caseId, expectedRevision: lease.revision, leaseToken: lease.leaseToken,
  recommendation: recommendationPackageV3,
  // Optional producer assertion, using the normalized backend JSON hash:
  expectedContentHash,
});
```

Worker identity, case ID and lease tokens are UUIDs. Claim generates a fresh token; duration is 1–900 seconds, default 120. Claim returns revision, token, expiry and attempt. Tokens are internal and never serialized by public GET APIs. `recordDecisionPlanningFailure(db, {caseId, expectedRevision, leaseToken, errorCode})` accepts only PLANNING_FAILED, PLANNING_TIMEOUT, INVALID_AI_PAYLOAD or PLANNER_UNAVAILABLE. There is no raw exception/message input. `releaseExpiredDecisionCaseLease(db, {caseId, expectedRevision, leaseToken})` requires the exact expired ownership and revision; it cannot cancel a live lease.

## State and concurrency

| Operation | From | To | Revision/attempt |
| --- | --- | --- | --- |
| Claim | CREATED or FAILED, no lease | ANALYZING | revision +1, attempt +1 |
| Persist | ANALYZING | GENERATING → VALIDATING → EXPLAINING → AWAITING_APPROVAL | revision +1 and event per transition |
| Record failure | Any running planning stage with live lease | FAILED | revision +1; lease cleared |
| Release expired lease | Any running planning stage with expired lease | CREATED | revision +1; attempt retained, lease cleared |

Each transaction locks the case row and performs `UPDATE ... WHERE id AND revision AND lease_token`. Claim compares the null prior token; other writes require the exact token. PostgreSQL clock determines lease validity. Revision and token are checked again after semantic validation, which runs outside the transaction against immutable basis data. A competing claim, old revision or stale token cannot overwrite a winner. Duplicate persist requests return 409 rather than silently replacing/replaying an artifact. Uniqueness applies to both case_id and recommendation_id.

Persist validates explicit schema v3, all contract fields, case/snapshot IDs, every candidate (including unselected candidates) through the deterministic canonical semantic validator, and a SHA-256 over normalized JSON. An optional expected hash is compared with that hash. AI-provided VALID verdicts are not trusted without semantic revalidation. The immutable artifact stores UUID, case, recommendation ID, snapshot, version, hash, normalized payload, producer generated_at and database created_at. Candidate KPIs/explanation are contract-validated data; this persistence layer does not rerun simulation or generate explanations.

The validation bridge keeps two separate modes: `recommendation` accepts a raw RecommendationPackage for the planning client; `persisted-recommendation` accepts `{case_id, snapshot, recommendation}` and additionally validates the immutable basis and every candidate's semantics. Both persistence writes and artifact reads use the latter. Changing the planner wire mode to accept a wrapper would break existing planner/CLI callers.

Compatibility verification after rebasing onto PR #30: 230 unit tests passed (4 skipped). The real planning suite passed 24/26 tests, including real planner, alternate snapshot, CLI and retry-503 regressions. Two existing 1.5-second timeout tests failed on Windows because request validation consumed the deadline before HTTP dispatch (0 recorded requests). A local probe of the unchanged main validator took 5.257 seconds, also exceeding that budget. The full Bash gate was attempted with explicit test database and base SHA but stopped at `Missing required tool: node` in WSL; these results do not establish a green full gate. Linux CI must pass before requesting review again.

After the mode split, PostgreSQL integration also passed all 54 tests across 8 suites (exit code 0), including semantic validation of unselected candidates and persisted artifact reads. Schema `product_api_it_8676_32e6e4decc50` was cleaned successfully.

The artifact, all remaining phase transitions and ordered events commit in one transaction. Thus polling sees ANALYZING followed by AWAITING_APPROVAL after persistence, with intermediate phase transitions available in durable history; those intermediate statuses are not claims that HTTP handlers executed agents. An event insertion failure rolls everything back. Event sequence is allocated from the per-case maximum while holding the case lock, with a unique index as a second fence. Expiry during the transaction also rolls it back. No partial artifact can become readable through this service.

Failure and expiry preserve immutable request/basis data and history. A subsequent claim starts a new attempt with a new token; there is no automatic retry loop. Successful persistence clears the lease and sets processing status SUCCEEDED. DB timestamps avoid JavaScript millisecond truncation causing ordering errors against PostgreSQL microsecond timestamps.

## Reads

`GET /api/v1/decision-cases/{id}/recommendation` uses the existing authentication/factory policy and returns `{success:true,data:{recommendation,snapshot}}`. The snapshot is the case's immutable basis, even after OperationsHead advances. An authorized case without an artifact returns 404 RECOMMENDATION_NOT_READY; missing/inaccessible cases both return 404 DECISION_CASE_NOT_FOUND. Stored hashes and schema/candidate semantics are checked on read.

The existing status DTO stays exactly `DecisionCaseStatusResponse`, now with real updated_at, recommendation_id after success and safe error_code after failure. `meta.processing` adds status, attempt and error_code. Initial POST receipts remain immutable and continue returning the original response on replay. Events allowlist only transition statuses and revision, and label internal worker events SYSTEM; lease tokens and raw errors never enter public metadata/history.

## Migration

Only `20260925000000_decision_recommendation_persistence` is appended. It backfills updated_at from existing created_at, defaults existing CREATED rows to PENDING/attempt 0, adds lease fields and the artifact table, and replaces the case update guard while retaining immutable basis/request/actor fields and delete/truncate guards. Events, receipts and artifacts remain immutable. The case guard requires revision increments and valid transitions/lease ownership. Foreign keys tie artifacts to the exact case and snapshot. Extending states or human decisions will require a separate migration.

Tests cover competing claims, stale revision/token, live/expired lease release, retry attempts, invalid and unselected candidates, producer hash mismatch, duplicate recommendations, event-failure rollback, unauthorized reads, immutable artifacts, full ordered lifecycle and upgrade of a populated pre-lease CREATED case.

Verified locally on 2026-09-25: `npm test -- --runInBand` passed 222 tests (4 existing skipped), and `npm run test:integration` passed 54 tests across 8 suites with exit code 0. All 8 migrations deployed in isolated PostgreSQL schema `product_api_it_16188_56feb2ee2f54`, which was cleaned successfully afterward. Upgrade coverage preserves the old case and CASE_CREATED event, backfills processing metadata and successfully claims that case after upgrade. OpenAPI canonical-schema checks and `git diff --check` passed. No historical migration, frontend or AI-service source was changed.
