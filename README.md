# Risk-Aware CNC Tool Replacement Research Platform

Production-oriented software support for experiments on multi-agent CNC cutting-tool replacement under probabilistic remaining useful life and shared spare constraints.

## Current scope

The repository is intentionally at a clean research-platform baseline:

- `contracts/v2`: canonical CNC domain contract and generated JSON Schema.
- `ai_services`: Pydantic contracts plus a minimal FastAPI process.
- `backend`: platform health, authentication, user administration, audit-ready Prisma models, and research persistence schema.
- `frontend`: authenticated research console and user administration.
- PostgreSQL 16 is the only infrastructure dependency.

Simulation, M4 adaptation, policy execution, experiment APIs, and research visualizations are not implemented yet.

## Local development

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local

cd backend && npm install && npm run prisma:generate
cd ../frontend && npm install
cd ../ai_services && uv sync
```

Prepare the database from `backend`:

```bash
npx prisma migrate deploy
npm run prisma:seed
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
