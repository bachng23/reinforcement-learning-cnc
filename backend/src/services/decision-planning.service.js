const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { ApiError } = require('../lib/api-error');
const { validatePayload, contentHash } = require('./operations-contract.service');
const { parse, accessible } = require('./decision-case.service');
const base = z.object({ caseId: z.string().uuid(), expectedRevision: z.number().int().min(1).max(2147483642) });
const owned = base.extend({ leaseToken: z.string().uuid() });
const conflict = (code = 'CASE_REVISION_CONFLICT') => new ApiError(409, code, 'Decision case revision, lease or processing state no longer matches');
const running = ['ANALYZING', 'GENERATING', 'VALIDATING', 'EXPLAINING'];
async function transaction(db, fn, options) {
  try { return await db.$transaction(fn, options); }
  catch (error) {
    // The DB guard can observe expiry after the service's clock check.
    if (error.message?.includes('Lease expired')) throw conflict('DECISION_LEASE_CONFLICT');
    throw error;
  }
}
async function lock(tx, id) {
  await tx.$queryRaw`SELECT id FROM decision_cases WHERE id=${id}::uuid FOR UPDATE`;
  const row = await tx.decisionCase.findUnique({ where: { id }, include: { recommendation: true } });
  if (!row) throw new ApiError(404, 'DECISION_CASE_NOT_FOUND', 'Decision case was not found');
  return row;
}
async function now(tx) { return (await tx.$queryRaw`SELECT clock_timestamp() AS now`)[0].now; }
function check(row, args, at, expired = false) {
  if (row.revision !== args.expectedRevision) throw conflict();
  if (row.leaseToken !== args.leaseToken || !running.includes(row.status) || !row.leaseExpiresAt
    || (expired ? row.leaseExpiresAt > at : row.leaseExpiresAt <= at)) throw conflict('DECISION_LEASE_CONFLICT');
}
async function transition(tx, row, at, data, actorId) {
  const next = { ...data, revision: { increment: 1 }, updatedAt: at };
  const changed = await tx.decisionCase.updateMany({ where: { id: row.id, revision: row.revision, leaseToken: row.leaseToken }, data: next });
  if (changed.count !== 1) throw conflict();
  const last = await tx.decisionCaseEvent.aggregate({ where: { caseId: row.id }, _max: { sequence: true } });
  await tx.decisionCaseEvent.create({ data: { caseId: row.id, sequence: (last._max.sequence ?? 0) + 1,
    type: 'CASE_STATUS_CHANGED', actorId, actorKind: 'SYSTEM', occurredAt: at,
    payloadJson: { from_status: row.status, to_status: data.status, revision: row.revision + 1 } } });
  return { ...row, ...data, updatedAt: at, revision: row.revision + 1 };
}
const clearLease = { leaseToken: null, leaseOwnerId: null, leaseExpiresAt: null };

async function claimDecisionCase(db, input) {
  const args = parse(base.extend({ workerId: z.string().uuid(), leaseSeconds: z.number().int().min(1).max(900).default(120) }).strict(), input);
  return transaction(db, async tx => {
    const row = await lock(tx, args.caseId), at = await now(tx);
    if (row.revision !== args.expectedRevision) throw conflict();
    if (!['CREATED', 'FAILED'].includes(row.status) || row.leaseToken || row.recommendation) throw conflict('DECISION_LEASE_CONFLICT');
    const leaseToken = randomUUID();
    const result = await transition(tx, row, at, { status: 'ANALYZING', processingStatus: 'RUNNING',
      processingAttempt: row.processingAttempt + 1, processingErrorCode: null, leaseToken,
      leaseOwnerId: args.workerId, leaseExpiresAt: new Date(at.getTime() + args.leaseSeconds * 1000) }, args.workerId);
    return { caseId: row.id, revision: result.revision, leaseToken, leaseExpiresAt: result.leaseExpiresAt, attempt: result.processingAttempt };
  });
}

