# Maintenance Coordination Research Console

The default route is `/overview`; Application appears first in the sidebar.
Application now uses a persisted JCST simulation session: `/overview` shows the
live factory; `/decisions` reviews and dispatches matching actions; `/agents`
shows actual orchestration events; `/what-if` compares S and F. A `session` URL
parameter keeps all four views on the same backend state. **Auto demo** creates
a new incident session and presents the whole flow automatically, with short
reading pauses and automatic scrolling. Pause/Resume or take Manual control
at any point. For the manual walkthrough, start a new session
with engineering seed `990000001` and incident mode for the failure-to-repair demo.
The isolated learned runtime and registered checkpoints are required; there is
no fixture-policy fallback. Legacy sample pages remain at `/legacy/overview`,
`/legacy/decisions`, `/legacy/agents` and `/legacy/what-if`.

The Research workspace at `/research` provides campaign evidence, source/audit scope,
per-root S/A/F learning curves, component-level replay, registered checkpoint
inference, matched what-if branches and immutable simulation reviews. Research
data is read from `/api/v1/research`; the UI never substitutes demo data on errors.
Case/arm/root/budget selection is reflected in the URL. Curve inspection does
not change the source study's primary estimand or research gate.

See [the research runbook](../docs/research/runbook.md). The CNC v2/Operations v3
surfaces below are compatibility modules and retain their original semantics.

Next.js frontend for the authenticated AI-assisted maintenance workflow. The UI includes:

- an Operations Overview with a machine attention queue, fleet snapshot, active AI runs, and maintenance windows;
- experiment list with backend-driven pagination and lifecycle counts;
- complete CNC contract v2 create form and Product API policy selection;
- experiment detail with idempotent run, mixed episode states, and polling;
- episode detail with Retry for `FAILED`, Cancel for `PENDING`, current-attempt metadata, historical-attempt switching, partial-result handling, and a direct RUL-distribution visualization;
- Decision Center with a recommendation queue, experiment/machine/severity/status filters, observation and policy context, audit history, and approve/reject/override review modals;
- an Operations contract v3 fixture preview spanning overview, integrated scheduling, recommendation comparison, agent trace inspection, and isolated what-if scenarios;
- a typed real Product API adapter and an in-memory mock adapter using the same TypeScript models.

The legacy application overview remains `/overview`. CNC v2 experiments remain
under `/experiments`; operational review uses `/decisions`, `/agents`, and
`/what-if`. These older surfaces are separate from the JCST research workspace.

The frontend only presents returned research data. It does not predict RUL, derive a point estimate, calculate cost/risk/CVaR/failure probability, choose replacement actions, or reconstruct missing engine output.

## Desktop DSS design

The interface is designed for desktop use at 1280px and wider. The shared workspace uses a stable, explicitly collapsible sidebar, readable typography, clear keyboard focus and restrained semantic colors. The workflow is overview → evidence → alternatives → human review → audit.

- **Overview:** recorded snapshot metrics and the next attention case appear before the factory replay. The three displayed cells are a demo subset, not all monitored machines.
- **Decision Center:** unreviewed recommendations appear first, retaining adapter priority within each workflow group. Select a case to load evidence beside the queue. Selection is read-only. A review dialog displays the full joint action, requires an override rationale and traps keyboard focus; only confirmation opens/submits a review.
- **Agent activity:** inspect evidence-gathering and downstream components beside their authority/tool inspector, then inspect structured events. The current port is recorded demo data.
- **What-if:** choose an assumption and compare baseline and recorded scenario outcomes. These are explicit demo presets, not a connected live simulation endpoint.
- **Research:** experiments use a register, creation uses grouped sections with a configuration outline, and experiment details foreground episode execution. Episode output uses readable field labels, exact returned values, attempt selection and expandable step evidence. Technical identifiers remain available in field tooltips and structured output.
- **Administration:** searchable access register, inline editing, keyboard-accessible active toggle, and explicit account-deactivation confirmation.

UI-only machine drawings, health/load samples and replay stages live under `lib/operations-ui/factory-replay.ts`. They are labelled as samples and do not supply values to real Product API or Maintenance API flows. The replay starts paused, stops at its final stage, and does not improve machine health when service merely starts.

Research rationale and scope: [`docs/design/dss-research.md`](../docs/design/dss-research.md). Design decisions and verification: [`docs/design/dss-redesign.md`](../docs/design/dss-redesign.md).

## Run

Copy the example environment file, install dependencies, and start the frontend:

```bash
cp .env.local.example .env.local
npm ci
npm run dev
```

Authentication uses `NEXT_PUBLIC_API_BASE_URL`. With auth enabled, sign in through `/login`, then open `/overview`.

### Mock Product API

