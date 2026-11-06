const { z } = require('zod');
const { ApiError, fromZodError } = require('../lib/api-error');
const { identifier } = require('./factory-access.service');
const uuid = z
  .string()
  .uuid()
  .transform((v) => v.toLowerCase());
const revision = z.number().int().min(1).max(2147483647);
const reason = z.string().trim().min(1).max(4000);
const keySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/);
const sourceSchema = z
  .object({
    decision_case_id: uuid,
    schedule_id: identifier,
    schedule_revision: revision,
    schedule_hash: z.string().regex(/^[a-f0-9]{64}$/),
    assignment_id: identifier,
  })
  .strict();
const createSchema = z
  .object({
    factory_id: identifier,
    source: sourceSchema,
    expected_head: z.object({ snapshot_id: identifier, plan_version: revision, revision }).strict(),
    overlap_override_reason: reason.optional(),
  })
  .strict();
const reportSchema = z
  .object({
    outcome: z.enum(['SUCCESS', 'PARTIAL', 'STOPPED']),
    work_performed: reason,
    result: reason,
    stop_reason: reason.optional(),
  })
  .strict()
  .refine((r) => r.outcome !== 'STOPPED' || Boolean(r.stop_reason), {
    message: 'STOPPED requires stop_reason',
  });
const verificationSchema = z
  .object({ result: z.enum(['VERIFIED', 'VERIFIED_STOPPED']), note: reason })
  .strict();
const commands = {
  ASSIGN: { assignee_user_id: uuid },
  REASSIGN: { assignee_user_id: uuid, reason },
  ACCEPT: {},
  START: {},
  BLOCK: { reason },
  RESUME: { reason },
  COMPLETE: { report: reportSchema },
  CLOSE: { verification: verificationSchema },
  REQUEST_REWORK: { reason },
  CANCEL: { reason },
  MANAGER_HOLD: { reason },
  REASSIGN_FOR_REWORK: { assignee_user_id: uuid, reason },
};
const commandSchema = z.discriminatedUnion(
  'command',
  Object.entries(commands).map(([command, fields]) =>
    z.object({ command: z.literal(command), expected_revision: revision, ...fields }).strict(),
  ),
);
const states = [
  'UNASSIGNED',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'CLOSED',
  'CANCELLED',
];
const terminal = ['CLOSED', 'CANCELLED'];
const managerRoles = ['ADMIN', 'ENGINEER'];
const executionRoles = ['OPERATOR', 'ENGINEER'];
const executionCommands = ['ACCEPT', 'START', 'BLOCK', 'RESUME', 'COMPLETE'];
const transitions = {
  ASSIGN: [['UNASSIGNED'], 'ASSIGNED'],
  REASSIGN: [['ASSIGNED', 'ACCEPTED', 'BLOCKED'], 'ASSIGNED'],
  ACCEPT: [['ASSIGNED'], 'ACCEPTED'],
  START: [['ACCEPTED'], 'IN_PROGRESS'],
  BLOCK: [['IN_PROGRESS'], 'BLOCKED'],
  RESUME: [['BLOCKED'], 'IN_PROGRESS'],
  COMPLETE: [['IN_PROGRESS'], 'COMPLETED'],
  CLOSE: [['COMPLETED'], 'CLOSED'],
  REQUEST_REWORK: [['COMPLETED'], 'IN_PROGRESS'],
  CANCEL: [['UNASSIGNED', 'ASSIGNED', 'ACCEPTED'], 'CANCELLED'],
  MANAGER_HOLD: [['IN_PROGRESS'], 'BLOCKED'],
  REASSIGN_FOR_REWORK: [['COMPLETED'], 'ASSIGNED'],
};
function parse(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) throw fromZodError(r.error);
  return r.data;
}
const conflict = (code, message) => new ApiError(409, code, message);
const missing = () => new ApiError(404, 'WORK_ORDER_NOT_FOUND', 'Work order was not found');
function requireCommandRole(row, user, command) {
  if (executionCommands.includes(command)) {
    if (!executionRoles.includes(user.role)) throw new ApiError(403, 'FORBIDDEN', 'Execution role required');
    if (row.assigneeUserId !== user.id)
      throw new ApiError(403, 'WORK_ORDER_NOT_ASSIGNEE', 'Current assignee required');
  } else if (!managerRoles.includes(user.role))
    throw new ApiError(403, 'FORBIDDEN', 'Management role required');
}
function transition(row, user, body, at) {
  requireCommandRole(row, user, body.command);
  const [from, to] = transitions[body.command];
  if (!from.includes(row.status) || (body.command === 'CANCEL' && row.actualStartedAt))
    throw conflict('INVALID_WORK_ORDER_TRANSITION', 'Command is unavailable in the current execution state');
  if (
    ['CLOSE', 'REQUEST_REWORK', 'REASSIGN_FOR_REWORK'].includes(body.command) &&
    row.completions[0]?.actorId === user.id
  )
    throw new ApiError(403, 'SELF_VERIFICATION', 'Completion requires independent verification');
  const data = { status: to, revision: { increment: 1 }, updatedAt: at };
  switch (body.command) {
    case 'ASSIGN':
    case 'REASSIGN':
      if (body.command === 'REASSIGN' && row.assigneeUserId === body.assignee_user_id)
        throw conflict('INVALID_WORK_ORDER_TRANSITION', 'Reassignment requires a different assignee');
      Object.assign(data, { assigneeUserId: body.assignee_user_id, blocker: null });
      break;
    case 'START':
      data.actualStartedAt = row.actualStartedAt ?? at;
      break;
    case 'BLOCK':
      data.blocker = body.reason;
      break;
    case 'RESUME':
      data.blocker = null;
      break;
    case 'COMPLETE':
      data.actualCompletedAt = at;
      break;
    case 'REQUEST_REWORK':
      Object.assign(data, { attempt: { increment: 1 }, actualCompletedAt: null });
      break;
    case 'CLOSE': {
      const stopped = row.completions[0]?.reportJson.outcome === 'STOPPED';
      if (body.verification.result !== (stopped ? 'VERIFIED_STOPPED' : 'VERIFIED'))
        throw conflict(
          'INVALID_WORK_ORDER_TRANSITION',
          'Verification result must match the reported outcome',
        );
      data.verificationJson = { ...body.verification, actor_id: user.id, verified_at: at.toISOString() };
      break;
    }
    case 'CANCEL':
      Object.assign(data, { cancelReason: body.reason, cancelledAt: at });
      break;
  }
  return data;
}
function available(row, user) {
  return Object.entries(transitions)
    .filter(([c, [from]]) => {
      if (!from.includes(row.status) || (c === 'CANCEL' && row.actualStartedAt)) return false;
      if (
        ['CLOSE', 'REQUEST_REWORK', 'REASSIGN_FOR_REWORK'].includes(c) &&
        row.completions?.[0]?.actorId === user.id
      )
        return false;
      return executionCommands.includes(c)
        ? executionRoles.includes(user.role) && row.assigneeUserId === user.id
        : managerRoles.includes(user.role);
    })
    .map(([c]) => c);
}
module.exports = {
  z,
  uuid,
  revision,
  reason,
  keySchema,
  createSchema,
  commandSchema,
  reportSchema,
  verificationSchema,
  states,
  terminal,
  managerRoles,
  executionRoles,
  executionCommands,
  parse,
  conflict,
  missing,
  requireCommandRole,
  transition,
  available,
};
