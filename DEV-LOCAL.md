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
proposed `/api/v1` operations routes from the backend workflow draft. HTTP DTOs
wrap canonical contract payloads in `{ success, data, request_id }` envelopes:
backend still owns snapshot creation, approval validation and command
idempotency. Frontend types do not validate JSON or domain invariants at runtime.
Existing UI view-model types in `frontend/types/operations.ts` are separate from
generated wire types. No UI cutover or live backend endpoints are included in this
skeleton.
