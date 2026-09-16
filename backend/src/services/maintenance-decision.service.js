const { z } = require('zod');
const { ApiError, fromZodError } = require('../lib/api-error');
const { episodeAccessWhere } = require('./research-access.service');

const roles = ['OPERATOR', 'ENGINEER', 'ADMIN'];
const reason = z.string().trim().min(1).max(4000);
const replacementAction = z.object({
  schema_version: z.literal('2.0'),
  observation_id: z.string().min(1),
  actions: z.array(z.object({ machine_id: z.string().min(1), action: z.enum(['CONTINUE', 'REPLACE']) }).strict()).min(1),
}).strict();
const schemas = {
  APPROVED: z.object({ reason: reason.optional() }).strict(),
  REJECTED: z.object({ reason: reason.optional() }).strict(),
  OVERRIDDEN: z.object({ reason, replacementAction }).strict(),
};
const accessWhere = (user) => ({ recommendation: { observation: { episode: episodeAccessWhere(user) } } });
const missing = () => new ApiError(404, 'DECISION_NOT_FOUND', 'Maintenance decision was not found');
const conflict = () => new ApiError(409, 'INVALID_DECISION_TRANSITION', 'Decision is no longer PENDING_REVIEW');

async function decide(db, { id, user, to, body }) {
  if (!roles.includes(user?.role)) throw new ApiError(403, 'FORBIDDEN', 'Decision permission is required');
  if (!schemas[to]) throw conflict();
  const parsed = schemas[to].safeParse(body ?? {});
  if (!parsed.success) throw fromZodError(parsed.error);
  const input = parsed.data;
  return db.$transaction(async (tx) => {
    const decision = await tx.maintenanceDecision.findFirst({
      where: { id, ...accessWhere(user) },
      include: { recommendation: { include: { observation: { include: { episode: { include: { experiment: true } } } } } } },
    });
    if (!decision) throw missing();
    if (decision.status !== 'PENDING_REVIEW') throw conflict();
    const rec = decision.recommendation;
    const observation = rec.observation;
    if (to === 'OVERRIDDEN') {
      const alternate = input.replacementAction;
      const machines = observation.payloadJson.machines.map((m) => m.machine_id).sort();
      const supplied = alternate.actions.map((a) => a.machine_id).sort();
      const original = rec.payloadJson.actions.actions;
      if (alternate.observation_id !== observation.observationKey
        || JSON.stringify(machines) !== JSON.stringify(supplied)
        || alternate.actions.every((a) => original.some((b) => a.machine_id === b.machine_id && a.action === b.action))) {
        throw new ApiError(400, 'INVALID_REPLACEMENT_ACTION', 'Replacement must cover the same observation and machines and change at least one action');
      }
    }
    const claimed = await tx.maintenanceDecision.updateMany({ where: { id, status: 'PENDING_REVIEW' }, data: { status: to } });
    if (claimed.count !== 1) throw conflict();
    const createdAt = new Date();
    const action = await tx.maintenanceDecisionAction.create({ data: {
      decisionId: id, actorUserId: user.id, fromStatus: 'PENDING_REVIEW', toStatus: to,
      reason: input.reason ?? null,
      ...(to !== 'REJECTED' ? { selectedAction: to === 'OVERRIDDEN' ? input.replacementAction : rec.payloadJson.actions } : {}),
      recommendationSnapshot: { id: rec.id, policyId: rec.policyId, schemaVersion: rec.schemaVersion, payload: rec.payloadJson },
      riskSnapshot: { observation: observation.payloadJson, environmentConfig: observation.episode.experiment.environmentConfig },
      createdAt,
    } });
    await tx.auditLog.create({ data: {
      entityType: 'MAINTENANCE_DECISION', entityId: id, action: `MAINTENANCE_${to}`,
      actorUserId: user.id, createdAt, payloadJson: { actionId: action.id, fromStatus: 'PENDING_REVIEW', toStatus: to, reason: input.reason ?? null },
    } });
    return { id, status: to, action };
  }, { isolationLevel: 'RepeatableRead' }).catch((error) => {
    if (error.code === 'P2034') throw conflict();
    throw error;
  });
}
module.exports = { decide, accessWhere, missing, roles };
