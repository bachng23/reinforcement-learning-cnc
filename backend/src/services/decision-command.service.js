const { z } = require('zod');
const { ApiError } = require('../lib/api-error');
const { contentHash, validatePayload } = require('./operations-contract.service');
const { accessible, parse, caseResponse } = require('./decision-case.service');

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const version = z.number().int().min(1).max(2147483647);
const common = z.object({ schema_version: z.literal('3.0'), command: z.enum(['APPROVE', 'REJECT', 'COMMIT']),
  decision_case_id: z.string().uuid(), recommendation_id: identifier, expected_snapshot_id: identifier,
  expected_case_revision: version, expected_plan_version: z.number().int().min(0).max(2147483646) });
const selection = { candidate_plan_id: identifier, candidate_version: version };
const note = z.string().min(1).max(4000).refine(value => value.trim().length > 0);
const commandSchema = z.discriminatedUnion('command', [
  common.extend({ command: z.literal('APPROVE'), ...selection, note: note.optional() }).strict(),
  common.extend({ command: z.literal('REJECT'), note }).strict(),
  common.extend({ command: z.literal('COMMIT'), ...selection }).strict(),
]);
const conflict = (code, message) => new ApiError(409, code, message);
const integrity = () => new ApiError(500, 'OPERATIONS_INTEGRITY_ERROR', 'Stored decision content failed integrity validation');

// Canonical expected_plan_version denotes CandidatePlan.plan_version, not the head token.
function humanRequest(body) {
  return { schema_version: body.schema_version, decision_case_id: body.decision_case_id,
    recommendation_id: body.recommendation_id, expected_snapshot_id: body.expected_snapshot_id,
    decision: body.command, ...(body.command === 'APPROVE' ? {
      candidate_plan_id: body.candidate_plan_id, expected_plan_version: body.candidate_version } : {}),
    ...(body.note !== undefined ? { note: body.note } : {}) };
}

