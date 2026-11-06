# Overview client handoff and acceptance status

## Authority

Backend: [PR #45](https://github.com/AIVIETNAM-AIO-BachNguyen/reinforcement-learning-cnc/pull/45),
head `9404ecb35810501d82f1428e9ccadcc77275bf35`, merged in
`4c7aae108942a363a4dc4ee40f4ccb81bdfd8a53`.
DTO authority: `backend/openapi.yaml`, exported
`contracts/v3/operations-http.openapi.json`; examples: `backend/examples/operations-overview.json`.
Domain schema stays v3. No backend business logic, migrations or page styles changed.

## Frontend usage

```tsx
import { getOperationsApiClient, useOperationsOverview } from "@/lib/operations-api";

const api = getOperationsApiClient(); // stable adapter; real mode must be configured
const { state, refresh, retry } = useOperationsOverview({ api, factoryId });
if (state.kind === "ready") {
  // Use state.data.context, machines, cases, review_preview and provenance together.
}
```

Exports: `useOperationsOverview`, `OperationsOverviewState`, `OperationsOverview`.
The hook clears visible data during refresh and factory changes, aborts superseded
requests and ignores responses even if the transport ignores abort. It only calls
GET Overview. Errors never substitute fixtures. Retry performs one new GET, not a
command. No automatic polling is introduced.

States: `loading`, `missing-factory`, `ready`, `unauthorized`, `forbidden`,
`not-found`, `unavailable`, `network-error`, `integrity-error`, `context-mismatch`, `error`.
404 intentionally conflates missing snapshot/head and inaccessible factory: do not
label it a confirmed empty factory. Zero case counts and publication=null are valid
ready states. No health/risk/utilization aggregate exists; absent measurements
must not be displayed as healthy or zero.

Counts and preview are authoritative only at `context.read_at`. Matching head
tokens do not establish aggregate freshness. Do not overlay cached cases or infer
totals from the first case-list page. Preserve preview stale flags and coverage.
This hook makes no supplemental snapshot request. If an inspector adds one, compare
factory/snapshot/plan and head revision when provided; show mismatch or bounded
retry instead of merging observations. Published P1 uses current-schedule's
`basis_snapshot` S1 even when Overview shows S2.

After a confirmed mutation, refetch Overview, case and current schedule. Reuse
`use-operations-action` and its receipt journal: lost response retains body/key;
409 needs review, not automatic rebase. Receipt replay is historical: refetch
before the next command. A stale COMMITTED case remains committed.

## Verification and remaining acceptance

Unit tests import actual producer examples for stale preview and missing health,
exercise both error envelopes, mock lifecycle aggregates, cancellation, refresh
races, factory mismatch and missing data. The existing full frontend test stage
automatically discovers these tests; no migration or worker gate is removed.

The real-service E2E now also invokes the shipped Overview HTTP adapter with the
authenticated test request transport, compares all case buckets/preview/head to
PostgreSQL, compares machine buckets to the validated snapshot, and checks reads
do not change publication. This is API/adapter evidence, not redesigned UI evidence.
Existing lost-response, simulation, race, audit and navigation assertions remain.

Run the existing dedicated-schema harness and full gate per
[browser runbook](operations-browser-e2e-runbook.md). Never use a development DB.
Node must be 22.x >=22.22.2. Both Next suites remain sequential. Harness owns
service/schema/port cleanup and writes SHA-scoped logs; do not stop unrelated
development services. Use `--repeat=3` only on a fixed integrated code revision;
restart the sequence after any code change.

Status at handoff preparation: redesign PR/SHA is not supplied, so redesigned
`/overview` entrypoint, desktop 1280/1440/1920 acceptance, S1/P1 -> S2 UI and three
clean-schema integrated runs are **not verified**. No screenshots or three-run
success evidence are claimed. Existing `/operations` acceptance is not a substitute.
Record final Flex SHA, Frontend SHA/PR, environment versions and CI URLs after
the corresponding assertions actually execute. A draft PR must stay draft while
these acceptance checks are unavailable.
