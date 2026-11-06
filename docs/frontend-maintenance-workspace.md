# Maintenance Workspace — implementation and contract handoff

> Current follow-up (2026-10-25): integrated main #52 (472fe2b).
> D1/D2 implementations and D3 producer correction now exist in this branch;
> the earlier dependency notes below describe the previous M1 checkpoint.
> Keep #53 Draft / NOT_VERIFIED until the final integration SHA has three
> consecutive clean-schema full UI lifecycle runs and green CI.
> See [current follow-up](maintenance-workspace-follow-up.md).

Base: main `ff9a3aeec7d6f3b19e655a326cea214a968764c0` (merged #50/#51).
Branch: `frontend/maintenance-workspace`. Backend implementation #51:
`65b9733` (merge `ff9a3ae`); #50 frontend: `aaad285` (merge `1dcc4ed`).
New draft PR, never reuse/force-push a merged PR. No backend, database, planner,
telemetry, Incident implementation, migration or production deployment changes.

## IA / desktop wireframe

| Route | Responsibility |
| --- | --- |
| `/operations/work-orders?factory_id=F&status=…&machine_id=…&assignee_user_id=…&overdue=…&limit=25&cursor=…` | Factory list, server ordering, opaque next/back cursor stack; committed URL filters |
| `/operations/work-orders/[id]?factory_id=F&returnTo=…` | Reloadable detail; API factory authoritative; conflicting hint fails closed; scoped return preserves list URL/scroll |
| Existing `/operations/schedule?factory_id=F&caseId=UUID` | Exact immutable publication; maintenance assignment create/view entry, never latest-head substitution |

```text
Operations / Work Orders       Factory / server read_at / Refresh
Status | Machine | Assignee | Overdue | My work | Apply / Clear
ID + copy | Machine/request | Status | Assignee | Planned window | Overdue
                         Previous / Next (no invented total)

Detail: machine + short ID + status + assignee + server overdue / primary action
Requirements / planned versus actual / attempt
Execution blocker / latest report / independent verification / cancellation
Attempts + ascending event pages (Load more, explicit incomplete history)
Source/provenance (expand IDs/hashes; exact case/publication/assignment links)
```

Use #50 navy/neutral/blue shell. Desktop 1440×900 / 1920×1080 / 2560×1440.
No Analytics, mobile redesign, charts, risk/cost/physical recovery inference.
Available commands come from the fresh detail, not a parallel frontend policy.

## Existing API mapping

| UI | Merged API / DTO |
| --- | --- |
| List / next / back | GET `/work-orders`: factory/status/machine/assignee/overdue/limit/cursor; `WorkOrderListResponse` |
| Detail | GET `/work-orders/{id}`; `WorkOrderResponse` |
| Attempts / audit | GET `/work-orders/{id}/events?after_sequence=N&limit=100`; `WorkOrderEventsResponse` |
| Bounded known-ID summaries | GET `/work-orders/summaries?factory_id=F&ids=…`; `WorkOrderLookupResponse` — **not** an origin lookup |
| Source create | POST `/work-orders`; `WorkOrderCreateRequest`, Idempotency-Key, expected_head distinct from schedule revision |
| All twelve commands | POST `/work-orders/{id}/commands`; generated `WorkOrderCommandRequest`, immutable key/body/revision on retry |

Generate frontend DTOs directly from merged exported OpenAPI WorkOrder schemas;
check drift in contracts:check. No hand-written duplicate domain contracts, no
fixture fallback. Transport validates responses and retains public requestId.
Sensitive report/reason drafts and uncertain-action body/key stay **in memory**,
scoped to authenticated actor/factory/order. Never store them in localStorage or
sessionStorage. Reload discards unsaved drafts; reconcile detail/events before a
new intent. Existing decision journal is unchanged and not reused for reports.

## Backend dependencies / proposals (not invented live endpoints)

| Gap | Proposed additive producer contract | Status / owner |
| --- | --- | --- |
| D1 | GET `/work-orders/eligible-assignees?factory_id=F&query=…&cursor=…&limit=25`; active scoped OPERATOR/ENGINEER only, management caller ADMIN/ENGINEER; `user_id,username`, bounded has_more/next_cursor/read_at; fresh eligibility still checked on writes | Missing on main; Backend must implement/test/export and provide SHA. No hardcoded picker, admin credential or UUID input. ASSIGN/REASSIGN/REASSIGN_FOR_REWORK stay visibly unavailable until supplied. |
| D2 | Additive scoped GET lookup by full `factory_id,schedule_id,schedule_revision,assignment_id`, or safe checked conflict detail `existing_work_order_id` | Missing on main; Backend owns implementation/OpenAPI/tests. Do not scan every list page, guess IDs, use assignment ID alone or silently match an active order. Origin-exists shows an honest explanation and factory list until exact ID is authoritative. |
| D3 | `WorkOrderREASSIGNCommand.command` currently includes MANAGER_HOLD and REASSIGN_FOR_REWORK, overlapping the dedicated schemas in `oneOf`; narrow it to REASSIGN on producer side | Contract ambiguity on merged OpenAPI; Backend owns correction. Generated types preserve the producer schema; command forms use dedicated DTOs/strict fields, never infer a second lifecycle from the overlapping enum. |

No external messages sent to Backend/Flex. This PR is the public gap/handoff;
ask owner for reviewed endpoint/contract SHAs. Proceed with independent reads,
execution/report/recovery controls and source-context work while waiting.

## Verification / milestones

- M0: this route map, wireframe, typed API mapping and concrete D1/D2/D3 handoff.
- M1: real read workspace, URL/cursor isolation, source/attempt/history and access
  states; component/client/browser read tests, desktop captures.
- M2: source create and all twelve command forms, concurrency/uncertain-outcome
  recovery. Cannot mark complete with missing D1/D2 real contracts/endpoints.
- M3 VERIFIED_DONE: real planner publication → UI create → manager/assignee/
  independent verifier, both revoked-assignee recovery paths, partial/stopped,
  negatives/restart/pagination, three clean schemas at one integration SHA;
  contracts/typecheck/tests/build/regressions/CI and desktop screenshots green.

Mock is test isolation only. Do not relabel #50 Operations E2E or #51 backend
tests as browser acceptance of this workspace. No Incident-linked acceptance
claim without the actual Flex implementation. Record exact results/pending in PR.

Implementation is now available in draft PR #53: generated producer types and
schema-bound HTTP client, protected real reads, list/detail/paged history, source
creation and all twelve command forms. D1-dependent assignment/reassignment
remains disabled and D2 cannot resolve an origin conflict to an exact existing ID.
See [setup, recovery, checks and evidence boundaries](frontend-maintenance-workspace-runbook.md).
M2/M3 are pending these actual backend dependencies and full real-service
lifecycle/recovery acceptance. Component fixtures are never a production adapter.
