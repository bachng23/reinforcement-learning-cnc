# Primary simulator work orders

## Local checks

Use a dedicated PostgreSQL test database, never a development database. Install
locked backend dependencies with `npm ci --prefix backend`. Install the pinned
Python runtime with `uv sync --frozen --project jcst_runtime --python 3.12`.
Set `JCST_PYTHON` to that runtime's absolute Python executable.

Run from the backend directory:

```sh
npm test -- --runInBand tests/demo-work-orders.test.js
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/jcst_test \
  node tests/integration/run-integration-tests.js --demo-work-orders
```

The integration runner creates a unique `product_api_it_*` schema, migrates it,
starts the HTTP API on an ephemeral port and calls the real Python simulator.
It drops its schema in finally; HTTP server and Prisma close in afterAll. For
interrupted runs, set `OPERATIONS_SCHEMA_JOURNAL` before running, then invoke
`node tests/integration/run-integration-tests.js --cleanup` with the same test
database and journal. CI's PostgreSQL service is disposable. Do not manually
drop unrelated schemas. An interrupted locally owned test container may be
removed by its exact recorded name; never sweep containers by broad patterns.

Both the default PostgreSQL suite and the dedicated `--demo-work-orders` selection
include the new integration tests. Research CI explicitly uses the JCST runtime.

## Consumer demonstration

Create a session with base, seed 990000001, policy mode, corrective primary,
wait baseline, continuous true. Use existing authenticated create/commands API.
Advance without autoApprove; if REVIEW appears, inspect the matching and approve
it explicitly. The initial corrective matching is empty until M3/C2 fails at t5.

Read `/api/v1/research/demo/sessions/{id}/work-orders?machineIndex=2`:

- Before approving t5: no M3 order.
- After approving T2 at t5, snapshot t6: one M3/C2 CM order, remainingTicks=1.
- Approve the next review if needed and reach t7: same workOrderId, COMPLETED,
  completedTick=7, remainingTicks=0. Machine health is independent of this status.

Use response revision to identify the snapshot, tick for simulation time. Multiply
tick differences by stepSeconds only when displaying physical time. Label indexes
with +1. Null means missing evidence, not zero. UNKNOWN is an honest legacy source;
PARTIAL means retained trace cannot establish full history. Do not translate
COMPLETED to 'machine healthy'. Pending/deferred actions belong in Activity.

## Fixtures and handoff

From the repository root, regenerate physical evidence with:

```sh
"$JCST_PYTHON" scripts/generate-demo-work-order-fixtures.py
node scripts/generate-demo-work-order-responses.js
```

`backend/examples/demo-work-orders-trace.json` contains real-engine snapshots.
`backend/examples/demo-work-orders.json` contains three consumer responses; its
UUID/revisions are fixture identities, not a production session receipt.
`backend/research-openapi.yaml` documents the endpoint and complete DTO.

Storage/legacy M0 is approved. Backend 1 event identity parity passed against
eff27fef2fec4c770c4a252b9c3dc0200d819466. Reproduce after fetching that commit with
`node scripts/check-demo-event-parity.js eff27fef2fec4c770c4a252b9c3dc0200d819466`.
Frontend must verify rendering with these responses before M2 can be declared
complete. No Frontend or Operations legacy behavior is changed in this task.
