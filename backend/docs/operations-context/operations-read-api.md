# Operations Context read API (implemented slice)

This slice persists exactly three models: FactorySnapshot, OperationSchedule, OperationsHead. It does not implement Decision Case, approval, execution or schedule commit. Existing research and maintenance APIs are unchanged.

## Canonical source and setup

Source: `scripts/demo-seed-plan.py` at repository root, consuming `contracts/v3/fixtures/demo-health-alert.json` and `demo-case-status.json`. The adapter runs this script with `seed`, validates its plan with the canonical Pydantic models in `ai_services/domain/operations/contracts.py`, verifies `fixture_sha256`, and checks entity steps agree with the validated run request. It persists machines, nested capabilities, jobs/operations, technicians/skills, maintenance and health records inside the immutable snapshot JSON. Current assignments remain in schedule JSON. `decision_cases` is deliberately ignored; reset is unsupported.

Backend needs Node dependencies plus Python 3.12+ and Pydantic. The bridge reuses canonical reference/uniqueness/time-window validators rather than maintaining a second handwritten domain schema in JavaScript. HTTP reads invoke that local validator (15-second timeout, bounded 4 MiB output, no shell/network). This is a correctness-first implementation for the demo; repeated validation can later be cached by immutable content hash. Missing/broken validator returns 503, never fixture fallback.

PowerShell, from backend:

```powershell
npm.cmd install
uv venv .venv-operations
uv pip install --python .venv-operations/Scripts/python.exe -r scripts/requirements-operations.txt
npm.cmd run prisma:generate
npx.cmd prisma migrate deploy

# Explicitly choose the demo DB. This URL must target the intended development database.
$env:NODE_ENV = 'development'
$env:OPERATIONS_DEMO_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:5433/cnc_research?schema=public'
npm.cmd run operations:seed -- factory-demo-01
```

Alternatively configure `OPERATIONS_PYTHON` as the executable path of an environment with Pydantic installed. On Unix the auto-detected venv executable is `.venv-operations/bin/python`. Seed refuses production/unspecified NODE_ENV and has no fallback from OPERATIONS_DEMO_DATABASE_URL to DATABASE_URL. Existing normal `prisma:seed` still creates users/policies; this new command does not create or reset users.

Successful output identifies `factory-demo-01`, `snapshot-demo-20260922-0800`, six machines and hashes. Replaying unchanged seed succeeds without modifying timestamps/head. Conflicting stable IDs/content or a different current head return OPERATIONS_SEED_CONFLICT and roll back; no destructive reset or forced overwrite is implemented. Concurrent same-factory seed runs serialize via a transaction-scoped advisory lock. New live head writers are outside this PR and must use their own coordinated revision checks.

## Read endpoints and client use

- `GET /api/v1/operations/snapshot?factory_id=factory-demo-01`
- `GET /api/v1/schedules/current?factory_id=factory-demo-01`

Authentication: existing httpOnly cookie or Bearer JWT, verified against an active database User. ADMIN can read all factories. Other roles, including VIEWER, need their user UUID explicitly listed in server-side `OPERATIONS_FACTORY_ACCESS`:

```dotenv
OPERATIONS_FACTORY_ACCESS={"factory-demo-01":["actual-database-user-uuid"]}
```

No client-supplied factory or JWT role claim grants access. Missing and inaccessible factories both return 404. This configuration-backed allowlist is the minimal factory scope without introducing a fourth membership model; persisted memberships can replace it later. Missing configuration denies non-admin access; malformed configuration returns 503. Restart API after changing grants.

Browser/API client after normal login:

```javascript
const origin = 'http://localhost:5000';
async function readOperations(path) {
  const response = await fetch(`${origin}/api/v1/${path}?factory_id=factory-demo-01`, {
    credentials: 'include',
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.code}: ${body.message}`);
  return body;
}
const snapshot = await readOperations('operations/snapshot');
console.log(snapshot.data.machines.length); // 6, from PostgreSQL
const current = await readOperations('schedules/current');
console.log(current.data?.assignments);
```

Success is `{success:true,data:<canonical payload>,meta:{factory_id,snapshot_id,schema_version,snapshot_hash,schedule_hash,schedule_revision,head_revision}}`. FactorySnapshot.data carries schema_version 3.0; Schedule is a nested v3 model without that field, so its version lives in meta and persistence. A known factory with no current schedule returns 200/data:null and null schedule hash/revision. Both reads are no-store and load the head and its relations in a repeatable-read transaction; separate requests may observe different heads, so clients compare metadata if they need a joint view.

Errors on these routes use canonical v3 ErrorResponse (`schema_version,error_id,code,message,correlation_id,retryable,details`). Unknown query parameters, invalid/missing factory IDs → 400; unauthenticated → 401; unknown/inaccessible → 404; corrupted persisted content → 500 OPERATIONS_INTEGRITY_ERROR; unavailable database/validator → 503. Other routes retain their existing error format. OpenAPI embeds the relevant generated v3 schema definitions; contract changes must regenerate/reconcile them.

Frontend UI fixture replacement is not part of this backend slice. The browser/API example and integration HTTP client read real persisted data; existing UI screens may still import fixtures until their client is wired to these routes.

## Integrity and immutability

- Source plan hash uses the producer's Python `json.dumps(sort_keys=True,separators=(',', ':'))` over the Pydantic-normalized RunDecisionCaseRequest, including Python's numeric/Unicode encoding. Verify it in Python; do not compare it with the per-record hashes.
- Record hash algorithm `operations-json-sha256-v1`: Pydantic model_dump(mode=json), transported through JSON to JavaScript; recursively sort object keys by JS UTF-16 sort, preserve array order, JSON.stringify scalar strings/finite numbers, UTF-8 encode without whitespace, SHA-256 lowercase hex. Hash the entire snapshot or schedule payload, excluding DB timestamps and hash columns. This is an explicit local algorithm, not a claim of RFC 8785 conformance.
- Persist the normalized payload and hash in the same transaction. Reads recompute hashes, revalidate canonical schema and compare IDs/schema/timestamps and current schedule content against snapshot.current_schedule. Invalid version/hash fails closed.
- Composite keys preserve canonical string IDs and schedule revision: snapshot `(factory_id,snapshot_id)`, schedule `(factory_id,schedule_id,revision)`. Composite FKs fence factory and snapshot relationships for current head. Schedule FK carries the same basis snapshot as the head.
- PostgreSQL triggers reject UPDATE, DELETE and TRUNCATE of snapshots/schedules; FKs use RESTRICT. Revisions require new records. Head is the only mutable pointer. Schema owners/superusers can disable DB protections; use a non-owner runtime role in deployment. Hash checking detects accidental content drift, not malicious rewriting by a privileged DB owner.

## Verification

```powershell
npm.cmd test -- --runInBand
# TEST_DATABASE_URL must point to a dedicated test database (not the demo database).
npm.cmd run test:integration
```

The shared integration runner creates/deploys/drops an isolated schema. Operations tests exercise real HTTP+authentication+Prisma+PostgreSQL: concurrent/idempotent canonical seed, six-machine reads, VIEWER scope, unknown factory, invalid schema/source hash/references, stored hash/schema corruption, null schedule, cross-factory FKs, immutability and no head reset. No immutable-row triggers are disabled for cleanup.

The working checkout already had a merge in progress in README.md and two older design documents. This implementation does not resolve or commit those unrelated conflicts. The older design drafts are not the authoritative contract for these implemented read endpoints.
