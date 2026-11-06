# Decision Cases and authoritative audit history

## Scope and architecture

`/operations/cases` discovers existing cases; the Operations navigation links it
from Overview and Recommendation Center. A result opens
`/operations/recommendations?caseId=<backend-id>`. A live Recommendation Center
without an ID offers **Browse decision cases**, not a synthesized case.

```text
Overview / Recommendation Center
  -> Decision Cases [factory ID | status | mode]
     -> server cursor -> Load more
     -> Open recommendation (backend case ID)
        -> unchanged #37 status/artifact/confirmation/command workflow
        -> Events API -> complete paged audit timeline
```

The layout continues the research console: filter panel, responsive case cards,
status badges, explicit basis/head/publication fields and a sequence-ordered
timeline. It does not introduce a landing page, schedule editor or KPI logic.

## Wire contracts

- [List contract](../backend/docs/operations-context/decision-case-list.md) and
  [backend DTO](../backend/docs/operations-context/decision-case-list.d.ts).
- [OpenAPI HistoryEvent/EventsResponse](../backend/openapi.yaml) and
  [public event example](../backend/examples/decision-case-events.page.json).
- `frontend/lib/operations-api/decision-case-reads.ts` describes these HTTP
  envelopes. The list DTO is compile-time checked against the backend handoff.
  The HTTP history DTO is **not** the canonical AI `DecisionEvent`.
- `OperationsApiClient.listDecisionCases` and `listEvents` retain `data` and
  pagination `meta`, send credentials, `cache: no-store` and the abort signal.
  No endpoint, KPI, public payload or factory discovery API is invented.

## Discovery and pagination

Factory ID is required; no guessed list of authorized factories is displayed.
Status/mode combine with AND. Apply uses Next router replacement so the URL and
cached route agree; reload and browser Back after opening a recommendation restore
the applied factory/status/mode scope. Cursor position is deliberately not persisted.
Only the backend's opaque cursor is sent to subsequent pages. A filter change
aborts the old request and starts without a cursor. Late responses cannot
replace another scope. Loading the next page is synchronously locked against
double clicks; overlapping IDs from a changing result set are displayed once.

Refresh restarts from the first page because the API does not promise a frozen
cross-request snapshot. Failed next-page network/service reads can be retried
with the exact read query. `INVALID_CURSOR` restarts at page one. An authorization
failure clears previous rows; the UI never retains accessible results after a
known denial. Inaccessible and unknown factories share the backend's safe 404
state. Empty filtered results are different from a read failure.

Case cards render ID, status, mode, factory, created/updated timestamps, case
revision, original snapshot/plan version, current head snapshot/plan version,
backend-provided `stale`, human decision summary and publication identity,
revision, plan version, snapshot, actor and time. Staleness is not recalculated.
A committed case may legitimately be stale after its own commit.

## Complete audit reads

`useDecisionCaseEvents` follows `meta.next_after_sequence` until `has_more=false`.
It publishes a timeline only after **all** pages succeed. Every response must
contain the requested case identity, strictly increasing sequence, unique event
IDs and advancing/consistent page metadata. A broken cursor, cross-case row or
duplicate fails closed instead of showing a partial/mixed history.

Initial load and manual **Refresh history** rebuild from zero and atomically
replace the timeline; they never append an already loaded event. Refetch after
a case revision change refreshes history too. Empty pages preserve the server's
sequence metadata. Sequence is independent of timestamp and case revision.
Case changes and unmount abort the entire chain; aborted or late reads cannot
publish results. No automatic action is sent on mount, refresh or reload.

The UI displays sequence, event type, actor kind/ID, server time, transition,
candidate/version, recommendation, hashes and head version/revision **when
provided**. Unknown public event types remain visible with no invented payload.
Publication identity/basis/actor/time are explicitly labelled as originating
from case-detail `meta.commit`, not inferred from the event or current schedule.
Missing values say **Not provided**. Raw notes/requests are never exposed.

## Preview and regressions

Mock-created cases use the same list/event DTOs. Their public preview transitions
are recorded once, persisted with existing preview receipts and read without
changing case status. Idempotency replays do not add another event. Mock cursors
are scoped to factory/status/mode and use keyset ordering. Preview is isolated;
real-mode reads never catch an error and fall back to this adapter.

