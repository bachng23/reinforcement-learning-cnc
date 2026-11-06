# Backend completion handoff — API_READY

Owner: Backend. Implementation PR: [#51](https://github.com/AIVIETNAM-AIO-BachNguyen/reinforcement-learning-cnc/pull/51).
Exact base: `f8d94837159ca5fdc1a0f159fc8c28f75e394f7f`; contract dependencies:
#48 `43f125b24295aff1ee215a129acff5815efa6827`, #49
`4469b78e32292d0d3ad17ba37b454f6de4aa4a47`. The PR body pins final tested head/CI.

Status is **API_READY**, not INTEGRATION_READY or VERIFIED_DONE. All twelve commands,
reads, PostgreSQL persistence, recovery and real lookup are implemented. No incident
lifecycle/UI is implemented here. Fetch on 2026-10-24 found no incident implementation
beyond #49's contract/evidence/pure guards; there is no incident migration to combine.
User acknowledgement did not supply another implementation SHA.

## Callable consumer API

```js
const { lookupWorkOrderSummaries } = require('./work-order-read.service');
const result = await db.$transaction(
  tx => lookupWorkOrderSummaries(tx, authenticatedUser, {
    factory_id: factoryId,
    ids: workOrderIds, // unique UUIDs, 1..50, returned in this order
  }),
  { isolationLevel: 'RepeatableRead' },
);
// result = { success:true, data:WorkOrderSummary[], meta:{read_at,timezone:'UTC'} }
```

This is a real DB-backed service using the supplied transaction client and fresh
shared authorization. A consumer link write must first acquire the shared factory
lock, ordered user locks, and authorize its own incident action. Read both objects
inside that transaction and compare **factory_id and machine_id**, not names/current
telemetry. An inaccessible/missing target rejects the whole lookup with scoped 404;
unavailable remains 503, never an empty/closed result. No report/private note fields,
frontend href or fake total is included. Incident link ownership stays with Flex.

## Live local test handoff

[Captured manifest and six authenticated scope checks](evidence/work-order-handoff-20261024.json)
contains actual users, two real COMMIT sources and two explicitly created orders.
This is a live local test capture, not a portable canonical fixture or production ID.

API at handoff: `http://127.0.0.1:51357/api/v1` (loopback on this Windows host).
Database: dedicated `cnc_research_test`, port55483, schema
`work_order_demo_bcec27eeffb84f8888ce7a6388f9f102`. The test data is retained for handoff.
Runtime code: `c96c0d8c4cd9b726754083f5f662f901506d2a09`; subsequent changes add
acceptance tests/seed tooling/documentation, not a different product API.

| Factory | Work Order | Machine | Current state |
| --- | --- | --- | --- |
| wo-aefc2945-e627-467e-a8b5-4f3482f04cc4 | 5a624515-8d9b-4050-80c1-8229ab6f93cb | M03 | UNASSIGNED |
| wo-adf88009-d2c7-41f2-bc49-22cdce0c20f3 | 4209a474-6465-4c28-830e-8f42991adf66 | M03 | UNASSIGNED |

Test-only password for generated users: `work-order-flex-test-password`.
VIEWER username `a6092c60-b9a4-4299-86dc-0ef7677604c4` sees both factories;
OPERATOR `e54b32b2-12a9-4cee-86ae-14b8bcb708d9` sees A only;
OUTSIDER `ec79f46c-909b-45e2-8ff5-2af0b3196ab8` sees B only;
ENGINEER manager `e5851bc0-ca7c-47a2-8baf-4a9d62588cd7` sees both. These are isolated
synthetic credentials, never reuse them outside this test schema.

```bash
API=http://127.0.0.1:51357/api/v1
curl --fail-with-body -sS -c /tmp/wo-viewer.cookies "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"a6092c60-b9a4-4299-86dc-0ef7677604c4","password":"work-order-flex-test-password"}'
curl --fail-with-body -sS -b /tmp/wo-viewer.cookies --get "$API/work-orders/summaries" \
  --data-urlencode 'factory_id=wo-aefc2945-e627-467e-a8b5-4f3482f04cc4' \
  --data-urlencode 'ids=5a624515-8d9b-4050-80c1-8229ab6f93cb'
```

The source publications were created through real HTTP case creation/APPROVE/COMMIT
and trusted validated worker persistence. Creating a publication does not dispatch
orders. Seed tooling explicitly requests orders only with `--with-work-orders`:

```bash
# Set a fresh dedicated test DATABASE_URL/schema and validator environment using
# work-orders-runbook.md. Choose a NEW manifest; the script refuses overwrite.
node tests/integration/work-order-demo.js /tmp/flex-work-orders.json --with-work-orders
```

This creates new IDs and `work_orders` contains actual HTTP WorkOrderSummary DTOs.
Without the flag the existing full curl workflow starts with zero orders. The local
API can be restarted against the retained schema using the same test signing key
`work-order-flex-handoff-test-secret-32-plus` and FACTORY_ACCESS_SOURCE=database;
for a different machine regenerate instead of copying the captured IDs. Never use
the synthetic credential/signing key on a development or production database.

## Evidence and remaining shared acceptance

The completion proof adds real child-process restart/read/event/receipt replay,
inactive-assignee hold/reassignment without reactivation, downgraded-verifier replay
denial, real DB connection failure returning no-store503, and direct transaction-client
lookup. The focused run passed 3 tests; the other 16 tests intentionally deselected
in that run are **not** counted as passes. Full final-head CI is recorded in the PR. A separate real-planner flow test also
passed: authenticated case creation, dedicated worker with real FastAPI planning,
APPROVE/COMMIT, maintenance order execution and independent close. It asserts the
publication/head remain unchanged after execution; no recommendation fixture is
used in that end-to-end test.

Runtime implementation already passed 158 PostgreSQL tests, 308 unit tests and 37
real FastAPI planning tests at c96c0d8, with Contracts/Operations CI green. See
[evidence](work-orders-evidence.md) and [deployment/full workflow](work-orders-runbook.md).

M3/M4 remain pending, with a concrete dependency: a reviewed Flex implementation SHA
containing incident migration `20261022020000_factory_incidents`, API, UI and tests.
The existing remote `codex/factory-incident-center` at 4469b78 has none of those
runtime artifacts. Once supplied:

1. Use a separate integration checkout containing that SHA and #51's final head.
   Integrate shared Prisma/router/OpenAPI/export files sequentially; retain both
   migrations and never edit an applied migration. Record exact integration SHA.
2. Run fresh and populated exact-base upgrades into the **same** isolated schema;
   compare historical hashes/publications/memberships/audit and both module histories.
3. Run real Incident desktop create/ACK/investigate/link, real planner/case/COMMIT and
   Work Order execution/recovery, then independent incident resolve/verify/close and
   reload/restart. An order transition must not auto-close the incident.
4. Assert cross-factory/machine, VIEWER, stale, revoked/inactive, self-verifier,
   idempotency, unavailable, plan-change and rollback failures; preserve S1/P1 source
   under S2/P2. Fix any Backend issue found before marking acceptance complete.
5. Repeat linked E2E on three clean schemas at one SHA, capture desktop screenshots,
   and obtain green final-head CI. Only then report VERIFIED_DONE. The existing
   Operations browser E2E is not relabelled as two-module acceptance.

No external message was sent to Flex and no PR was merged/deployed by this handoff.
