# CNC Research Console

Next.js frontend for the authenticated CNC experiment workflow. The Week 1 UI includes:

- experiment list with backend-driven pagination and lifecycle counts;
- complete CNC contract v2 create form and Product API policy selection;
- experiment detail with mixed episode states and polling;
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

The example environment selects the mock adapter:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
NEXT_PUBLIC_PRODUCT_API_MODE=mock
```

Mock research data lives under `lib/product-api/fixtures.ts`, never inside page components. It supports policy loading, pagination, experiment creation, detail views, mixed episode states, and simulated polling. Authentication is intentionally not mocked.

### Real Product API

Switch only the frontend adapter when the Product API is available:

```dotenv
NEXT_PUBLIC_PRODUCT_API_MODE=real
```

The isolated HTTP adapter currently expects authenticated, cookie-based REST endpoints below `NEXT_PUBLIC_API_BASE_URL`:

- `GET /api/v1/policies`
- `GET /api/v1/experiments?page=<n>&page_size=<n>`
- `POST /api/v1/experiments`
- `GET /api/v1/experiments/:id`
- `GET /api/v1/episodes/:id`

These endpoint paths, the create envelope, pagination metadata, Product API resource metadata, and field-error envelope are integration assumptions because CNC contract v2 defines research payloads but not Product API transport DTOs. The API adapter accepts the repository's common `{ data }` envelope and normalizes common snake_case/camelCase persistence aliases. Confirm the canonical wire format with the Product API owner before treating those aliases as a compatibility guarantee.

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
4. Confirm the app redirects to experiment detail and polls only while an episode is `PENDING` or `RUNNING`.
5. Open completed, running, failed, and partially persisted episodes.
6. On a completed episode, inspect its final summary and chronological step records. Confirm every action, outcome, cost, risk value, failure, and RUL probability shown matches the returned payload.
7. Repeat at desktop and mobile widths; tables and RUL plots should scroll within their own containers rather than overlap the page.

The shared end-to-end run against the real Product API and worker still requires their endpoints and an integration environment; no backend changes are part of this frontend deliverable.
