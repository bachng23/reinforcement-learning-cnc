# Maintenance Workspace frontend runbook

> Current follow-up (2026-10-25): integrated main #52 (472fe2b).
> D1/D2 implementations and D3 producer correction now exist in this branch;
> the earlier dependency notes below describe the previous M1 checkpoint.
> Keep #53 Draft / NOT_VERIFIED until the final integration SHA has three
> consecutive clean-schema full UI lifecycle runs and green CI.
> See [current follow-up](maintenance-workspace-follow-up.md).

This is the new `frontend/maintenance-workspace` draft PR, based on
`ff9a3aeec7d6f3b19e655a326cea214a968764c0` (merged #50 and #51).
Backend implementation dependency: #51 `65b9733`; backend/producer files are
unchanged by this frontend work. See [scope and dependency handoff](frontend-maintenance-workspace.md).

## Setup and sources

Use the repository's Node 22.22.2+ release line and locked dependencies.
From `frontend`, run `npm ci`, `npm run contracts:check`, then `npm run dev`.
Configure the existing API base URL and factory ID using local environment files;
never commit credentials or the user's local login/preview bypass. Work Orders
always uses the authenticated HTTP API, regardless of the research mock setting.
`demo=1` explicitly stops at a live-only notice and performs no Work Order calls.

Provision services and scoped users through the existing backend deployment/test
runbook: [backend Work Orders setup](../backend/docs/work-orders-runbook.md).
That runbook's synthetic demo is isolated test data, not production ingestion.
This frontend does not migrate, seed, repair or reset the user's database. For
repeatable real-service checks use the existing
`bash scripts/check-operations-integration.sh` with a **dedicated** `_test`/`_ci`
PostgreSQL database. Its owned schemas, journal, processes and ports are cleaned by
the harness; do not point it at a development/production database.

Current role names are ADMIN/ENGINEER/OPERATOR/VIEWER. ADMIN/ENGINEER manage work;
only the current authorized OPERATOR/ENGINEER assignee executes it. Independent
verification/rework requires an authorized actor different from the reporter.
The UI renders backend `available_commands` and still handles transaction-time
rejection. ADMIN is not an execution substitute. No user IDs, passwords, reports
or reasons are hardcoded into the production picker or saved in browser storage.

## Review routes and flows

1. Open `/operations/work-orders?factory_id=YOUR_FACTORY`. Apply supported AND
   filters. Next/previous uses opaque cursors; no total or cross-page KPI is
   invented. Changing actor/factory clears cursor/scroll memory. A restored URL
   with an invalid cursor offers a first-page restart.
2. Open a row. Reload uses detail/events GETs only. The header's primary action,
   requirements, planned/actual times, latest completion, independent
   verification, history and expanded technical provenance share one detail view.
   Load more history; refresh re-reads every page already loaded. The server's
   overdue flag and UTC read time remain authoritative.
3. Open the exact source plan from detail. The URL carries factory, case, schedule
   ID/revision and assignment ID. A mismatched artifact fails closed. It never
   substitutes the current publication. Historical/missing-machine flags are
   informational and do not disable commands for old work orders.
4. From a real LIVE committed case's published plan, expand **Maintenance
   assignments / Work Orders**. Only non-cancelled maintenance assignments appear.
   Review machine/request/source/planned window, then explicitly create. The
   source schedule revision and current head revision are separate tokens. On a
   receipt, read the returned order and open its authoritative ID.
5. ACCEPT/START are direct commands. Reason/report/verification/destructive
   actions use labelled keyboard-accessible dialogs. COMPLETE supports
   SUCCESS/PARTIAL/STOPPED; STOPPED requires stop reason. CLOSE presents the latest
   report with the matching verification result and required note. A stopped
   closure does not mean the machine physically recovered.
6. Assignment/reassignment controls remain visibly unavailable pending D1.
   Origin-exists explains D2 and links to the scoped list; it never guesses an
   existing ID or scans every page. Do not treat either path as accepted end-to-end.

## Concurrency and recovery

Each intent freezes a generated key, body and read revision in actor-scoped RAM.
Pending locks all fields/submission. Success/replay triggers fresh GETs; receipt
state is not painted as current state. There is no optimistic revision increment
or automatic write on focus, mount, refresh, reload or history pagination.

A network error/timeout/abort/5xx leaves outcome unconfirmed: retry only the same
key/body/revision, or reconcile authoritative detail/history. Definite 4xx does
not auto-retry. A 409 refreshes reads and requires explicit review before a **new**
intent with a new key; an open form is never rebased automatically. Overlap
override is a separate reviewed intent with a required reason. A newer P2 cannot
replace the P1 source selected in a creation confirmation.

Drafts and unresolved bodies survive SPA navigation only while the same actor's
JavaScript memory survives. **Hard reload/browser restart discards them**; the
banner and leave protection say so. Re-open list/detail/events to recover the
persisted outcome before another intent. Exactly-once recovery across hard reload
is not claimed without the original key/body. No localStorage/sessionStorage
contains Work Order reports/reasons/tokens. Actor/role changes clear old memory;
access is rechecked on focus/visibility and before/after writes. Hidden dialogs
are closed during access revalidation, preventing an old top-layer form from
remaining usable.

## Checks and evidence boundaries

Frontend checks:

```sh
npm run contracts:check
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build
WORK_ORDERS_CAPTURE=1 npx playwright test --config playwright.work-orders.config.ts
```

On Windows set `OPERATIONS_BROWSER_EXECUTABLE` to an installed Edge/Chromium path.
Run browser dev-server suites and production build sequentially because they
share `.next`. Dedicated desktop projects cover 1440×900, 1920×1080 and 2560×1440.
The inherited mobile regression is also run; a new mobile design is outside scope.

Screenshots under
[`screenshots/maintenance-workspace/contract-harness`](screenshots/maintenance-workspace/contract-harness)
are explicitly static **contract isolation**, not real lifecycle evidence. They
cover list, stopped report/detail, independent verification, multi-page history,
pending report, revision conflict, unavailable and empty states at each desktop size.

The existing real Operations browser E2E additionally exercises LIVE planner →
APPROVE/COMMIT → UI source create, drops the already-committed response, retries
identical key/body, asserts one persisted order, reloads detail/list/history, then
opens S1/P1 after S2 and executes CANCEL via UI. Database checks assert unchanged
publication/head state. It captures the new real screens at all three desktop
sizes. JSON evidence explicitly labels this **M1 + partial M2**. The three-run
existing integration harness must pass at one SHA before claiming even these
partial checks verified; its logs/artifacts and exact SHA belong in PR evidence.

Full assignment/execution/independent-close and both revoked-assignee recovery
paths are **NOT_VERIFIED** until reviewed D1/D2 backend endpoints and contract SHAs
exist. D3 producer `oneOf` ambiguity is also pending Backend. No Incident/Flex
integration, deployment or complete M2/M3 `VERIFIED_DONE` claim is made.