The mock adapter remains available for isolated UI development:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000
NEXT_PUBLIC_PRODUCT_API_MODE=mock
NEXT_PUBLIC_SKIP_AUTH=true
```

Mock research data lives under `lib/product-api/fixtures.ts`, never inside page components. It supports policy loading, pagination, experiment creation, detail views, mixed episode states, and simulated polling. For local UI-only work, `NEXT_PUBLIC_SKIP_AUTH=true` bypasses the login screen in development and uses a local admin identity. This flag is ignored in production builds; use it with `NEXT_PUBLIC_PRODUCT_API_MODE=mock` because the real Product API still requires a valid backend cookie.

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
2. Open **Operations overview** and verify the snapshot metrics, attention queue, and links to review workflows.
3. Open **Experiments** and verify loading, populated, pagination, and retry behavior.
4. Create an experiment, choose a catalog policy, and verify field validation and duplicate-submit protection.
5. Run the ready experiment and confirm the app polls only while an episode is `PENDING` or `RUNNING`.
6. Cancel a `PENDING` episode and retry a `FAILED` episode. Refresh during either lifecycle and confirm no mutation is repeated automatically.
7. Open an episode with more than one attempt and switch attempts. Confirm event and summary requests use the selected attempt while the displayed lifecycle status remains the current attempt.
8. On a completed episode, inspect its final summary and chronological step records. Confirm every action, outcome, cost, risk value, failure, and RUL probability shown matches the returned payload.
9. Repeat at desktop and mobile widths; tables and RUL plots should scroll within their own containers rather than overlap the page.

The example configuration enables the mock Product API and development-only authentication bypass for local UI work. To verify the connected backend, set `NEXT_PUBLIC_PRODUCT_API_MODE=real` and `NEXT_PUBLIC_SKIP_AUTH=false`. Authentication bypass is ignored in production.

## Operations contract v3

`/overview` is the single dashboard entry in the sidebar. Open **Factory resources**
from its page actions to inspect detailed source data and create a Decision Case.
The resource page keeps `/operations` as its existing URL, preserving bookmarks and
workflow links. It is not a second overview. It loads both `getOperationsSnapshot()` and `getCurrentSchedule()` through `OperationsApiClient`. Mock mode is the default and reads the shared canonical 6-machine/12-job/3-technician fixture; real mode calls the authenticated backend read endpoints:

```dotenv
NEXT_PUBLIC_OPERATIONS_API_MODE=real
NEXT_PUBLIC_OPERATIONS_FACTORY_ID=factory-demo-01
NEXT_PUBLIC_OPERATIONS_DECISION_CASE_ID=case-demo-M03-001
```

`/operations/schedule` uses the same synchronized snapshot/current-schedule reads. `/operations/recommendations` keeps its canonical candidate comparison in mock mode; in real mode it accepts `?caseId=...` (or `NEXT_PUBLIC_OPERATIONS_DECISION_CASE_ID`), polls the authoritative case while planning is active, then reads `getDecisionCaseRecommendation()`. The live package is rendered only with the immutable basis snapshot returned by that artifact endpoint. Identifier mismatches fail closed, `RECOMMENDATION_NOT_READY` remains pending, and live approval/modify/reject controls stay disabled. There is no fixture fallback in real mode. `/operations/agents` and `/operations/what-if` remain fixture-rendered in this slice. These pages preserve the v3 boundary: authoritative KPI, health, risk, RUL, cost and feasibility values are never derived by page components. See `../docs/frontend-operations-ia.md` for the information architecture and contract map.

## Decision Center contract and limitations

Open `/decisions` after signing in. In mock mode, the page uses in-memory sample-shaped CNC v2 events from `lib/product-api/fixtures.ts` and simulated Maintenance API reviews. In real mode, it reads current-attempt observation and recommendation events from the Product API, then uses these Maintenance API endpoints only when a reviewer confirms an action:

- `POST /api/v1/maintenance/decisions` (idempotently open a review)
- `POST /api/v1/maintenance/decisions/:id/approve`
- `POST /api/v1/maintenance/decisions/:id/reject`
- `POST /api/v1/maintenance/decisions/:id/override`
- `GET /api/v1/maintenance/decisions/:id/history`

The current contract has no read-only decision list or lookup-by-recommendation endpoint. Consequently, the queue is assembled from persisted recommendations, and existing review statuses/history can only be recovered for decision IDs opened in the same browser session. A row marked "Not opened" may already have a decision created elsewhere. Opening a review is never triggered by page load, refresh, or row selection. The backend also does not provide severity, failure risk, or defer consequence in the current CNC v2 payload; real mode displays "Not provided" for those fields. The policy's estimated expected cost is shown as a *joint fleet estimate*, not a computed per-machine cost. No mock values are injected in real mode.
