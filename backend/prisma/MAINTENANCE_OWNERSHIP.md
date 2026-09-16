The enterprise maintenance module owns MaintenanceDecision, MaintenanceDecisionAction,
MaintenanceDecisionStatus and migration 20260917000000_maintenance_decisions.
Backend 1 should consume these contracts and must not modify this migration. Add future
changes in a new migration coordinated with the enterprise module owner.

Demo: POST /api/v1/maintenance/decisions with {"recommendationId":"<UUID>"}, then
POST /api/v1/maintenance/decisions/<id>/override with a nonblank reason and
replacementAction using the contract-v2 JointAction shape. Read /<id>/history.
Approve/reject accept an optional reason. Authentication and experiment ownership
follow the research API. VIEWER cannot create or review a decision.

Review records a human choice only. The research simulation's StepResult is not a
maintenance execution acknowledgement. No maintenance execution endpoint exists.
EXECUTED requires a future migration and explicit execution workflow; the current
three review outcomes are terminal, with one immutable action per decision.

Snapshots are captured in a repeatable-read transaction at review time. The entire
recommendation payload and observation/environment configuration preserve risk
estimates, RUL distributions, risk objective and costs without inventing missing risk.
PostgreSQL rejects action updates/deletes and final status changes, and enforces a
matching human action at commit. Restrict FKs retain source records and actors.
Concurrent reviews return 409 and cannot create a second action.

Run `npm run prisma:generate`, then deploy migrations to the intended database.
Run `npm test -- --runInBand`. PostgreSQL integration tests additionally require
MAINTENANCE_TEST_DATABASE_URL pointing to a dedicated migrated test database.
Those tests run inside a rolled-back outer transaction, including immutable records.
