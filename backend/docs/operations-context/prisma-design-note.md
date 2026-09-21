# Operations Context — Prisma design note

Status: DESIGN DRAFT, 2026-09-21. No schema, migration, generated client or runtime API is changed by this proposal.

Related deliverables: [API draft](api-endpoint-spec.md), [transition table](state-machine.md).

## Evidence and assumptions

The checked-out canonical contract is `contracts/v2/cnc-domain.schema.json`, generated from `ai_services/domain/cnc/contracts.py`. It defines the CNC research domain, not FactorySnapshot, ProductionJob, Schedule or DecisionCase. The entity names and lifecycle in this draft come from the task. All proposed fields, relations and API payloads below require alignment with the incoming Operations Context contract; they are not claimed to be existing contract fields.

Existing Prisma conventions: PostgreSQL, UUID database identities, snake_case table/column mappings, JSON payloads with schemaVersion, timestamptz(6), User and AuditLog. Existing MaintenanceDecision is a separate, terminal review workflow. Do not rename it to DecisionCase, map OVERRIDDEN to MODIFIED automatically, or reinterpret simulation StepResult as a production schedule commit.

Proposed scope: a `factory_id` identifies one authorization and concurrency domain. Day-one development may configure a single factory and an explicit user allowlist; multi-factory production requires persisted membership. Never derive factory permission solely from a caller-supplied factory_id or from the existing experiment-owner predicate.

## Contract → persistence mapping

Database IDs are UUIDs; contract/source IDs remain opaque strings unless the new contract mandates UUIDs. Every immutable payload has `schemaVersion String`, `payloadJson Json @db.JsonB`, and a server-computed content hash over a specified canonical JSON representation. JSON is validated against the pinned contract before persistence. Indexed columns are server-derived projections, never separately client-editable copies.

| Contract entity | Proposed Prisma model / SQL table | Identity, relations and key fields | Day-one storage and later normalization |
| --- | --- | --- | --- |
| FactorySnapshot | FactorySnapshot / factory_snapshots | id UUID; factoryId; sourceSnapshotId String; schemaVersion; capturedAt; persistedAt; payloadJson; contentHash; unique(factoryId, sourceSnapshotId), unique(factoryId, id) | Append-only full aggregate containing machines, jobs, operations, technicians and resource state. Same source key + same hash is replay; different hash is 409, never overwrite. |
| Machine | Machine / operation_machines | Later: snapshotId + machineKey composite key; factory scope inherited from snapshot; payloadJson; status projection only once contract fixes vocabulary | Initially `FactorySnapshot.payloadJson.machines`; later snapshot-scoped projection. Preserve identity across snapshots through machineKey, not by updating historic rows. |
| ProductionJob | ProductionJob / production_jobs | Later: snapshotId + jobKey; payloadJson; priority/dueAt only if contract provides them | Initially snapshot aggregate. Do not infer wall-clock dates from CNC simulation steps. |
| Operation | Operation / production_operations | Later: snapshotId + operationKey; jobKey; predecessor IDs and requirements in payloadJson | Initially snapshot aggregate. Validate referenced job and predecessors within the same snapshot; validate dependency graph without inventing contract semantics. |
| Technician | Technician / operation_technicians | Later: snapshotId + technicianKey; qualifications/availability payload; optional userId relation only with explicit mapping | Initially snapshot aggregate. A technician resource is not automatically an authenticated User or reviewer. |
| Schedule | Schedule / operation_schedules | id UUID; factoryId; decisionCaseId; candidateRevision Int; basisSnapshotId; basePlanVersion Int; payloadJson; contentHash; unique(decisionCaseId, candidateRevision) | Immutable candidate revisions, not one mutable JSON plan. Published schedule referenced by OperationsHead; publish metadata in ScheduleCommit. |
| ScheduleAssignment | ScheduleAssignment / schedule_assignments | Later: scheduleId + assignmentKey; operationKey; machineKey; technician references; start/end with contract-defined units | Initially `Schedule.payloadJson.assignments`. Validate resource references against Schedule.basisSnapshotId. Do not impose one assignment per operation until split/preemption semantics are known. |
| DecisionCase | DecisionCase / decision_cases | id; factoryId; createdById → User; basisSnapshotId → FactorySnapshot; basePlanVersion; status; revision; selectedScheduleId nullable; inputJson; schemaVersion; createdAt/updatedAt | Mutable orchestration aggregate. revision is a CAS counter, independent of plan version. Keep scope/basis immutable for a case; stale cases require a new case. |
| AgentRunTrace | AgentRunTrace / agent_run_traces | id; decisionCaseId; runKey; stage; attempt; status; leaseToken/leaseExpiresAt; input/output JSON references and hashes; model/prompt/tool versions; start/end; unique(caseId, runKey) | Run envelope may move running → completed/failed; completed trace is immutable. Stages reference exact snapshot and candidate revision. Sanitized operational evidence, not private chain-of-thought. |
| ToolCallTrace | ToolCallTrace / tool_call_traces | id; agentRunId; callKey; toolName/version; request/response JSON or artifact references; timestamps; outcome/error; unique(agentRunId, callKey) | Append-only completed call records; retries get distinct attempt/call identities. Redact secrets before storage; link failed calls too. |
| HumanDecision | HumanDecision / human_decisions | id; decisionCaseId; actorUserId → User; actorRoleAtDecision; kind APPROVE/MODIFY/REJECT/COMMIT; from/to status; expectedSnapshotId; expectedPlanVersion; candidateRevision; selectedScheduleId; reason; evidenceJson; createdAt | Append-only review/commit records. Multiple records per case are required for modify/re-review and approve/commit. No unique(caseId) constraint as in legacy maintenance actions. |

