# Create case and live approval / commit

Base: `91211e7` (backend decision worker and human decision commands merged).
Scope: Operations API client, Overview create entrypoint, Recommendation Center,
and current-schedule refresh. Backend, What-if and Agent Control Room are unchanged.

## User workflow

1. Open `/operations`. Snapshot and current schedule are read together. Enter a
   manual planning reason and horizon, then create a LIVE case against the
   displayed `snapshot_id` and head `plan_version`.
2. The backend case ID determines `/operations/recommendations?caseId=...`.
   Existing polling reads status first and stops on approval/terminal states.
   Only the recommendation endpoint's immutable basis snapshot is used for
   comparison and candidate Gantt.
3. Select a VALID candidate. Review the returned KPI, validation, validator,
   simulation runs and engine provenance. Approve requires confirmation;
   rejection requires a nonblank note (maximum 4,000 characters).
4. Approval records a decision but does not publish a schedule. The case is
   refetched before Commit becomes available. Commit always uses the backend's
   approved candidate ID/version, even when another candidate is being compared.
5. Commit requires a separate confirmation. After refetch, display the published
   version, actor and timestamp, then reload synchronized Overview/schedule data.
   The publication is checked against the returned current schedule before Gantt
   is shown. An already newer authoritative schedule can be displayed as current.

`available_commands` is required to enable writes. Missing permission/context,
invalid validation, inconsistent provenance and stale basis fail closed. MODIFY
remains disabled because modification and revalidation are not provided.

## Transport and recovery

Create and decision POSTs require an explicit `Idempotency-Key`. The decision DTO
matches `backend/examples/decision-commands.json`: `expected_case_revision`,
`expected_plan_version` (head), and `candidate_version` are separate tokens.
`candidate_revision`, `reason`, replacement schedules and MODIFY are not sent.
Canonical `RecommendationPackage`, `FactorySnapshot`, `PlanningConfig`, triggers
and candidate data use generated types; HTTP envelopes stay in the API client.

The tab's session-storage journal retains each action's exact body/key before
submission. Actor identity is verified before real writes and recovery. Pending
requests block double submission, have a 30-second response deadline and abort
on unmount. Aborting does not claim that the backend rolled back a write.
Unknown outcomes (network, timeout, 5xx, interrupted navigation) remain recoverable
with the original key/body. Reload only performs reads; it never automatically
replays a POST. A new logical action receives a new key. Receipts remain retained
until the authoritative read confirms the resulting state.

409 performs/refers to a fresh read and explicit human review. It never replaces
tokens and silently resubmits. A stale case basis requires a new case. Real errors
do not load fixtures, fabricate success, rank candidates, or calculate KPI/risk.

Mock cases created from Overview use the same DTO and component path. The mock
adapter keeps preview receipts/publication in session storage across reload and
replays original responses before context checks. The existing no-case comparison
fixture remains a payload-only preview. Its MODIFY control is also disabled.

## Verification

From `frontend`:

```sh
npm run contracts:check
npm run typecheck
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:browser
```

Set `OPERATIONS_BROWSER_EXECUTABLE` to an installed Chromium/Edge executable to
avoid installing a browser. Set `OPERATIONS_CAPTURE_SCREENSHOTS=1` to regenerate
the [desktop/mobile evidence](screenshots/live-decision-commit-workflow/README.md).
Tests cover canonical HTTP DTOs, separate concurrency versions, selected-candidate
approval, note validation, separate commit, published Gantt, pending/double click,
lost create/approve responses, reload, manual replay, cancellation/deadline, actor
changes, 409 review and fail-closed stale/permission/validation states.

Browser tests use the real HTTP adapter with a stateful canonical contract harness.
Authentication and API responses are intercepted only inside Playwright; no auth
bypass or screenshot-only route is shipped in the application. These tests are
frontend browser integration evidence, not real PostgreSQL/worker acceptance.

## Remaining backend acceptance

No backend/worker/PostgreSQL service was listening locally during verification.
Run the final acceptance against the merged backend with a dedicated demo factory:

1. Configure `NEXT_PUBLIC_OPERATIONS_API_MODE=real`, the backend API base URL and
   factory ID, then sign in with a granted OPERATOR/ENGINEER/ADMIN account.
2. Start the backend decision worker and provide a current immutable snapshot.
3. Create a case in the browser, wait for the recommendation, select a nondefault
   candidate, approve, then separately commit.
4. Verify backend case `COMMITTED`, published version/actor/time and the same
   schedule ID/revision on Overview and `/operations/schedule`.
5. Reload before and after commit; confirm no additional POST/plan increment.
6. Advance the factory observation head before a second approval/commit and verify
   stale basis requires a new case. Exercise a lost-response replay with the same
   key/body and confirm the original receipt is returned.

The PR stays draft until this real-service acceptance is confirmed.
