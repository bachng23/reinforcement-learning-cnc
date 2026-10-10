# Human decisions and schedule publication

`POST /api/v1/decision-cases/:id/decision` accepts `APPROVE`, `REJECT` and `COMMIT`.
The exact strict schemas, error responses and examples are in [OpenAPI](../../openapi.yaml)
and [decision-commands.json](../../examples/decision-commands.json).
All three commands require authentication, an OPERATOR/ENGINEER/ADMIN role, factory
access and an `Idempotency-Key`. Unauthorized factory access is indistinguishable
from an absent case. Actor and timestamps come from the server.

## Contract and concurrency tokens

| Field | Meaning |
| --- | --- |
| `decision_case_id` | Must match the path UUID. |
| `recommendation_id` | Must identify this case's immutable recommendation. |
| `expected_snapshot_id` | Must match both case basis and current observation head. |
| `expected_case_revision` | `meta.case_revision`; every state transition increments it. |
| `expected_plan_version` | Current `OperationsHead.planVersion`, also equal to case `base_plan_version`. Zero is valid before publication. |
| `candidate_plan_id` | Selected member of this recommendation; required for APPROVE/COMMIT, forbidden for REJECT. |
| `candidate_version` | The selected `CandidatePlan.plan_version`; required for APPROVE/COMMIT, forbidden for REJECT. |

The canonical Python `HumanDecisionRequest.expected_plan_version` means **candidate
version**, whereas this transport's `expected_plan_version` means **head version**.
The backend explicitly maps `candidate_version` to the canonical field and validates
APPROVE/REJECT through the canonical model. `command` maps to canonical `decision`.
COMMIT is a separate command and does not extend `HumanDecisionType`.
`Schedule.revision` is independent of all three tokens and is published unchanged.
The examples deliberately use case revision 6 → 7 → 8, candidate version 17,
head version 0 → 1, and schedule revision 9.

The earlier frontend command DTO (`candidate_revision`, `reason`, no selected IDs)
is insufficient and is rejected. UI adoption is outside this change. No canonical
generated contract or existing status DTO is changed.

## State changes

- APPROVE requires AWAITING_APPROVAL and a VALID candidate on the correct basis.
  It records recommendation, candidate ID/version, candidate and schedule hashes,
  optional note, actor and time, then transitions to APPROVED.
- REJECT requires AWAITING_APPROVAL and a nonblank note of at most 4,000 characters.
  It records the human decision and transitions to REJECTED.
- Neither APPROVE nor REJECT changes the published schedule or head.
- COMMIT requires APPROVED and LIVE. It compares the selected candidate's identity,
  version and hashes with the immutable approval and verifies the basis is still current.
  SIMULATION_ONLY cannot publish. A schedule ID/revision already published is rejected
  with `SCHEDULE_ALREADY_PUBLISHED`; schedule contents are never overwritten or renamed.

COMMIT inserts the exact candidate schedule, publication provenance, head update,
COMMITTED transition, human audit event and command receipt in one transaction.
A per-factory advisory lock shared with ingestion/creation plus case/head row locks
serialize commands. READ COMMITTED observes the winning head after waiting: two cases
on the same basis cannot both publish. A head version increment happens exactly once.
Database triggers retain the worker transition guards, add human transition checks,
and prohibit update/delete/truncate of decision and publication records.

## Idempotency and recovery

Keys contain 1–128 printable non-space ASCII characters. Their scope is factory +
authenticated actor, shared across case creation, cases and commands. Use a distinct
key for APPROVE and COMMIT. Receipts have no expiry. Same key and body returns the
original successful response with `Idempotency-Replayed: true`; changed body, case or
command returns `IDEMPOTENCY_KEY_REUSED`. Object key order does not affect the hash.
Omitted fields and explicit fields are distinct; unknown fields are rejected.

Role and factory access are checked again on replay. Receipt lookup occurs before
state/revision/context checks, so retrying after a lost response still succeeds after
the head changes. Failed transactions leave neither effects nor a receipt. Retry with
the original key/body when the result is unknown; obtain fresh tokens and a new key
for a new logical command. Replay returns historical metadata, not a refreshed GET.

## Reads and audit

Case `data` remains the canonical `DecisionCaseStatusResponse`, including a populated
`committed_schedule_id` after commit. `meta` adds `approved_candidate`, `human_decision`,
`available_commands` and `commit`. Available commands depend on actor, state and current
basis; they are advisory and all checks run again on writes. `stale` compares the case's
original basis with the current head, so it becomes true after its own successful commit.

Current-schedule reads use a repeatable-read transaction to load the schedule, its
immutable basis snapshot and commit metadata together. The basis may contain an older
embedded schedule; publication provenance authenticates a newly committed schedule.
Later observation ingestion preserves the publication and its original basis.
Existing seeded schedules keep `commit: null` and retain their embedded-schedule check.

Events retain the existing CASE_STATUS_CHANGED shape and add allowlisted command,
recommendation/candidate IDs, versions and hashes for human transitions. Actor and time
are server-owned. Notes are available in human decision metadata rather than event payloads.

## Verification

Run `npm test -- --runInBand` and `npm run test:integration` with an explicit dedicated
`TEST_DATABASE_URL`. Integration tests use real HTTP authentication and PostgreSQL:
APPROVE → COMMIT, unchanged schedule on approval/rejection, canonical status validation,
stale tokens, role/factory enforcement, invalid candidates, same-key replay/conflicts,
concurrent commits, immutable records, and rollback after injected event/receipt failures.
The populated-database upgrade test applies the new migration after the existing history.
The repository-wide acceptance gate is `scripts/check-operations-integration.sh` from
the repository root; it additionally checks frontend, planning, build and Docker stages.

No MODIFY/revalidation, worker, what-if or RL work is included.
