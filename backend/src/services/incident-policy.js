const { z } = require('zod');
const { ApiError, fromZodError } = require('../lib/api-error');

const statuses = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'CLOSED'];
const severities = ['INFO', 'WARNING', 'CRITICAL'];
const categories = ['EQUIPMENT', 'PROCESS', 'SAFETY', 'OTHER'];
const note = z.string().trim().min(1).max(4000);
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const identifier = z.string().min(1).max(128);
const source = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual'), source_event_id: uuid }).strict(),
  z.object({ type: z.literal('case_health_alert'), case_id: uuid }).strict(),
]);
const machine = z.object({ machine_id: identifier, basis_snapshot_id: identifier }).strict();
const reportSchema = z.object({
  factory_id: identifier, source, title: z.string().trim().min(1).max(200), description: note,
  category: z.enum(categories), machine: machine.optional(), proposed_severity: z.enum(severities).optional(),
  severity: z.enum(severities).optional(), related_incident_reason: note.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.source.type === 'case_health_alert' && value.machine) {
    ctx.addIssue({ code: 'custom', path: ['machine'], message: 'Case machine identity must be derived by the server' });
  }
});
const resolution = z.object({ code: z.enum(['FIXED', 'FALSE_POSITIVE', 'NO_ACTION_REQUIRED']), summary: note, evidence: note }).strict();
const verification = z.object({ resolution_code: resolution.shape.code, note }).strict();
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const variant = (command, shape = {}) => z.object({ command: z.literal(command), expected_revision: revision, ...shape }).strict();
const commandSchema = z.discriminatedUnion('command', [
  variant('ASSIGN', { owner_user_id: uuid }),
  variant('REASSIGN', { owner_user_id: uuid, reason: note }),
  variant('ACKNOWLEDGE'), variant('START_INVESTIGATION'),
  variant('CHANGE_SEVERITY', { severity: z.enum(severities), reason: note }),
  variant('MARK_RESOLVED', { resolution, work_order_override_reason: note.optional() }),
  variant('CLOSE', { verification, work_order_override_reason: note.optional() }),
  variant('REOPEN', { reason: note }),
  variant('APPEND_OCCURRENCE', { source, reason: note }),
]);
const linkSchema = z.object({ expected_revision: revision,
  target: z.object({ type: z.enum(['case', 'work_order']), id: uuid }).strict() }).strict();
const unlinkSchema = z.object({ expected_revision: revision, reason: note }).strict();
const keySchema = z.string().regex(/^[\x21-\x7e]{1,128}$/);

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}
const managers = ['ADMIN', 'ENGINEER'];
const writers = [...managers, 'OPERATOR'];
function requireRole(actor, roles) {
  if (!actor?.active) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required');
  if (!roles.includes(actor.role)) throw new ApiError(403, 'FORBIDDEN', 'This role cannot perform this action');
}
function initialSeverity(report, actor) {
  requireRole(actor, writers);
  if (report.severity !== undefined) requireRole(actor, managers);
  return report.severity ?? null;
}

/** Pure guard/patch only. Call INSIDE the write transaction after shared #46
 * factory/user locks and fresh authorization. This function cannot grant scope,
 * replay receipts, read a Work Order, persist events or supply trusted identity.
 * linkedWorkOrders must include EVERY active link, looked up by the producer in
 * that same transaction; omission fails closed when the incident has links.
 */
