# Operations read mock

`createMockOperationsApiClient({ mode })` implements `OperationsApiClient` for
`getOperationsSnapshot(factoryId)` and `getCurrentSchedule(factoryId)`. It reads
the canonical shared JSON via `createOperationsDemoFixtures()`; no fixture is
copied into the frontend. Every response owns its data.

```ts
import { createMockOperationsApiClient } from "@/lib/operations-api/mock";
import { createOperationsDemoFixtures } from "@/lib/operations-api/fixtures";

const client = createMockOperationsApiClient({ mode: "success" });
const factoryId = createOperationsDemoFixtures().request.factory_snapshot.factory_id;
const snapshot = await client.getOperationsSnapshot(factoryId);
const current = await client.getCurrentSchedule(factoryId);
```

Modes: `success` (default), `empty-schedule` (null schedule and schedule ID, plan
version zero), `unauthorized` (401 / UNAUTHORIZED), `unavailable` (503 /
DB_UNAVAILABLE). Errors use `OperationsApiError` with canonical v3 `ErrorResponse`
payloads, available through `contractError`, matching `backend/workflow` read routes.
Unknown factories return 404. Pre-aborted read signals reject with AbortError.
Decision methods and event streams are outside this read mock's scope and fail
explicitly with 501; they do not simulate successful writes. No pages are wired
to this mock automatically.

The existing HTTP DTOs are retained. Initial plan version is one with a schedule,
zero when absent, matching the backend seed adapter independently of schedule
revision. Commit metadata is null because the fixture has none.

From `frontend`, run `npm test -- tests/operations-api-client.test.ts
tests/operations-api-mock.test.ts` and `npm run typecheck`. Parity tests compare
mock results with independent canonical DTO expectations passed through the HTTP
client, including 401/503 errors. These are client contract tests, not a running
backend or database end-to-end test.

Follow-up branch: `integration/operations-snapshot-flow`, once backend snapshot
and schedule routes, migrations and the seed-plan adapter are ready. That work
must run the canonical seed plan against a demo PostgreSQL target, verify a
second seed does not duplicate records, exercise database → snapshot API → HTTP
client, add factory-scoped reset (preserving other factories and global users),
and document the local development commands.
