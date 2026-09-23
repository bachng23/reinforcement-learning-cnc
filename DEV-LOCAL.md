# Local Development

## Prerequisites

- Node.js 22 and npm
- Python 3.12 and `uv`
- PostgreSQL 16, through Docker or a local service

## Environment

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Local placeholders are suitable only for development. Replace `JWT_SECRET`, `ADMIN_PASSWORD`, and database credentials outside a local machine.

## PostgreSQL

With Docker:

```bash
bash scripts/dev-infra.sh
```

With Homebrew:

```bash
brew services start postgresql@16
createdb cnc_research
```

Apply the schema and create the administrator:

```bash
cd backend
npm run prisma:generate
npx prisma migrate deploy
npm run prisma:seed
```

## Dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
cd ../ai_services && uv sync
```

## Run

Use separate terminals from the repository root:

```bash
bash scripts/dev-web.sh
bash scripts/dev-ai.sh
```

The web script runs the backend on port `5000`, the episode worker, and the frontend on port `3000`. The worker must remain running for queued episodes to progress from `PENDING` to a terminal status. The AI script runs the minimal FastAPI service on port `8001`.

Check all processes:

```bash
bash scripts/check-dev.sh
```

## Tests

```bash
cd backend && npm test
cd ../frontend && npm run build
cd ../ai_services && uv run pytest -q
```

Use a dedicated PostgreSQL database for the Product API integration suite. The
runner creates and drops an isolated schema; it never resets the configured
database or its `public` schema.

```bash
cd backend
TEST_DATABASE_URL="postgresql://admin:password@localhost:5432/cnc_research_test" npm run test:integration
```

Regenerate the CNC domain schema after changing Pydantic contracts:

```bash
cd ai_services
uv run python scripts/export_cnc_contracts.py
uv run pytest tests/test_cnc_contracts.py -q
```
# Operations v3 contract workflow

## Full Operations integration gate

CI runs `.github/workflows/operations-integration.yml` on PR changes under backend,
frontend, ai_services, contracts, scripts or that workflow, and on matching main
pushes. It uses a disposable PostgreSQL 16 service on a GitHub-hosted Ubuntu
runner; no developer Docker daemon, database or GitHub secrets are used.

Equivalent local command (Bash, Node 22.22.2+ in the 22 release line, Python 3.12,
uv 0.10.11, and a Docker builder available locally or through DOCKER_HOST):

```bash
MIGRATION_BASE_SHA="$(git rev-parse origin/main)" TEST_DATABASE_URL='postgresql://test_user:test_password@127.0.0.1:5432/operations_test?schema=public' bash scripts/check-operations-integration.sh
```

Provision a dedicated PostgreSQL 16 test database first. The gate requires an
explicit TEST_DATABASE_URL with a database name ending in `_test` or `_ci`; it
never starts PostgreSQL, creates/drops a database, or uses a development URL as
a fallback. The test role must be able to create/drop schemas and own tables.
Only test JWT/factory-access values are used. The Docker step builds the image;
it does not run application or database containers.

The gate first checks that every migration file already present at the base SHA
is unchanged (including deletions, renames and the migration lock file). Add a new
migration directory for schema changes; failures list the offending files.
CI uses `github.event.pull_request.base.sha` for PRs and `github.event.before`
for main pushes, with full Git history fetched. It never substitutes a moving
branch or a hard-coded revision. Local checks use committed candidate `HEAD`;
commit your migrations and fetch `origin/main` before running them.

After backend dependency installation, migration checks materialize Prisma files
from the exact base and candidate commits into temporary directories. A fresh
schema runs all candidate migrations. A second schema runs base migrations,
then candidate migrations against that existing history, without reset or
`db push`. This catches upgrades such as adding a column that already exists,
even when a rewritten history could pass on a fresh database. Both schemas use
the cleanup journal described below. PostgreSQL regression tests also reproduce
the fresh-pass/upgrade-fail case using disposable synthetic Git histories.

Run just these checks from the repository root (after backend `npm ci`):

```powershell
$env:MIGRATION_BASE_SHA = git rev-parse origin/main
$env:TEST_DATABASE_URL = 'postgresql://test_user:test_password@127.0.0.1:5432/operations_test?schema=public'
node scripts/check-migration-history.js
node scripts/check-migration-paths.js
```

The remaining fail-fast order is locked npm/uv installation and Prisma generation, canonical
contract check, backend unit tests, PostgreSQL integration, frontend generated
types/typecheck/full tests, snapshot E2E, production frontend build and backend
Docker build. The full gate does not skip integration suites. Contract checks
also exercise the wire client as part of the existing shared contract gate.

Each database suite migrates into a new random `product_api_it_*` schema and
cleans it in `finally`, including test/migration failures. A journal records only
schemas created by this run and a hash of the explicit target URL (no plaintext
credentials). The shell exit trap and CI `always()` step retry recorded cleanup
after interruption. Cleanup refuses mismatched targets or arbitrary schema
names. Hard-killed CI jobs additionally lose their disposable service container.
If a local process is force-killed or the database is unavailable, retain the
journal path printed at startup and retry after restoring connectivity:

```bash
TEST_DATABASE_URL='postgresql://test_user:test_password@127.0.0.1:5432/operations_test?schema=public' OPERATIONS_SCHEMA_JOURNAL='/path/from/gate' node backend/tests/integration/run-integration-tests.js --cleanup
```

The Dockerfile explicitly requires `backend/scripts/validate-operations.py` and
runs a no-database smoke check of the packaged validator and canonical seed plan.
Missing Python code or runtime dependencies fail the build. A Dockerfile-specific
ignore file excludes local environments, dependencies and credentials from its
root build context.

## Contract-only commands

From the repository root (Node 22.22.2+ and uv):

```sh
npm ci --prefix frontend
uv sync --frozen --group dev --project ai_services
uv run --frozen --project ai_services python scripts/check-contracts.py
```

After intentionally changing Pydantic models:

```sh
uv run --frozen --project ai_services python ai_services/scripts/export_operations_contracts.py
npm --prefix frontend run contracts:generate
uv run --frozen --project ai_services python scripts/check-contracts.py
```

Commit both schema JSON and `frontend/types/generated/operations.ts`. The gate
exports to a temporary file, compares schema structure, runs AI v2/v3 and shared
fixture tests, checks generated TS drift, typechecks frontend and tests the new
client. It never repairs stale committed artifacts. CI runs the same command in
`.github/workflows/contracts.yml`.

Shared fixtures and the Week 2 seed/reset plan are documented in
`contracts/v3/fixtures/README.md`. The wire client is
`frontend/lib/operations-api/client.ts`; its injectable transport uses the six
`/api/v1` operations routes. Snapshot and current-schedule reads are implemented
with `{ success: true, data, meta }` envelopes and canonical v3 ErrorResponse
failures. Decision workflow endpoints remain separate work. Frontend types do
not validate JSON or domain invariants at runtime. Existing UI view-model types
in `frontend/types/operations.ts` are separate from generated wire types.

## Operations snapshot demo and integration flow

Requires PostgreSQL 16, Node 22.22.2+ and Python 3.12+ with Pydantic. From the
repository root in PowerShell:

```powershell
npm.cmd ci --prefix frontend
npm.cmd ci --prefix backend
uv venv backend/.venv-operations --python 3.12
uv pip install --python backend/.venv-operations/Scripts/python.exe -r backend/scripts/requirements-operations.txt

