# Risk-Aware CNC Tool Replacement Research Platform

Production-oriented software support for experiments on multi-agent CNC cutting-tool replacement under probabilistic remaining useful life and shared spare constraints.

## Current scope

The repository is intentionally at a clean research-platform baseline:

- `contracts/v2`: canonical CNC domain contract and generated JSON Schema.
- `ai_services`: Pydantic contracts plus a minimal FastAPI process.
- `backend`: platform health, authentication, user administration, and the Product API for policy catalogs, experiments, queued episodes, and persisted research results.
- `frontend`: authenticated research console and user administration.
- PostgreSQL 16 is the only infrastructure dependency.

Simulation, M4 adaptation, policy execution, and research visualizations are not implemented yet. Experiment run requests only queue episodes; a separate worker executes them asynchronously. The local web script starts that worker with the backend and frontend.

## Local development

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local

cd backend && npm install && npm run prisma:generate
cd ../frontend && npm install
cd ../ai_services && uv sync
```

Prepare PostgreSQL and its seed data with the commands below.

## Database migration

Start PostgreSQL, generate the Prisma client, and apply every committed migration:

```bash
docker compose up -d postgre_db
cd backend
npm run prisma:generate
npx prisma migrate deploy
```

## Seed data

Set `ADMIN_PASSWORD` in `backend/.env`, then seed the administrator and policy catalog. The seed is safe to run again because catalog records are upserted by their stable keys and versions.

```bash
cd backend
npm run prisma:seed
```

## Product API verification

The Product API contract, including authenticated request and response examples, is documented in [backend/openapi.yaml](backend/openapi.yaml). Worker claiming, lifecycle, retry-history, and event persistence rules are documented in [backend/WORKER-PERSISTENCE.md](backend/WORKER-PERSISTENCE.md). After starting the backend, verify health, authenticate, and query the policy catalog:

```bash
curl http://localhost:8080/api/health
curl -i -c /tmp/cnc-api-cookie.txt \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' \
  http://localhost:8080/api/v1/auth/login
curl -b /tmp/cnc-api-cookie.txt http://localhost:8080/api/v1/policies
```

Run the automated backend checks from `backend`:

```bash
npm test
```

Start the source services from the repository root:

```bash
bash scripts/dev-web.sh
bash scripts/dev-ai.sh
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8080/api/health`
- AI API: `http://localhost:8001/health`

See [DEV-LOCAL.md](DEV-LOCAL.md) for the complete workflow and [contracts/v2/README.md](contracts/v2/README.md) for the research contract boundary.

## Verification

```bash
cd backend && npm test
cd ../frontend && npm run build
cd ../ai_services && uv run pytest -q
```