function transition(incident, command, actor, { now, owner, linkedWorkOrders } = {}) {
  requireRole(actor, writers);
  const input = parse(commandSchema, command);
  if (input.expected_revision !== incident.revision) throw new ApiError(409, 'INCIDENT_REVISION_CONFLICT', 'Incident changed; review the latest state');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Server timestamp is required');
  const state = (...allowed) => {
    if (!allowed.includes(incident.status)) throw new ApiError(409, 'INCIDENT_STATE_CONFLICT', 'Command is unavailable in this state');
  };
  const manager = () => requireRole(actor, managers);
  const currentOwner = () => {
    requireRole(actor, ['OPERATOR', 'ENGINEER']);
    if (incident.ownerUserId !== actor.id) throw new ApiError(403, 'INCIDENT_OWNER_REQUIRED', 'Only the current owner may perform this action');
  };
  const checkOrders = () => {
    // Resolver supplied by the transactional service, never accepted from HTTP.
    if (!Array.isArray(linkedWorkOrders) || linkedWorkOrders.length !== incident.activeWorkOrderLinkCount
      || linkedWorkOrders.some(order => !order || order.availability !== 'available'
        || !['UNASSIGNED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CLOSED', 'CANCELLED'].includes(order.status))) {
      throw new ApiError(503, 'INCIDENT_LINK_TARGET_UNAVAILABLE', 'Linked work orders could not be verified');
    }
    if (linkedWorkOrders.some(order => !['CLOSED', 'CANCELLED'].includes(order.status))) {
      if (!input.work_order_override_reason) throw new ApiError(409, 'INCIDENT_WORK_ORDER_ACTIVE', 'A linked work order is not terminal');
      manager();
    } else if (input.work_order_override_reason) {
      // Even unnecessary override declarations must not grant OPERATOR authority.
      manager();
    }
  };
  const patch = { revision: incident.revision + 1, updatedAt: now };
  switch (input.command) {
    case 'ASSIGN':
    case 'REASSIGN':
      manager();
      if (input.command === 'ASSIGN') {
        state('OPEN');
        if (incident.ownerUserId) throw new ApiError(409, 'INCIDENT_ALREADY_ASSIGNED', 'Use reassignment for an owned incident');
      } else {
        state('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING');
        if (!incident.ownerUserId || incident.ownerUserId === input.owner_user_id) throw new ApiError(409, 'INCIDENT_OWNER_CONFLICT', 'Reassignment requires a different owner');
      }
      if (!owner?.active || owner.id !== input.owner_user_id || !['OPERATOR', 'ENGINEER'].includes(owner.role) || owner.factoryAuthorized !== true) {
        throw new ApiError(409, 'INCIDENT_OWNER_UNAVAILABLE', 'Owner must be active and authorized for this factory');
      }
      Object.assign(patch, { ownerUserId: owner.id, status: 'OPEN', acknowledgedBy: null, acknowledgedAt: null });
      break;
    case 'ACKNOWLEDGE':
      currentOwner(); state('OPEN');
      Object.assign(patch, { status: 'ACKNOWLEDGED', acknowledgedBy: actor.id, acknowledgedAt: now });
      break;
    case 'START_INVESTIGATION':
      currentOwner(); state('ACKNOWLEDGED'); patch.status = 'INVESTIGATING'; break;
    case 'MARK_RESOLVED':
      currentOwner(); state('INVESTIGATING'); checkOrders();
      Object.assign(patch, { status: 'RESOLVED', resolution: input.resolution, resolvedBy: actor.id, resolvedAt: now });
      break;
    case 'CLOSE':
      manager(); state('RESOLVED');
      if (!incident.resolvedBy || !incident.resolution) throw new ApiError(500, 'INCIDENT_INTEGRITY_ERROR', 'Resolution evidence is unavailable');
      if (incident.resolvedBy === actor.id) throw new ApiError(409, 'INCIDENT_INDEPENDENT_VERIFICATION_REQUIRED', 'A different manager must verify resolution');
      if (incident.severity === null) throw new ApiError(409, 'INCIDENT_SEVERITY_UNCONFIRMED', 'Confirm severity before closure');
      if (input.verification.resolution_code !== incident.resolution.code) throw new ApiError(409, 'INCIDENT_VERIFICATION_MISMATCH', 'Review the current resolution');
      checkOrders();
      Object.assign(patch, { status: 'CLOSED', verification: input.verification, closedBy: actor.id, closedAt: now });
      break;
    case 'REOPEN':
      manager(); state('RESOLVED', 'CLOSED');
      patch.status = incident.status === 'CLOSED' ? 'OPEN' : 'INVESTIGATING';
      if (incident.status === 'CLOSED') Object.assign(patch, { acknowledgedAt: null, acknowledgedBy: null });
      // Historical resolution/closure are not destroyed; events retain each attempt.
      break;
    case 'CHANGE_SEVERITY':
      manager(); patch.severity = input.severity; break;
    case 'APPEND_OCCURRENCE':
      manager(); state('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING');
      // Source validation/dedup/insertion is the service's atomic responsibility.
      break;
    default: throw new Error('Unreachable validated command');
  }
  return { patch, event: { command: input.command, actorId: actor.id, occurredAt: now,
    payload: { from_status: incident.status, to_status: patch.status ?? incident.status,
      revision: patch.revision, ...input } } };
}
module.exports = { statuses, severities, categories, reportSchema, commandSchema, linkSchema,
  unlinkSchema, keySchema, parse, initialSeverity, transition };
