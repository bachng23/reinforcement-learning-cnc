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

The web script runs the backend on port `8080` and frontend on port `3000`. The AI script runs the minimal FastAPI service on port `8001`.

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

Regenerate the CNC domain schema after changing Pydantic contracts:

```bash
cd ai_services
uv run python scripts/export_cnc_contracts.py
uv run pytest tests/test_cnc_contracts.py -q
```
