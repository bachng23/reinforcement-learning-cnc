# CNC Research Console

Next.js frontend for the authenticated CNC experiment workflow. The Week 1 UI includes:

- experiment list with backend-driven pagination and lifecycle counts;
- complete CNC contract v2 create form and Product API policy selection;
- experiment detail with idempotent run, mixed episode states, and polling;
- episode detail with partial-result handling, observations, recommendations, selected actions, outcomes, costs, risk values, failures, summary, and a direct RUL-distribution visualization;
- a typed real Product API adapter and an in-memory mock adapter using the same TypeScript models.

The frontend only presents returned research data. It does not predict RUL, derive a point estimate, calculate cost/risk/CVaR/failure probability, choose replacement actions, or reconstruct missing engine output.

## Run

Copy the example environment file, install dependencies, and start the frontend:

```bash
cp .env.local.example .env.local
npm ci
npm run dev
```

The existing authentication flow always uses `NEXT_PUBLIC_API_BASE_URL`. Sign in through `/login`, then open `/experiments`.

### Mock Product API

The mock adapter remains available for isolated UI development:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000
NEXT_PUBLIC_PRODUCT_API_MODE=mock
```

Mock research data lives under `lib/product-api/fixtures.ts`, never inside page components. It supports policy loading, pagination, experiment creation, detail views, mixed episode states, and simulated polling. Authentication is intentionally not mocked.

### Real Product API

Switch only the frontend adapter when the Product API is available:

```dotenv
NEXT_PUBLIC_PRODUCT_API_MODE=real
```

The HTTP adapter uses the authenticated, cookie-based Product API below `NEXT_PUBLIC_API_BASE_URL`:

- `GET /api/v1/policies`
- `GET /api/v1/experiments?page=<n>&limit=<n>`
- `POST /api/v1/experiments`
- `GET /api/v1/experiments/:id`
- `POST /api/v1/experiments/:id/run`
- `GET /api/v1/experiments/:id/episodes`
- `GET /api/v1/episodes/:id`
- `GET /api/v1/episodes/:id/observations`
- `GET /api/v1/episodes/:id/recommendations`
- `GET /api/v1/episodes/:id/results`
- `GET /api/v1/episodes/:id/summary`

Create and pagination requests follow `backend/openapi.yaml`. Experiment and episode screens compose the API's separate metadata, event, and summary resources without deriving research values.

## Verify Week 1

Run all frontend checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Manual workflow:

1. Sign in with the existing authentication flow.
2. Open **Experiments** and verify loading, populated, pagination, and retry behavior.
3. Create an experiment, choose a catalog policy, and verify field validation and duplicate-submit protection.
4. Run the ready experiment and confirm the app polls only while an episode is `PENDING` or `RUNNING`.
5. Open completed, running, failed, and partially persisted episodes.
6. On a completed episode, inspect its final summary and chronological step records. Confirm every action, outcome, cost, risk value, failure, and RUL probability shown matches the returned payload.
7. Repeat at desktop and mobile widths; tables and RUL plots should scroll within their own containers rather than overlap the page.

The default example configuration uses the real Product API. Set `NEXT_PUBLIC_PRODUCT_API_MODE=mock` only when working without the backend.