# Dedicated local demo instance; credentials below are local demo credentials.
docker run --detach --name operations-snapshot-demo `
  -e POSTGRES_USER=operations_demo -e POSTGRES_PASSWORD=operations_demo_local `
  -e POSTGRES_DB=operations_demo -p 127.0.0.1:55433:5432 postgres:16-alpine
docker exec operations-snapshot-demo pg_isready -U operations_demo -d operations_demo

$env:NODE_ENV = 'development'
$env:OPERATIONS_DEMO_DATABASE_URL = 'postgresql://operations_demo:operations_demo_local@127.0.0.1:55433/operations_demo?schema=public'
$env:DATABASE_URL = $env:OPERATIONS_DEMO_DATABASE_URL
Push-Location backend
npm.cmd run prisma:generate
npx.cmd prisma migrate deploy
npm.cmd run operations:seed -- factory-demo-01
npm.cmd run operations:seed -- factory-demo-01 # replayed:true, unchanged rows/head
Pop-Location
```

If the container already exists, use `docker start operations-snapshot-demo`.
Its data remains when stopped; `docker stop operations-snapshot-demo` stops it.
No existing Compose database or volume is reset by these commands.

On machines where Windows Application Control blocks a new venv executable,
use an already permitted Python interpreter: set `OPERATIONS_PYTHON` to its
absolute path, install requirements with `uv pip install --python <path>
--target backend/.venv-operations/Lib/site-packages -r
backend/scripts/requirements-operations.txt`, and set `PYTHONPATH` to that
absolute site-packages directory. Dependencies still stay inside this checkout.
On Unix use `.venv-operations/bin/python` in the normal venv setup.

For authenticated manual API reads, configure the backend JWT secret and normal
user/login setup (`npm run prisma:seed` creates the existing demo users/policies).
ADMIN can read the demo factory; other users need `OPERATIONS_FACTORY_ACCESS`
as described in `backend/docs/operations-context/operations-read-api.md`.
Run the backend with the same DATABASE_URL and Python environment. The HTTP
client reads `/api/v1/operations/snapshot?factory_id=factory-demo-01` and
`/api/v1/schedules/current?factory_id=factory-demo-01`. Frontend pages are unchanged.

End-to-end tests use an automatically created isolated schema, real HTTP listener,
real authentication and the actual TypeScript frontend client:

```powershell
$env:TEST_DATABASE_URL = $env:OPERATIONS_DEMO_DATABASE_URL
npm.cmd --prefix backend run test:operations-flow
npm.cmd --prefix backend run test:integration
npm.cmd --prefix frontend test -- tests/operations-api-client.test.ts tests/operations-api-mock.test.ts
npm.cmd --prefix frontend run typecheck
```

The runner deploys migrations into a random `product_api_it_*` schema and drops
only that schema after testing, including on failure. The suite checks canonical
fixture → seed plan → PostgreSQL → API → frontend client, mock/HTTP DTO parity,
unchanged records on second seed, actual empty schedules, unauthorized reads,
reset isolation, rollback, repeat reset/reseed and restored immutability.
The demo `public` schema remains seeded. Ordinary frontend tests do not run the
database suite or require database credentials.

Reset explicitly removes all snapshots, schedule revisions and head for the
canonical demo factory (including later demo observations), preserving other
factories and all users/research data:

```powershell
$env:NODE_ENV = 'development'
npm.cmd --prefix backend run operations:reset -- factory-demo-01
npm.cmd --prefix backend run operations:seed -- factory-demo-01
```

Reset requires the explicit OPERATIONS_DEMO_DATABASE_URL, matching factory and
database/schema, and a database owner capable of ALTER TABLE. It has no HTTP
endpoint. In one transaction it locks the three operations tables, temporarily
disables only their row immutability triggers, deletes in reverse dependency
order with factory filters, then restores triggers before commit. A failure
rolls back data and trigger changes. Other sessions cannot observe disabled
triggers. Truncate guards and foreign keys stay enabled. Current backend has
no decision/event persistence; if such dependencies are added later, reset must
be extended explicitly (unhandled foreign keys fail and roll back).
