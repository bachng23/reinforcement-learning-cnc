# Multi-Agent Predictive Maintenance and Production Planning Platform

Production-oriented foundation for health-aware CNC production scheduling,
predictive maintenance, heterogeneous-technician dispatch, and auditable
multi-agent decision support.

## Current scope

The repository is intentionally at a contract-first platform baseline:

- `contracts/v2`: canonical CNC tool-replacement research contract.
- `contracts/v3`: canonical operations and multi-agent decision-support contract.
- `ai_services`: Pydantic contract sources plus a minimal FastAPI process.
- `backend`: platform health, authentication, user administration, and the Product API for policy catalogs, experiments, queued episodes, and persisted research results.
- `frontend`: authenticated research console and user administration.
- PostgreSQL 16 is the only infrastructure dependency.

Experiment execution, maintenance review, and decision-center workflows already
exist in the Product API. Integrated production scheduling, multi-agent execution,
and their product visualizations are not implemented yet. Contract v3 defines the
shared service boundary for that next stage before implementation begins.

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
curl http://localhost:5000/api/health
curl -i -c /tmp/cnc-api-cookie.txt \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}' \
  http://localhost:5000/api/v1/auth/login
curl -b /tmp/cnc-api-cookie.txt http://localhost:5000/api/v1/policies
```

Run the automated backend checks from `backend`:

```bash
npm test
```

Run the Product API integration suite against a real PostgreSQL database:

```bash
cd backend
TEST_DATABASE_URL="postgresql://admin:password@localhost:5432/cnc_research_test" npm run test:integration
```

The command creates a uniquely named schema, applies every committed Prisma
migration, runs the API tests serially, and drops only that schema afterward.
The configured PostgreSQL user must be allowed to create and drop schemas.

Start the source services from the repository root:

```bash
bash scripts/dev-web.sh
bash scripts/dev-ai.sh
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:5000/api/health`
- AI API: `http://localhost:8001/health`

See [DEV-LOCAL.md](DEV-LOCAL.md) for the complete workflow,
[contracts/v2/README.md](contracts/v2/README.md) for the research contract, and
[contracts/v3/README.md](contracts/v3/README.md) for the operations/multi-agent
contract boundary.

## Verification

```bash
cd backend && npm test
cd ../frontend && npm run build
cd ../ai_services && uv run pytest -q
```