The #37 journal hook, actor-bound recovery, confirmation dialogs and command
gating implementations are unchanged. Existing create/approve/commit browser
tests still run; their contract harness now responds to the new read-only
`/events` request. No backend, What-if or Agent Control Room implementation is
changed.

## Verification and evidence

From `frontend/`:

```sh
npm run contracts:check
npm run typecheck
npm run lint
npm test
npm run build
npm run test:browser
```

Unit/component tests cover contract parity, filters, opaque pagination, opening
the exact case ID, empty/auth/not-found/service/network states, retries,
cancellation, late responses, complete multi-page reads, appended events,
unknown event types, publication metadata and fail-closed mismatches.

`tests/browser/decision-cases-audit.spec.ts` runs desktop/mobile through the real
HTTP adapter with a stateful **contract harness**. It verifies 26-case paging,
URL filter recovery including browser Back without an intervening reload,
reopening a committed case, a four-page history, refresh
and reload with zero case writes, loading/empty/network/retry/auth and viewport
overflow. This is not a PostgreSQL or worker acceptance claim.

The [screenshot gallery](screenshots/decision-cases-audit/README.md) identifies
that same harness source. Set `OPERATIONS_CAPTURE_SCREENSHOTS=1` and run just
`npm run test:browser -- decision-cases-audit.spec.ts` to recapture it; leave the
flag unset for the complete regression suite to avoid regenerating #37 images.

### Real-service acceptance (no interception)

The existing `frontend/e2e/operations-decision-flow.spec.ts` also verifies
discovery/audit after its original #37 approval/commit checks, against the same
real API and isolated PostgreSQL schema. It adds no setup/commands or GET
interception: it reads all list/event pages at limit one, opens the committed
case with factory/status/mode filters, compares every UI sequence with the API,
refreshes/reloads with zero case writes and captures desktop/mobile viewports.
The existing Operations integration CI/harness runs it automatically and adds
these checks plus pagination metadata to `evidence.json` under the tested SHA.
No backend, runner script or CI configuration is changed. It remains a pending
gate until that integration run actually succeeds.

`npm run test:cases:live` uses a separate desktop/mobile config. It intentionally
fails when configuration is missing; it never starts a fixture server or marks
the gate skipped/successful. Configure these only in the local shell or CI
secrets, never commit passwords:

```text
DECISION_CASES_LIVE_WEB_URL        deployed/local frontend, OPERATIONS mode real
DECISION_CASES_LIVE_API_URL        matching real backend origin
DECISION_CASES_LIVE_USERNAME       authenticated read-access account
DECISION_CASES_LIVE_PASSWORD       secret
DECISION_CASES_LIVE_FACTORY_ID     optional; defaults to factory-demo-01
```

Provision a stable dedicated test factory with at least two cases and a terminal
case with at least two public events. The test does not seed, send case commands,
change a DB or intercept HTTP. It verifies unauthenticated 401, safe factory 404,
real scoped cursor reads at limit one, filters, correct case navigation, complete
sequence equality, refresh/reload without commands and desktop/mobile overflow.
Screenshots and `real-api-evidence.json` (tested Git SHA, project, factory/case,
server pagination metadata, sequences, zero commands, `intercepted:false`) are
attached under `test-results/decision-cases-live` and its HTML report.

The PR handoff must state the exact tested SHA and distinguish contract/browser
results from this real-service gate. At local implementation time no PostgreSQL
listener, backend service or live credentials were configured. Keep the PR
**draft** until the real-service gate passes; do not substitute fixture evidence.

## Integration after PR #42

The real-service E2E retains both discovery/audit and stale/competing commit flows.
Discovery runs before the race phase closes the original page. Its read-only
command evidence is captured at the end of discovery, so later intentional race
commands are not included. Desktop/mobile acceptance applies filters through the
form, opens the case and uses browser Back to confirm the same scoped list.

## Filter navigation and reload consistency

The applied list scope comes only from the server route's committed searchParams.
Applying changed filters uses a router transition; the list does not fetch the new
scope until the keyed route commits. While the transition is pending, Apply is
disabled and the previous results keep their original meaning. Applying the same
filters refreshes the current list. Reload and Back therefore restore the same
factory/status/mode that produced the displayed result set.

Regression coverage includes a unit test holding route props at their previous
values and a desktop/mobile browser test holding the RSC navigation while API
responses remain fast. The tests verify that the new scoped read cannot run ahead
of the URL, then release navigation and immediately reload to verify filter and
read-query preservation without mutations.