## Supporting persistence models

These are proposed implementation records, not new domain contract entities.

| Model / table | Essential fields and constraints | Purpose |
| --- | --- | --- |
| OperationsHead / operations_heads | factoryId PK; currentSnapshotId; currentScheduleId nullable; planVersion Int default 0; revision Int; updatedAt | One authoritative head per factory. Version 0 means no published schedule. Every snapshot publication and schedule publication must write this same row. |
| DecisionCaseEvent / decision_case_events | id UUID; factoryId; caseId; sequence Int; type; fromStatus/toStatus nullable; actorUserId or agentRunId; payloadJson; createdAt; unique(caseId, sequence) | Durable ordered event feed and audit evidence. Allocate sequence while holding/CAS-updating the case row. Event sequence and case revision can increment together for every case event. |
| ScheduleCommit / schedule_commits | id; factoryId; scheduleId unique; caseId unique; humanDecisionId unique; planVersion; previousScheduleId nullable; committedAt; unique(factoryId, planVersion) | Immutable publication receipt. Retains historical schedules even after current pointer advances. |
| DecisionCommand / decision_commands | id; factoryId; actorId; operation; idempotencyKey; canonicalRequestHash; responseJson; statusCode; unique(factoryId, actorId, operation, idempotencyKey) | Durable replay of create/review/commit commands; include path/case ID in request hash. No successful receipt for rolled-back writes. |
| OutboxMessage / operations_outbox (conditional) | id; eventId unique; payload; deliveredAt; attempts | Required only when publishing events to an external broker/service. Created in the same transaction; delivery is at-least-once with consumer deduplication. Polling the DB event feed needs no broker. |

Representative Prisma notation (illustrative, not a complete migratable schema):

```prisma
// DecisionCase fields
basisSnapshotId String @map("basis_snapshot_id") @db.Uuid
basePlanVersion Int @map("base_plan_version")
revision        Int @default(0)
inputJson       Json @map("input_json") @db.JsonB
createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
@@index([factoryId, status, createdAt])
@@map("decision_cases")

// Schedule fields / uniqueness
candidateRevision Int @map("candidate_revision")
basePlanVersion   Int @map("base_plan_version")
payloadJson       Json @map("payload_json") @db.JsonB
@@unique([decisionCaseId, candidateRevision])
@@unique([factoryId, id])
@@map("operation_schedules")
```

Use composite scope FKs `(factoryId, snapshotId)` and `(factoryId, scheduleId)` into unique `(factoryId, id)` targets. A selected schedule must also belong to the same case (composite case/schedule FK). Later normalized assignments reference `(snapshotId, machineKey/operationKey/technicianKey)` for the schedule's basis snapshot, not mutable current resources. Required User references use Restrict; snapshots, schedules, human decisions, commits and audit references do not cascade-delete. SQL triggers/privileges enforce append-only history, with service transition checks plus SQL guards planned in the implementation migration. DB owner access is outside that protection.

Indexes: cases(factoryId,status,createdAt,id); snapshots(factoryId,capturedAt,id); events(caseId,sequence); traces(caseId,startedAt,id); calls(agentRunId,startedAt,id); decisions(caseId,createdAt,id); unique commits(factoryId,planVersion). Snapshot payloads stay JSONB until real query patterns justify JSON indexes/projection tables. Retention must never orphan evidence still referenced by a decision.

## Version semantics and immutable evidence

Proposed v1 meaning of `expected_plan_version`: version of the **currently published factory schedule**, not the candidate revision. `candidate_revision` separately identifies the candidate the human saw. `expected_case_revision` fences concurrent modifications to the case. This distinction must be confirmed against the incoming contract.

Every case captures `(basisSnapshotId, basePlanVersion)`. Each human command supplies the expected pair and candidate/case revisions. Server compares expected pair to BOTH the case basis and OperationsHead. At initial publication, expected_plan_version is 0. Commit publishes head.planVersion + 1; draft generation never advances the published version. Snapshot changes alone increment head.revision, not planVersion.

