# Maintenance Demand–Capacity Coordination Research Platform

Research evidence, learning-curve comparison, component-level replay and copied-state
decision support for [maintenance-capacity-coordination](https://github.com/AIVIETNAM-AIO-BachNguyen/maintenance-capacity-coordination).
The default workspace is `/overview`, with Application first in navigation and Research available below it at `/research`. JCST/1.1 is the physical contract; S/A/F are
centralized PPO actors. The older CNC v2 and Operations v3 modules retain their own
contracts and historical records.

## Interactive web demo

Open `/overview` and press **Auto demo** for a one-click presentation of a real
JCST session: failure, AI workflow, matching proposal, automatic confirmation,
technician service, repair and S/F comparison. Pause/Resume and manual control
remain available. The default local demo took about 23 seconds in verification. Agent Control Room shows actual orchestration events;
Compare controllers runs S/F against the same seed/configuration and displays
actual costs and fleet states. Session state and decisions survive page reloads.
See [demo setup and walkthrough](docs/research/live-demo.md). This engineering
workflow is separate from the scientific results in the Research workspace.

## Research workflow

1. Start PostgreSQL and apply the additive migrations with the commands below.
2. Start the backend API and `npm --prefix backend run research:worker` separately.
3. Start the frontend and sign in as an administrator or engineer.
4. Export a bounded bundle, then upload it at `/research/import`.

```bash
uv sync --frozen --project ai_services
ai_services/.venv/bin/python ai_services/scripts/export_jcst_bundle.py --output /tmp/jcst-engineering.json
```

The engineering exporter runs a bounded reference-control episode and independent
physical replay. It does not train a policy or estimate scientific performance.
The SE1 exporter instead reads existing, explicitly supplied campaign artifacts.

Set `RESEARCH_ARTIFACT_DIR` to the same absolute persistent directory for API and
worker. For learned inference, install the separate `jcst_runtime` environment,
register verified checkpoints and configure `JCST_PYTHON` and
`JCST_RELEASE_REGISTRY`. See [research setup and operations](docs/research/runbook.md).

The [architecture and capability inventory](docs/research/architecture.md),
[migration plan](docs/research-alignment-migration-plan-2026-10-30.md) and
[verification report](docs/research/implementation-report-2026-10-30.md) describe
the implemented boundary and remaining optional integrations.

## Verification of the research domain

```bash
ai_services/.venv/bin/python scripts/check-jcst-contracts.py
ai_services/.venv/bin/python -m pytest ai_services/tests -q
npm --prefix backend test -- --runInBand
npm --prefix frontend test
npm --prefix frontend run build
```

PostgreSQL integration and real browser tests require an explicit dedicated
`TEST_DATABASE_URL`; both use disposable schemas. They never fall back to the
development database. See the runbook for the exact commands.

## Compatibility modules

The following older modules remain available during migration:

- `contracts/v2`: canonical CNC tool-replacement research contract.
- `contracts/v3`: canonical operations and multi-agent decision-support contract.
- `ai_services`: Pydantic contract sources plus a minimal FastAPI process.
- `backend`: platform health, authentication, user administration, and the Product API for policy catalogs, experiments, queued episodes, and persisted research results.
- `frontend`: authenticated research console and user administration.
- PostgreSQL 16 is the only infrastructure dependency.

Their payloads are not JCST observations or scientific JCST results. Legacy CNC
creation/execution is read-only by default in production; set
`LEGACY_RESEARCH_WRITE_ENABLED=true` explicitly to enable it. Legacy history stays
readable. The Operations planner uses a separate simplified model and does not
supply metrics for JCST research.

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
