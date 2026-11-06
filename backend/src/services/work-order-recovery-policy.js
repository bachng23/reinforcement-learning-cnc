const { z } = require('zod');
const { ApiError, fromZodError } = require('../lib/api-error');
const base = { expected_revision: z.number().int().min(1).max(2147483647), reason: z.string().trim().min(1).max(4000) };
const recoverySchema = z.discriminatedUnion('command', [
  z.object({ ...base, command: z.literal('MANAGER_HOLD') }).strict(),
  z.object({ ...base, command: z.literal('REASSIGN_FOR_REWORK'), assignee_user_id: z.string().uuid().transform(v => v.toLowerCase()) }).strict(),
]);
// Pure guard only: caller must authorize factory/actor and target within its write
// transaction after factory/ordered-user locks, before receipt lookup. Persist
// patch + immutable event + receipt atomically; never mutate historical reports.
function recoverWorkOrder(order, raw, actor, { now, assignee } = {}) {
  if (!actor?.active) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required');
  if (!['ADMIN', 'ENGINEER'].includes(actor.role)) throw new ApiError(403, 'FORBIDDEN', 'Manager permission is required');
  const parsed = recoverySchema.safeParse(raw);
  if (!parsed.success) throw fromZodError(parsed.error);
  const input = parsed.data;
  if (order.revision !== input.expected_revision) throw new ApiError(409, 'WORK_ORDER_REVISION_CONFLICT', 'Work order changed');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Server timestamp is required');
  const patch = { revision: order.revision + 1, updatedAt: now };
  if (input.command === 'MANAGER_HOLD') {
    if (order.status !== 'IN_PROGRESS') throw new ApiError(409, 'WORK_ORDER_STATE_CONFLICT', 'Only work in progress can be held');
    Object.assign(patch, { status: 'BLOCKED', blocker: input.reason });
  } else {
    if (order.status !== 'COMPLETED') throw new ApiError(409, 'WORK_ORDER_STATE_CONFLICT', 'Rework requires completed work');
    if (!order.latestCompletion?.reportedBy) throw new ApiError(500, 'WORK_ORDER_INTEGRITY_ERROR', 'Completion reporter is unavailable');
    if (order.latestCompletion.reportedBy === actor.id) throw new ApiError(409, 'WORK_ORDER_INDEPENDENT_VERIFICATION_REQUIRED', 'A different manager must request rework');
    if (!assignee?.active || assignee.factoryAuthorized !== true || !['OPERATOR', 'ENGINEER'].includes(assignee.role)
      || assignee.id !== input.assignee_user_id || assignee.id === order.assigneeUserId) {
      throw new ApiError(409, 'ASSIGNEE_UNAVAILABLE', 'A different eligible assignee is required');
    }
    Object.assign(patch, { status: 'ASSIGNED', assigneeUserId: assignee.id, attempt: order.attempt + 1, actualCompletedAt: null });
  }
  return { patch, event: { command: input.command, actorId: actor.id, occurredAt: now,
    payload: { from_status: order.status, to_status: patch.status, revision: patch.revision,
      attempt: patch.attempt ?? order.attempt, assignee_user_id: patch.assigneeUserId ?? order.assigneeUserId, reason: input.reason } } };
}
module.exports = { recoverWorkOrder, recoverySchema };
