# Maintenance Workspace follow-up

Status: implementation and acceptance in progress; Draft, NOT_VERIFIED.

The maintenance branch integrates main #52 at 472fe2b. Backend producer changes
are additive and belong to this follow-up; they require review with the Backend owner.

## Producer dependencies

- D1: GET /work-orders/eligible-assignees?factory_id=F&query=Q&after=USER_ID&limit=25.
  ADMIN or scoped ENGINEER only. Active scoped OPERATOR/ENGINEER users only;
  both environment and database membership modes use current authorization.
  Results contain user_id/username and UTC read metadata. Pagination uses next_after;
  the query is bounded to 100 characters and pages to 100 users. Writes still
  revalidate eligibility under existing transaction locks.
- D2: GET /work-orders/by-origin requires factory_id, schedule_id,
  schedule_revision and assignment_id. Current scope is checked before lookup;
  missing and inaccessible origins return 404. No page scanning, latest-source
  substitution, manual IDs or conflict metadata leaks.
- D3: WorkOrderREASSIGNCommand accepts only REASSIGN. Dedicated MANAGER_HOLD and
  REASSIGN_FOR_REWORK branches remain separate. A contract regression checks
  each of the twelve commands appears in exactly one discriminator branch.

The producer artifact and generated frontend DTOs are regenerated. Assignment
forms use the authenticated directory, with search and paging, and validate the
selection against the loaded page. Publication rows explicitly find/open an
existing order, including historical sources. Sensitive requests remain in RAM.

## Navigation coordination with #54

Reviewed #54 at 8e4efd8d8b69e182d96c73afb8df054cf29e20b0. Its Incident Center
adds /operations/incidents and an adjacent navigation item. Preserve both
Work Orders and Incident Center in AppShell and OperationsShell when integrating.
This follow-up does not add Incident routes before #54 merges, or overwrite its
OpenAPI/summary consumer. The shared producer exporter must retain both sets of
routes in the final integration. #54 is not merged into this branch yet.

## Acceptance boundaries

The previous three create/read/replay/cancel runs remain historical partial
acceptance. They do not verify the new implementation.

The added browser scenario exercises real publications from worker/FastAPI,
real directory selection, exact-origin opening, PARTIAL/STOPPED/SUCCESS independent
closure, block/resume, rework, both revoked-assignee recovery paths, a stale UI
revision conflict and lost command response replay with identical key/body.
PostgreSQL checks verify attempts and closure; commands must preserve publications.

Do not report VERIFIED_DONE until this scenario passes in three consecutive
clean-schema runs on one final integration SHA, screenshots have been inspected,
CI is green and all evidence links/logs identify that SHA. Static contract harness
screenshots and component mocks are not real acceptance evidence.
