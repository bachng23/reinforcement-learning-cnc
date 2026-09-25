const { randomUUID } = require('node:crypto');
const { ApiError } = require('../lib/api-error');
const { contentHash, validatePayload } = require('./operations-contract.service');

const SAFE_FAILURES = Object.freeze({
  INVALID_PLANNING_REQUEST: 'The stored planning request is invalid',
  NO_FEASIBLE_PLAN: 'No feasible plan is available for this decision case',
  PLANNING_TIMEOUT: 'Planning exceeded its deadline',
  AI_UNAVAILABLE: 'The planning service is temporarily unavailable',
  INVALID_AI_RESPONSE: 'The planning service returned an invalid response',
});

class DecisionCaseLeaseLostError extends Error {
  constructor() {
    super('Decision case lease is no longer owned by this worker');
    this.name = 'DecisionCaseLeaseLostError';
    this.code = 'DECISION_CASE_LEASE_LOST';
  }
}

function positiveMilliseconds(value, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 100 || number > 300000) {
    throw new ApiError(500, 'INVALID_WORKER_CONFIGURATION', 'Invalid Decision Case worker timing configuration');
  }
  return number;
}

async function appendEvent(tx, row, type, payload) {
  await tx.decisionCaseEvent.create({ data: { caseId: row.id, sequence: row.revision,
    type, actorId: row.actorId, payloadJson: payload } });
}

async function claimNextDecisionCase(db, { leaseMs, now = new Date() } = {}) {
  const duration = positiveMilliseconds(leaseMs, 30000);
  return db.$transaction(async tx => {
    const candidates = await tx.$queryRaw`
      SELECT id
      FROM decision_cases
      WHERE (status = 'CREATED' AND processing_status = 'QUEUED')
         OR (status = 'ANALYZING' AND processing_status = 'QUEUED')
         OR (status = 'ANALYZING' AND processing_status = 'RUNNING' AND lease_expires_at <= ${now})
      ORDER BY created_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1`;
    if (!candidates.length) return null;
    const current = await tx.decisionCase.findUnique({ where: { id: candidates[0].id }, include: { snapshot: true } });
    const reclaimed = current.processingStatus === 'RUNNING';
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + duration);
    const row = await tx.decisionCase.update({ where: { id: current.id }, data: {
      status: 'ANALYZING', processingStatus: 'RUNNING', processingStage: 'PLANNING',
      attempt: { increment: 1 }, revision: { increment: 1 }, leaseToken, leaseExpiresAt,
      errorCode: null, errorMessage: null, updatedAt: now,
    }, include: { snapshot: true } });
    await appendEvent(tx, row, reclaimed ? 'CASE_RECLAIMED' : 'CASE_CLAIMED', {
      status: 'ANALYZING', processing_status: 'RUNNING', attempt: row.attempt, revision: row.revision,
    });
    return { ...row, reclaimed, requestId: leaseToken, correlationId: row.id };
  }, { timeout: 15000 });
}

async function buildPlanningRequest(claim, { signal } = {}) {
  if (!claim?.snapshot || contentHash(claim.snapshot.payloadJson) !== claim.snapshot.contentHash
      || contentHash(claim.requestJson) !== claim.requestHash
      || claim.requestJson.factory_id !== claim.factoryId
      || claim.requestJson.expected_snapshot_id !== claim.snapshotId
      || claim.requestJson.expected_plan_version !== claim.basePlanVersion) {
    throw new ApiError(500, 'INVALID_PLANNING_REQUEST', 'Pinned Decision Case data failed integrity checks');
  }
  const stored = claim.requestJson.request;
  const trigger = { ...stored.trigger, event_id: claim.id, occurred_at: claim.createdAt.toISOString() };
  if (['MANUAL_REPLAN', 'WHAT_IF'].includes(trigger.type)) trigger.requested_by_user_id = claim.actorId;
  return validatePayload({ schema_version: '3.0', decision_case_id: claim.id, mode: stored.mode,
    factory_snapshot: claim.snapshot.payloadJson, trigger, planning_config: stored.planning_config,
    requested_by_user_id: claim.actorId }, 'planning-request', { signal });
}

