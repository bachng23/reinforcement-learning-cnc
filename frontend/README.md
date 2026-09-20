# CNC Research Console

Next.js frontend for the authenticated CNC experiment workflow. The UI includes:

- experiment list with backend-driven pagination and lifecycle counts;
- complete CNC contract v2 create form and Product API policy selection;
- experiment detail with idempotent run, mixed episode states, and polling;
- episode detail with Retry for `FAILED`, Cancel for `PENDING`, current-attempt metadata, historical-attempt switching, partial-result handling, and a direct RUL-distribution visualization;
- Decision Center with a recommendation queue, experiment/machine/severity/status filters, observation and policy context, audit history, and approve/reject/override review modals;
- an Operations contract v3 fixture preview spanning overview, integrated scheduling, recommendation comparison, and agent trace inspection;
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
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
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
- `POST /api/v1/episodes/:id/retry`
- `POST /api/v1/episodes/:id/cancel`

Event and summary requests include `?attempt=<n>` when viewing persisted attempt history. A `409 SUMMARY_NOT_AVAILABLE` response is treated as an expected incomplete state; other conflicts remain visible and trigger a status reconciliation. Create and pagination requests follow `backend/openapi.yaml`. Experiment and episode screens compose the API's separate metadata, event, and summary resources without deriving research values.

## Verify the real workflow

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
5. Cancel a `PENDING` episode and retry a `FAILED` episode. Refresh during either lifecycle and confirm no mutation is repeated automatically.
6. Open an episode with more than one attempt and switch attempts. Confirm event and summary requests use the selected attempt while the displayed lifecycle status remains the current attempt.
7. On a completed episode, inspect its final summary and chronological step records. Confirm every action, outcome, cost, risk value, failure, and RUL probability shown matches the returned payload.
8. Repeat at desktop and mobile widths; tables and RUL plots should scroll within their own containers rather than overlap the page.

The default example configuration uses the real Product API. Set `NEXT_PUBLIC_PRODUCT_API_MODE=mock` only when working without the backend.

## Operations contract v3 fixture preview

Open `/operations` to inspect the first-pass UI skeleton without waiting for backend integration. The four routes are `/operations`, `/operations/schedule`, `/operations/recommendations`, and `/operations/agents`.

The preview reads only `lib/operations/fixtures.ts`. It preserves the v3 contract boundaries: candidate KPIs, health metrics, risk, RUL, costs, and recommendation selection are displayed from supplied fields and are never derived by page components. Human decision controls currently emit and preview contract-shaped approve, modify, or reject requests; they do not call an API. See `../docs/frontend-operations-ia.md` for the information architecture, field mapping, wireframes, known contract gaps, and integration breakdown.

## Decision Center contract and limitations

Open `/decisions` after signing in. Each queue row links to a dedicated `/decisions/:rowId` detail page so review context and actions are no longer rendered below the queue. In mock mode, the page uses in-memory sample-shaped CNC v2 events from `lib/product-api/fixtures.ts` and simulated Maintenance API reviews. In real mode, it reads current-attempt observation and recommendation events from the Product API, then uses these Maintenance API endpoints only when a reviewer confirms an action:

- `POST /api/v1/maintenance/decisions` (idempotently open a review)
- `POST /api/v1/maintenance/decisions/:id/approve`
- `POST /api/v1/maintenance/decisions/:id/reject`
- `POST /api/v1/maintenance/decisions/:id/override`
- `GET /api/v1/maintenance/decisions/:id/history`

The current contract has no read-only decision list or lookup-by-recommendation endpoint. Consequently, the queue is assembled from persisted recommendations, and existing review statuses/history can only be recovered for decision IDs opened in the same browser session. A row marked "Not opened" may already have a decision created elsewhere. Opening a review is never triggered by page load, refresh, or row selection. The backend also does not provide severity, failure risk, or defer consequence in the current CNC v2 payload; real mode displays "Not provided" for those fields. The policy's estimated expected cost is shown as a *joint fleet estimate*, not a computed per-machine cost. No mock values are injected in real mode.