async function executeDecisionCommand(db, user, id, rawBody, rawKey) {
  if (!['OPERATOR', 'ENGINEER', 'ADMIN'].includes(user.role)) throw new ApiError(403, 'FORBIDDEN', 'This role cannot decide or commit cases');
  const body = parse(commandSchema, rawBody);
  const key = parse(z.string().min(1).max(128).regex(/^[\x21-\x7e]+$/), rawKey);
  if (id !== body.decision_case_id) throw new ApiError(400, 'CASE_ID_MISMATCH', 'Path and body case IDs must match');
  // Scope authorization precedes both receipt replay and canonical validation.
  const scoped = await accessible(db, user, id);
  const hash = contentHash({ operation: 'decision-command', body });
  return db.$transaction(async tx => {
    // Same namespace/order as ingestion and case creation. READ COMMITTED sees the winner after waiting.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scoped.factoryId}, 0))::text`;
    await tx.$queryRaw`SELECT id FROM decision_cases WHERE id=${id}::uuid FOR UPDATE`;
    const row = await accessible(tx, user, id);
    const receipt = await tx.decisionCaseIdempotencyReceipt.findUnique({ where: {
      factoryId_actorId_key: { factoryId: row.factoryId, actorId: user.id, key } } });
    if (receipt) {
      if (receipt.requestHash !== hash) throw conflict('IDEMPOTENCY_KEY_REUSED', 'Key already belongs to another request');
      return { body: receipt.responseJson, replayed: true };
    }
    if (body.command !== 'COMMIT') await validatePayload(humanRequest(body), 'human-decision');
    // Row lock also fences head writers that do not use the advisory lock.
    await tx.$queryRaw`SELECT factory_id FROM operations_heads WHERE factory_id=${row.factoryId} FOR UPDATE`;
    let head = await tx.operationsHead.findUnique({ where: { factoryId: row.factoryId } });
    if (row.revision !== body.expected_case_revision) throw conflict('CASE_REVISION_CONFLICT', 'Case revision changed');
    if (!head || head.snapshotId !== body.expected_snapshot_id || row.snapshotId !== body.expected_snapshot_id)
      throw conflict('SNAPSHOT_CONFLICT', 'Snapshot is no longer current or does not match case basis');
    if (head.planVersion !== body.expected_plan_version || row.basePlanVersion !== body.expected_plan_version)
      throw conflict('PLAN_VERSION_CONFLICT', 'Head plan version is no longer current or does not match case basis');
    if (body.command === 'COMMIT' && row.mode !== 'LIVE') throw conflict('SIMULATION_ONLY', 'Simulation cases cannot publish schedules');
    if (row.status !== (body.command === 'COMMIT' ? 'APPROVED' : 'AWAITING_APPROVAL'))
      throw conflict('CASE_STATE_CONFLICT', 'Command is unavailable in the current case state');
    const artifact = row.recommendation;
    if (!artifact || artifact.recommendationId !== body.recommendation_id)
      throw conflict('RECOMMENDATION_CONFLICT', 'Recommendation does not match this case');
    const recommendation = artifact.payloadJson;
    if (contentHash(recommendation) !== artifact.contentHash || recommendation.decision_case_id !== id
      || recommendation.snapshot_id !== row.snapshotId || recommendation.recommendation_id !== body.recommendation_id) throw integrity();
    let candidate;
    if (body.command !== 'REJECT') {
      candidate = recommendation.candidate_plans.find(p => p.candidate_plan_id === body.candidate_plan_id);
      if (!candidate) throw conflict('CANDIDATE_NOT_FOUND', 'Candidate is not part of this recommendation');
      if (candidate.plan_version !== body.candidate_version) throw conflict('CANDIDATE_VERSION_CONFLICT', 'Candidate version does not match');
      if (candidate.validation?.verdict !== 'VALID') throw conflict('CANDIDATE_NOT_VALID', 'Candidate must have a VALID verdict');
      if (candidate.decision_case_id !== id || candidate.snapshot_id !== row.snapshotId
        || candidate.validation.candidate_plan_id !== candidate.candidate_plan_id || candidate.schedule.factory_id !== row.factoryId) throw integrity();
    }
    const at = (await tx.$queryRaw`SELECT clock_timestamp() AS now`)[0].now;
    if (body.command === 'COMMIT') {
      const approved = row.humanDecision;
      if (!approved || approved.decision !== 'APPROVE' || approved.recommendationId !== body.recommendation_id
        || approved.candidateId !== body.candidate_plan_id || approved.candidateVersion !== body.candidate_version
        || approved.candidateHash !== contentHash(candidate) || approved.scheduleHash !== contentHash(candidate.schedule))
        throw conflict('APPROVED_CANDIDATE_CONFLICT', 'Only the exact approved candidate can be committed');
      const schedule = candidate.schedule;
      const existing = await tx.operationSchedule.findUnique({ where: { factoryId_scheduleId_revision: {
        factoryId: row.factoryId, scheduleId: schedule.schedule_id, revision: schedule.revision } } });
      if (existing) throw conflict('SCHEDULE_ALREADY_PUBLISHED', 'Candidate schedule identity was already published');
      await tx.operationSchedule.create({ data: { factoryId: row.factoryId, snapshotId: row.snapshotId,
        scheduleId: schedule.schedule_id, revision: schedule.revision, schemaVersion: '3.0',
        contentHash: approved.scheduleHash, payloadJson: schedule } });
      await tx.decisionCommit.create({ data: { caseId: id, factoryId: row.factoryId, snapshotId: row.snapshotId,
        scheduleId: schedule.schedule_id, scheduleRevision: schedule.revision, scheduleHash: approved.scheduleHash,
        planVersion: head.planVersion + 1, actorId: user.id, committedAt: at } });
      head = await tx.operationsHead.update({ where: { factoryId: row.factoryId }, data: {
        scheduleId: schedule.schedule_id, scheduleRevision: schedule.revision,
        planVersion: { increment: 1 }, revision: { increment: 1 } } });
    } else {
      await tx.decisionHumanRecord.create({ data: { caseId: id, decision: body.command,
        recommendationId: body.recommendation_id, actorId: user.id, decidedAt: at, note: body.note ?? null,
        ...(candidate ? { candidateId: candidate.candidate_plan_id, candidateVersion: candidate.plan_version,
          candidateHash: contentHash(candidate), scheduleHash: contentHash(candidate.schedule) } : {}) } });
    }
    const nextStatus = { APPROVE: 'APPROVED', REJECT: 'REJECTED', COMMIT: 'COMMITTED' }[body.command];
    const next = await tx.decisionCase.update({ where: { id }, data: { status: nextStatus, revision: { increment: 1 } },
      include: { recommendation: true, humanDecision: true, commit: true } });
    const last = await tx.decisionCaseEvent.aggregate({ where: { caseId: id }, _max: { sequence: true } });
    await tx.decisionCaseEvent.create({ data: { caseId: id, sequence: (last._max.sequence ?? 0) + 1,
      type: 'CASE_STATUS_CHANGED', actorId: user.id, actorKind: 'HUMAN', occurredAt: at,
      payloadJson: { from_status: row.status, to_status: nextStatus, revision: next.revision,
        command: body.command, recommendation_id: body.recommendation_id,
        candidate_plan_id: candidate?.candidate_plan_id ?? null, candidate_version: candidate?.plan_version ?? null,
        candidate_hash: candidate ? contentHash(candidate) : null, schedule_hash: candidate ? contentHash(candidate.schedule) : null,
        plan_version: head.planVersion } } });
    const response = caseResponse(next, head, user);
    await tx.decisionCaseIdempotencyReceipt.create({ data: { factoryId: row.factoryId, actorId: user.id, key,
      requestHash: hash, caseId: id, responseJson: response } });
    return { body: response, replayed: false };
  }, { isolationLevel: 'ReadCommitted', timeout: 20000 });
}
module.exports = { executeDecisionCommand, commandSchema, humanRequest };