async function persistDecisionRecommendation(db, input) {
  const args = parse(owned.extend({ recommendation: z.unknown(), expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(), input);
  const row = await db.decisionCase.findUnique({ where: { id: args.caseId }, include: { snapshot: true } });
  if (!row) throw new ApiError(404, 'DECISION_CASE_NOT_FOUND', 'Decision case was not found');
  if (contentHash(row.snapshot.payloadJson) !== row.snapshot.contentHash) throw new ApiError(500, 'OPERATIONS_INTEGRITY_ERROR', 'Stored snapshot failed integrity validation');
  // Expensive deterministic validation is outside the lock; immutable basis cannot change.
  const payload = await validatePayload({ case_id: row.id, snapshot: row.snapshot.payloadJson, recommendation: args.recommendation }, 'recommendation');
  const hash = contentHash(payload);
  if (args.expectedContentHash && args.expectedContentHash !== hash) throw new ApiError(409, 'RECOMMENDATION_CONTENT_CONFLICT', 'Recommendation content hash does not match');
  try {
    return await transaction(db, async tx => {
      let current = await lock(tx, args.caseId);
      check(current, args, await now(tx));
      if (current.recommendation) throw conflict('RECOMMENDATION_ALREADY_EXISTS');
      await tx.decisionRecommendationArtifact.create({ data: { caseId: current.id, recommendationId: payload.recommendation_id,
        snapshotId: current.snapshotId, schemaVersion: '3.0', contentHash: hash, payloadJson: payload, generatedAt: new Date(payload.generated_at) } });
      const stages = ['ANALYZING', 'GENERATING', 'VALIDATING', 'EXPLAINING', 'AWAITING_APPROVAL'];
      for (const status of stages.slice(stages.indexOf(current.status) + 1)) {
        const at = await now(tx);
        check(current, { ...args, expectedRevision: current.revision }, at);
        current = await transition(tx, current, at, { status, ...(status === 'AWAITING_APPROVAL'
          ? { processingStatus: 'SUCCEEDED', processingErrorCode: null, ...clearLease } : {}) }, current.leaseOwnerId);
      }
      return { caseId: current.id, revision: current.revision, status: current.status, recommendationId: payload.recommendation_id, contentHash: hash };
    }, { timeout: 15000 });
  } catch (error) {
    if (error.code === 'P2002') throw conflict('RECOMMENDATION_ALREADY_EXISTS');
    throw error;
  }
}

async function recordDecisionPlanningFailure(db, input) {
  const args = parse(owned.extend({ errorCode: z.enum(['PLANNING_FAILED', 'PLANNING_TIMEOUT', 'INVALID_AI_PAYLOAD', 'PLANNER_UNAVAILABLE']) }).strict(), input);
  return transaction(db, async tx => {
    const row = await lock(tx, args.caseId), at = await now(tx);
    check(row, args, at);
    const result = await transition(tx, row, at, { status: 'FAILED', processingStatus: 'FAILED', processingErrorCode: args.errorCode, ...clearLease }, row.leaseOwnerId);
    return { caseId: row.id, revision: result.revision, status: result.status };
  });
}

async function releaseExpiredDecisionCaseLease(db, input) {
  const args = parse(owned.strict(), input);
  return transaction(db, async tx => {
    const row = await lock(tx, args.caseId), at = await now(tx);
    check(row, args, at, true);
    const result = await transition(tx, row, at, { status: 'CREATED', processingStatus: 'PENDING', processingErrorCode: 'LEASE_EXPIRED', ...clearLease }, row.leaseOwnerId);
    return { caseId: row.id, revision: result.revision, status: result.status };
  });
}

async function getDecisionRecommendation(db, user, id) {
  const result = await db.$transaction(async tx => {
    const row = await accessible(tx, user, id);
    const artifact = await tx.decisionRecommendationArtifact.findUnique({ where: { caseId: id } });
    if (!artifact) throw new ApiError(404, 'RECOMMENDATION_NOT_READY', 'Recommendation is not ready');
    const snapshot = await tx.factorySnapshot.findUnique({ where: { factoryId_snapshotId: { factoryId: row.factoryId, snapshotId: row.snapshotId } } });
    return { row, artifact, snapshot };
  }, { isolationLevel: 'RepeatableRead' });
  const { row, artifact, snapshot } = result;
  if (!snapshot || artifact.snapshotId !== row.snapshotId || artifact.schemaVersion !== '3.0'
    || contentHash(artifact.payloadJson) !== artifact.contentHash || contentHash(snapshot.payloadJson) !== snapshot.contentHash) {
    throw new ApiError(500, 'RECOMMENDATION_INTEGRITY_ERROR', 'Stored recommendation failed integrity validation');
  }
  try {
    const validated = await validatePayload({ case_id: id, snapshot: snapshot.payloadJson, recommendation: artifact.payloadJson }, 'recommendation');
    if (contentHash(validated) !== artifact.contentHash || validated.recommendation_id !== artifact.recommendationId
      || new Date(validated.generated_at).getTime() !== artifact.generatedAt.getTime()) throw new Error('Integrity mismatch');
  } catch (error) {
    if (error.statusCode === 503) throw error;
    throw new ApiError(500, 'RECOMMENDATION_INTEGRITY_ERROR', 'Stored recommendation failed integrity validation');
  }
  return { success: true, data: { recommendation: artifact.payloadJson, snapshot: snapshot.payloadJson } };
}
module.exports = { claimDecisionCase, persistDecisionRecommendation, recordDecisionPlanningFailure, releaseExpiredDecisionCaseLease, getDecisionRecommendation };