HumanDecision.evidenceJson records the exact snapshot ID/hash, schedule ID/revision/hash, risk/validation/explanation artifacts and versions, previous head, actor role and rationale at review time. Store full immutable payloads by reference with Restrict FKs; small evidence summaries may be copied. Later approval cannot rewrite an earlier MODIFY record. A commit adds a new record and preserves the approval. Treat these snapshots as evidence from the stated observation time, not a guarantee of live machine state.

## Transaction boundary: approve, modify, reject and commit

Use short PostgreSQL interactive transactions. Compute expensive analysis/validation outside transactions against immutable inputs. Fence results on persistence with case revision, worker lease and exact candidate hash. Never call an agent, tool, broker or machine while holding DB locks.

1. Authenticate actor, authorize factory and command; validate strict request and Idempotency-Key. In the transaction reserve the command key. Identical completed requests return the original receipt before stale-version checks; same key/different request returns 409. Concurrent key insert conflicts are resolved after rollback by reading the winning receipt, without running the mutation twice.
2. Read OperationsHead and case, and verify their scope and all expected versions. Lock/fence in a single global order: head first, then case. Obtain the head row fence with an atomic conditional update:

   ```sql
   UPDATE operations_heads SET revision = revision + 1
   WHERE factory_id = :factory
     AND current_snapshot_id = :expected_snapshot_id
     AND plan_version = :expected_plan_version
   RETURNING *;
   ```

   Zero rows → 409; no side effects commit. Read-then-write without this fence is not sufficient. Even approve (which does not publish a schedule) holds this row lock until commit, preventing snapshot updates from racing the check. All snapshot ingesters and other schedule writers must follow this protocol too.
3. Conditional case update checks id, factory, expected status and `revision = expected_case_revision`. Verify selected schedule belongs to case, exact candidate_revision/hash, basis pair and successful validation/explanation bound to that candidate. Zero rows → 409 and rollback the head fence.
4. APPROVE: AWAITING_APPROVAL → APPROVED. Insert HumanDecision and event; preserve current schedule and planVersion. MODIFY: persist immutable edited candidate at next candidate_revision, status MODIFIED, HumanDecision + event; invalidate validation/approval for old candidate. REJECT: append rejection and mark REJECTED. All three require the same expected basis checks in this draft.
5. COMMIT: require APPROVED and approval for this exact candidate. Recheck head pair even if approval previously succeeded. Atomically insert ScheduleCommit at expected_plan_version + 1, point OperationsHead.currentScheduleId to candidate, increment planVersion, mark case COMMITTED, append HumanDecision(COMMIT) + event and optional outbox. Only one case can publish against a given head version.
6. Save response/idempotency receipt and audit in the same transaction. Commit or rollback all writes together. Use existing AuditLog with `entityType=SYSTEM`, `action=DECISION_CASE_*` plus case ID as a day-one integration option; DecisionCaseEvent/HumanDecision remain authoritative immutable history. Add a dedicated EntityType in a later coordinated migration.

The conditional writes above work under READ COMMITTED when all writers obey the head fence and lock order. A serializable implementation is also acceptable; translate serialization/deadlock conflicts to a retryable 409 after bounded retries, always rechecking versions. Do not silently substitute fresh versions for a client's expected values. A stale APPROVED case remains APPROVED but cannot commit; create a new case on the latest basis and obtain fresh human review. No machine command is implied by schedule publication.

## Phased delivery

- Day one: these three documents only; agree contract fields, version meaning, ownership and role policy. No broad normalization, migration deploy or runtime endpoint registration.
- First vertical slice, when authorized: snapshots/head, case/events, immutable schedule JSON, human decisions, commits and idempotency receipts; add minimal durable run traces for any enabled agent processing. Read snapshot, create case, poll events, review and commit one validated plan.
- Next slice: tool trace expansion/artifact storage and outbox if external delivery is required. Normalize Machine/Job/Operation/Technician/Assignment only when contract and query requirements stabilize. A projection backfill must preserve original payloads and hashes.

Acceptance checks for implementation: exactly one concurrent approval per revision; exactly one schedule commit for competing cases; stale snapshot and stale plan independently fail; snapshot ingestion racing approve/commit is serialized; changed candidate invalidates old validation; audit failure rolls back head/status; idempotent lost-response replay returns original receipt; cross-factory references/access fail; event pagination has no gaps from concurrent writes; terminal evidence rejects mutation.

Contract questions before migration: source identity/version formats, snapshot atomicity/completeness and units; assignment split/overlap and technician cardinality; exact MODIFIED and COMMITTED semantics; whether contract's expected_plan_version means published or candidate version; commit permission and whether approver/committer must differ. Draft decisions for these are explicit here and in the API/state documents.
