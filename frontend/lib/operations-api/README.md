# Operations API mock

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
Event streams remain outside this mock's scope and fail explicitly with 501.
Missing preview cases return 404. `/operations`
selects this adapter by default through `NEXT_PUBLIC_OPERATIONS_API_MODE=mock`.
Set that variable to `real` and configure `NEXT_PUBLIC_OPERATIONS_FACTORY_ID`
to run the same page against the authenticated backend endpoints.

Initial plan version is one with a schedule, zero when absent, matching the
backend seed adapter independently of schedule revision. Initial commit metadata
is null. Cases created from Overview use the backend create/decision DTOs and
generated canonical candidates from the shared demo scenario. The simulated
worker advances CREATED to AWAITING_APPROVAL on subsequent reads. APPROVE/REJECT
only record a decision; COMMIT separately publishes the exact approved schedule.
Keys and historical responses are stored in preview receipts and replayed before
head fencing, including when the current version has advanced. A key reused with
different content returns 409. This preview never calculates KPI or validation.

`persist: true` keeps preview cases, receipts and publication in session storage;
the page's default adapter enables it so mock reload preserves workflow state.
Tests use isolated in-memory instances unless persistence is explicitly requested.
Real mode never reads this preview store. See the complete
[workflow and acceptance notes](../../../docs/frontend-live-decision-workflow.md).

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
