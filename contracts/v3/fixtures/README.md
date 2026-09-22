# Shared operations fixtures

`manifest.json` maps each JSON payload to its canonical Pydantic model. These files
are language-neutral inputs for frontend, backend and AI. Do not copy them into
service-specific directories. They are generated from
`ai_services/domain/operations/demo.py`; fixed UTC timestamps, stable scenario IDs
and a fixed seed make the health-alert scenario reproducible. This is demo data,
not real machine telemetry.

- `demo-health-alert.json`: `RunDecisionCaseRequest`, including the canonical factory
  snapshot (six machines, twelve production jobs, three technicians, health alert,
  maintenance request and current schedule).
- `demo-case-status.json`: the matching `CREATED` case status.

Frontend: `createOperationsDemoFixtures()` in `frontend/lib/operations-api/fixtures.ts`
returns isolated typed copies. Existing `frontend/lib/operations/fixtures.ts` remains
presentation demo data; it is not a canonical backend seed or wire payload.

Backend (CommonJS):

```js
const request = require('../contracts/v3/fixtures/demo-health-alert.json'); // from backend/
const snapshot = structuredClone(request.factory_snapshot);
```

AI: read the JSON and call `RunDecisionCaseRequest.model_validate_json(...)`.
The contract gate validates every manifest entry and cross-file case/snapshot IDs.
It also fails when these committed fixtures drift from the canonical demo models.

Regenerate the shared fixtures, planning example and invalid cases with:

```sh
uv run --frozen --project ai_services python ai_services/scripts/export_operations_demo.py
```

## Week 2 seed/reset handoff

From repository root:

```sh
uv run --frozen --project ai_services python scripts/demo-seed-plan.py seed
uv run --frozen --project ai_services python scripts/demo-seed-plan.py reset
```

Both commands print a JSON plan and do not access a database. Seed contains
validated/default-expanded records in dependency order, the AI run request,
fixture hash and deterministic seed. Reset reverses the order and identifies
the demo records. The backend adapter must implement the plan's requirements:
demo database/factory scope, one transaction, nested record mapping, scoped
cleanup of runtime descendants, immutable revision conflict checks, and idempotent
upserts. Actual Prisma migrations/database reset are Week 2 work. Do not pass
this plan to the existing research `prisma:seed`; its data model is different.
