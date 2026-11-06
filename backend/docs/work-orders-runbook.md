# Work Orders deployment and HTTP handoff

Contract: [design/ERD/state machine](work-orders.md), [OpenAPI](../openapi.yaml),
[examples](../examples/work-orders.json). Implementation follows merged contract PR #48; contract-first commit
`a41359fb3a16f4a6e8bf82cc773e4b350f426aff`. Exact migration base:
`f8d94837159ca5fdc1a0f159fc8c28f75e394f7f`; factory access #46 is already merged.
Incident Center contract #49 (`4469b78`) is merged but includes no migration:
combined database upgrade remains pending a real incident migration SHA. WorkOrderSummary and transaction-aware lookup are
available independently; this module does not create incident links.

## Deploy and rollback

1. Back up the product database and record the deployed SHA, migration checksums,
   and factory-access mode. Keep all instances on the same #46 access source.
2. Run `npm ci`, `npx prisma generate`, then `npx prisma migrate deploy` with the
   intended product DATABASE_URL. Only the new `20261022010000_maintenance_work_orders`
   migration is added. Existing publication rows/hashes are not rewritten; no orders
   are backfilled. It adds a unique publication provenance key and four empty tables.
   DDL takes PostgreSQL table locks: use the normal migration window and investigate
   lock waits rather than terminating unrelated sessions. A failed transaction leaves
   no partially installed module; inspect the cause before Prisma migration recovery.
3. Deploy the backend and check an authenticated scoped list. Existing users without
   membership must get the existing scoped 404. Registry-only factories return an
   empty list; creating an order still requires a real current COMMIT publication.
4. Smoke-test one controlled maintenance assignment with an independent manager and
   execution assignee. Verify event sequence, audit pointer and receipt, plus unchanged
   head/schedule hashes. Do not run the synthetic seed below against production.
5. To roll back code, quiesce Work Order mutations and any Incident link consumers,
   allow transactions to drain, then deploy the previous backend. Keep tables,
   constraints, receipts and audit. Do not reverse SQL/drop history or restore old
   environment grants. When re-enabling routes, replay receipts remain historical;
   GET the latest revision before a new command. Follow #46 for any access-mode rollback.

## Isolated two-factory demo

Requires PostgreSQL, Node 22, generated Prisma client and OPERATIONS_PYTHON pointing
to the existing Operations validator environment. The seed refuses non-test databases,
existing schemas and manifest overwrite. It uses authenticated HTTP registry, grants,
case creation, APPROVE and COMMIT, with the trusted worker persistence path providing
the canonical validated recommendation. It is test/demo tooling, not an ingest endpoint.

The following shell examples use Bash, curl and jq (PowerShell can use `curl.exe`).
Use a dedicated test database ending `_test` or `_ci` and a fresh schema suffix:

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/cnc_test?schema=work_order_demo_0123456789abcdef0123456789abcdef'
export JWT_SECRET='local-demo-only-replace-with-random-32-plus-characters'
export WORK_ORDER_DEMO_PASSWORD='local-demo-password-change-me'
export FACTORY_ACCESS_SOURCE=database
export OPERATIONS_PYTHON=/absolute/path/to/operations/python
npx prisma generate
node tests/integration/work-order-demo.js /tmp/work-order-demo.json
export PORT=3001
npm start
```

In a second shell with the same demo password, use the manifest produced above.
MANAGER is ENGINEER; OPERATOR accesses factory A only; OUTSIDER accesses B only;
VIEWER sees both; INACTIVE cannot log in. ADMIN is global. Each factory has its own
real committed maintenance publication and starts with no work orders.

```bash
API=http://localhost:3001/api/v1
MANIFEST=/tmp/work-order-demo.json
login() {
  jq -n --arg username "$(jq -r ".users.$1.username" "$MANIFEST")" \
    --arg password "$WORK_ORDER_DEMO_PASSWORD" '{username:$username,password:$password}' |
    curl --fail-with-body -sS -c "$2" "$API/auth/login" -H 'Content-Type: application/json' --data-binary @-
}
# Login sets the existing HttpOnly pdm_token cookie; no token is returned in JSON.
MANAGER=/tmp/wo-manager.cookies
OPERATOR=/tmp/wo-operator.cookies
login MANAGER "$MANAGER"
login OPERATOR "$OPERATOR"
ASSIGNEE=$(jq -r '.users.OPERATOR.id' "$MANIFEST")
FACTORY=$(jq -r '.factories[0].factory_id' "$MANIFEST")
jq '.factories[0]' "$MANIFEST" > /tmp/wo-create.json
curl --fail-with-body -sS "$API/work-orders" -b "$MANAGER" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-create-1' \
  --data-binary @/tmp/wo-create.json > /tmp/wo.json
ID=$(jq -er '.data.id' /tmp/wo.json)

