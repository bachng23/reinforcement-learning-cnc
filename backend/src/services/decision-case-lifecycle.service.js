const { randomUUID } = require('node:crypto');
const { ApiError } = require('../lib/api-error');
const { contentHash, validatePayload } = require('./operations-contract.service');
const planning = require('./decision-planning.service');

const SAFE_FAILURES = Object.freeze({ INVALID_PLANNING_REQUEST: 'INVALID_AI_PAYLOAD', NO_FEASIBLE_PLAN: 'PLANNING_FAILED', PLANNING_TIMEOUT: 'PLANNING_TIMEOUT', AI_UNAVAILABLE: 'PLANNER_UNAVAILABLE', INVALID_AI_RESPONSE: 'INVALID_AI_PAYLOAD' });
const worker = randomUUID();
function duration(value) { const result = value === undefined ? 30000 : Number(value); if (!Number.isSafeInteger(result) || result < 100 || result > 300000) throw new ApiError(500, 'INVALID_WORKER_CONFIGURATION', 'Invalid Decision Case worker timing configuration'); return result; }

async function claimNextDecisionCase(db, { leaseMs, workerId = worker } = {}) {
  const candidates = await db.decisionCase.findMany({ where: { status: { in: ['CREATED', 'FAILED'] }, processingStatus: { in: ['PENDING', 'FAILED'] }, leaseToken: null, recommendation: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 8 });
  for (const candidate of candidates) try {
    const lease = await planning.claimDecisionCase(db, { caseId: candidate.id, expectedRevision: candidate.revision, workerId, leaseSeconds: Math.ceil(duration(leaseMs) / 1000) });
    const row = await db.decisionCase.findUnique({ where: { id: candidate.id }, include: { snapshot: true } });
    return { ...row, ...lease, requestId: lease.leaseToken, correlationId: candidate.id };
  } catch (error) { if (error.statusCode !== 409) throw error; }
  return null;
}
async function buildPlanningRequest(claim, { signal } = {}) {
  if (!claim?.snapshot || contentHash(claim.snapshot.payloadJson) !== claim.snapshot.contentHash || contentHash(claim.requestJson) !== claim.requestHash) throw new ApiError(500, 'INVALID_PLANNING_REQUEST', 'Pinned Decision Case data failed integrity checks');
  const request = claim.requestJson.request, trigger = { ...request.trigger, event_id: claim.id, occurred_at: claim.createdAt.toISOString() };
  if (['MANUAL_REPLAN', 'WHAT_IF'].includes(trigger.type)) trigger.requested_by_user_id = claim.actorId;
  return validatePayload({ schema_version: '3.0', decision_case_id: claim.id, mode: request.mode, factory_snapshot: claim.snapshot.payloadJson, trigger, planning_config: request.planning_config, requested_by_user_id: claim.actorId }, 'planning-request', { signal });
}
async function heartbeatDecisionCase(db, claim, { leaseMs } = {}) {
  const now = new Date(), id = claim.caseId || claim.id;
  const result = await db.decisionCase.updateMany({ where: { id, revision: claim.revision, leaseToken: claim.leaseToken, status: 'ANALYZING', processingStatus: 'RUNNING', leaseExpiresAt: { gt: now } }, data: { leaseExpiresAt: new Date(now.getTime() + duration(leaseMs)), revision: { increment: 1 } } });
  if (result.count !== 1) return null;
  const row = await db.decisionCase.findUnique({ where: { id }, select: { revision: true, leaseExpiresAt: true } });
  return row;
}
async function persistDecisionRecommendation(db, claim, recommendation) { return planning.persistDecisionRecommendation(db, { caseId: claim.caseId || claim.id, expectedRevision: claim.revision, leaseToken: claim.leaseToken, recommendation }); }
async function blockDecisionCase(db, claim, error) { return planning.recordDecisionPlanningFailure(db, { caseId: claim.caseId || claim.id, expectedRevision: claim.revision, leaseToken: claim.leaseToken, errorCode: SAFE_FAILURES[error?.code] || 'PLANNER_UNAVAILABLE' }); }
async function releaseDecisionCaseClaim() { return false; }
module.exports = { SAFE_FAILURES, claimNextDecisionCase, buildPlanningRequest, heartbeatDecisionCase, persistDecisionRecommendation, blockDecisionCase, releaseDecisionCaseClaim };