async function heartbeatDecisionCase(db, claim, { leaseMs, now = new Date() } = {}) {
  const duration = positiveMilliseconds(leaseMs, 30000);
  const result = await db.decisionCase.updateMany({ where: { id: claim.id, status: 'ANALYZING',
    processingStatus: 'RUNNING', leaseToken: claim.leaseToken, leaseExpiresAt: { gt: now } }, data: {
    leaseExpiresAt: new Date(now.getTime() + duration), updatedAt: now,
  } });
  return result.count === 1;
}

async function persistDecisionRecommendation(db, claim, rawRecommendation, { now = new Date() } = {}) {
  const recommendation = await validatePayload(rawRecommendation, 'recommendation');
  if (recommendation.decision_case_id !== claim.id || recommendation.snapshot_id !== claim.snapshotId
      || recommendation.candidate_plans.some(candidate => candidate.schedule.factory_id !== claim.factoryId)) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'Operations AI returned an invalid recommendation');
  }
  return db.$transaction(async tx => {
    const owner = await tx.decisionCase.findFirst({ where: { id: claim.id, status: 'ANALYZING',
      processingStatus: 'RUNNING', leaseToken: claim.leaseToken, leaseExpiresAt: { gt: now } } });
    if (!owner) throw new DecisionCaseLeaseLostError();
    await tx.decisionCaseRecommendation.create({ data: { caseId: claim.id,
      recommendationId: recommendation.recommendation_id, schemaVersion: recommendation.schema_version,
      contentHash: contentHash(recommendation), payloadJson: recommendation } });
    const row = await tx.decisionCase.update({ where: { id: claim.id }, data: {
      status: 'AWAITING_APPROVAL', processingStatus: 'IDLE', processingStage: null,
      leaseToken: null, leaseExpiresAt: null, errorCode: null, errorMessage: null,
      revision: { increment: 1 }, updatedAt: now,
    } });
    await appendEvent(tx, row, 'RECOMMENDATION_READY', { status: row.status,
      processing_status: row.processingStatus, recommendation_id: recommendation.recommendation_id,
      revision: row.revision });
    return recommendation;
  }, { timeout: 15000 });
}

async function blockDecisionCase(db, claim, error, { now = new Date() } = {}) {
  const code = Object.hasOwn(SAFE_FAILURES, error?.code) ? error.code : 'AI_UNAVAILABLE';
  return db.$transaction(async tx => {
    const result = await tx.decisionCase.updateMany({ where: { id: claim.id, status: 'ANALYZING',
      processingStatus: 'RUNNING', leaseToken: claim.leaseToken, leaseExpiresAt: { gt: now } }, data: {
      processingStatus: 'BLOCKED', processingStage: 'PLANNING', leaseToken: null, leaseExpiresAt: null,
      errorCode: code, errorMessage: SAFE_FAILURES[code], revision: { increment: 1 }, updatedAt: now,
    } });
    if (result.count !== 1) throw new DecisionCaseLeaseLostError();
    const row = await tx.decisionCase.findUnique({ where: { id: claim.id } });
    await appendEvent(tx, row, 'CASE_BLOCKED', { status: row.status, processing_status: row.processingStatus,
      error_code: code, revision: row.revision });
    return row;
  }, { timeout: 15000 });
}

async function releaseDecisionCaseClaim(db, claim, { now = new Date() } = {}) {
  return db.$transaction(async tx => {
    const result = await tx.decisionCase.updateMany({ where: { id: claim.id, status: 'ANALYZING',
      processingStatus: 'RUNNING', leaseToken: claim.leaseToken, leaseExpiresAt: { gt: now } }, data: {
      processingStatus: 'QUEUED', processingStage: 'PLANNING', leaseToken: null, leaseExpiresAt: null,
      revision: { increment: 1 }, updatedAt: now,
    } });
    if (result.count !== 1) return false;
    const row = await tx.decisionCase.findUnique({ where: { id: claim.id } });
    await appendEvent(tx, row, 'CASE_RELEASED', { status: row.status,
      processing_status: row.processingStatus, revision: row.revision });
    return true;
  }, { timeout: 15000 });
}

module.exports = { DecisionCaseLeaseLostError, SAFE_FAILURES, claimNextDecisionCase,
  buildPlanningRequest, heartbeatDecisionCase, persistDecisionRecommendation,
  blockDecisionCase, releaseDecisionCaseClaim };