# Repeating that exact request/key returns the original 201 body with
# Idempotency-Replayed:true. Another body on that key is 409.
command() {
  token=$1; key=$2; input=$3
  revision=$(jq -er '.data.revision' /tmp/wo.json)
  jq --argjson rev "$revision" '. + {expected_revision:$rev}' <<< "$input" |
    curl --fail-with-body -sS "$API/work-orders/$ID/commands" \
      -b "$token" -H 'Content-Type: application/json' \
      -H "Idempotency-Key: $key" --data-binary @- > /tmp/wo-next.json || return
  jq -e '.success == true' /tmp/wo-next.json >/dev/null || return
  cp /tmp/wo-next.json /tmp/wo.json
}
command "$MANAGER" demo-assign "{\"command\":\"ASSIGN\",\"assignee_user_id\":\"$ASSIGNEE\"}"
command "$OPERATOR" demo-accept '{"command":"ACCEPT"}'
command "$OPERATOR" demo-start '{"command":"START"}'
command "$OPERATOR" demo-block '{"command":"BLOCK","reason":"Awaiting safe access"}'
command "$OPERATOR" demo-resume '{"command":"RESUME","reason":"Access confirmed"}'
command "$OPERATOR" demo-complete '{"command":"COMPLETE","report":{"outcome":"SUCCESS","work_performed":"Inspected and replaced tool","result":"Checks passed"}}'
command "$MANAGER" demo-rework '{"command":"REQUEST_REWORK","reason":"Repeat alignment check"}'
command "$OPERATOR" demo-complete-2 '{"command":"COMPLETE","report":{"outcome":"SUCCESS","work_performed":"Repeated alignment check","result":"Within tolerance"}}'
command "$MANAGER" demo-close '{"command":"CLOSE","verification":{"result":"VERIFIED","note":"Independently verified both reports"}}'
curl --fail-with-body -sS "$API/work-orders/$ID/events?after_sequence=0&limit=100" -b "$MANAGER"
curl --fail-with-body -sS --get "$API/work-orders" -b "$MANAGER" \
  --data-urlencode "factory_id=$FACTORY" --data-urlencode 'limit=25'
curl --fail-with-body -sS --get "$API/work-orders/summaries" -b "$MANAGER" \
  --data-urlencode "factory_id=$FACTORY" --data-urlencode "ids=$ID"
```

REASSIGN is a manager command with `assignee_user_id` and nonblank `reason`; only
ASSIGNED/ACCEPTED/BLOCKED allow it. The new user must ACCEPT, then START. Existing
actual start is preserved and CANCEL stays forbidden after any start. STOPPED
completion requires `stop_reason`; CLOSE then requires VERIFIED_STOPPED. Assignment
does not grant membership. If an executing user's access is lost, a manager can MANAGER_HOLD with a reason,
then REASSIGN. For COMPLETED work use independent REASSIGN_FOR_REWORK with a
different eligible assignee and reason. Both preserve reports/start, and the new
assignee must ACCEPT and START. No access regrant or false verification is needed.

After stopping this demo API, drop **only the schema named in this manifest** using
the test database's administrative connection, then remove the manifest. Example for
the exact sample above: `DROP SCHEMA work_order_demo_0123456789abcdef0123456789abcdef CASCADE;`.
Never run a sweep/reset on a shared dev database. The automated integration runner
instead creates a fresh random schema and cleans it on success/failure.

## Consumer semantics and checks

- Each request uses current DB user/access; unauthorized 401, role denied 403,
  inaccessible ID/detail/events 404. Revocation is checked before receipt replay.
- 400: strict input/query/cursor error. 409: WORK_ORDER_REVISION_CONFLICT,
  INVALID_WORK_ORDER_TRANSITION, SOURCE_PLAN_CHANGED, INVALID_WORK_ORDER_SOURCE,
  WORK_ORDER_ORIGIN_EXISTS, ACTIVE_MAINTENANCE_REQUEST_EXISTS, WORK_ORDER_OVERLAP,
  ASSIGNEE_UNAVAILABLE or IDEMPOTENCY_KEY_REUSED. Recovery also uses
  WORK_ORDER_STATE_CONFLICT and WORK_ORDER_INDEPENDENT_VERIFICATION_REQUIRED. DB outage is 503, never fallback.
- Responses are no-store and carry X-Request-Id; errors use the product envelope.
  A timeout is not proof of rollback: retry the same normalized body/key, then GET.
- List sort is created_at DESC/id DESC. Reuse next_cursor with the same actor,
  factory and filters; limit default25/max100. No search. Events are ordered sequence
  pages, default100/max200. Summary lookup accepts up to50 unique IDs and no private
  report/note fields. No inaccessible partial result is returned.
- `overdue` uses planned_end < read_at for nonterminal orders; COMPLETED also has
  waiting_verification=true. Actual elapsed time is not machine downtime/labor.
- Run `npm test -- --runInBand`, `npm run test:integration`,
  `npm run test:operations-planning` with explicit TEST_DATABASE_URL. Full CI uses
  `scripts/check-operations-integration.sh`, plus the Contracts workflow. Preserve
  the final SHA and job URLs as evidence; an older contract-only CI is insufficient.

For the callable Flex lookup, live local seed IDs and cross-module acceptance status, see [completion handoff](work-orders-completion-handoff.md). The optional seed flag `--with-work-orders` explicitly creates two UNASSIGNED orders and captures their real summaries.
