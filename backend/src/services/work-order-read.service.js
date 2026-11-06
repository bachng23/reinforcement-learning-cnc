const { Prisma } = require('@prisma/client');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { ApiError } = require('../lib/api-error');
const { authorizeFactory, accessSource, environmentGrants, identifier } = require('./factory-access.service');
const { z, uuid, states, terminal, parse, missing, available } = require('./work-order-policy');
const userSelect = { id: true, username: true, active: true };
const detailInclude = {
  assignee: { select: userSelect },
  completions: { orderBy: { attempt: 'desc' }, take: 1 },
};
const summarySelect = {
  id: true,
  factoryId: true,
  machineId: true,
  maintenanceRequestId: true,
  basisSnapshotId: true,
  sourceCaseId: true,
  scheduleId: true,
  scheduleRevision: true,
  scheduleHash: true,
  publishedPlanVersion: true,
  basisSnapshotHash: true,
  assignmentId: true,
  status: true,
  revision: true,
  assignee: { select: userSelect },
  plannedStartAt: true,
  plannedEndAt: true,
  actualStartedAt: true,
  actualCompletedAt: true,
  createdAt: true,
  updatedAt: true,
};
const clock = async (tx) => (await tx.$queryRaw`SELECT clock_timestamp() AS at`)[0].at;
const meta = (at) => ({ read_at: at.toISOString(), timezone: 'UTC' });
async function scoped(tx, user, id, full = true) {
  if (!uuid.safeParse(id).success) throw missing();
  const row = await tx.workOrder.findUnique({
    where: { id },
    ...(full ? { include: detailInclude } : { select: { id: true, factoryId: true } }),
  });
  if (!row) throw missing();
  try {
    user = await authorizeFactory(tx, user, row.factoryId);
  } catch (e) {
    if (e.statusCode === 404) throw missing();
    throw e;
  }
  return { row, user };
}
async function context(tx, factoryId) {
  const head = await tx.operationsHead.findUnique({
    where: { factoryId },
    include: { snapshot: { select: { payloadJson: true } } },
  });
  return {
    head,
    machines: head ? new Set(head.snapshot.payloadJson.machines.map((m) => m.machine_id)) : null,
  };
}
function summary(row, ctx, at) {
  const head = ctx.head;
  return {
    id: row.id,
    factory_id: row.factoryId,
    machine_id: row.machineId,
    maintenance_request_id: row.maintenanceRequestId,
    basis_snapshot_id: row.basisSnapshotId,
    source: {
      decision_case_id: row.sourceCaseId,
      schedule_id: row.scheduleId,
      schedule_revision: row.scheduleRevision,
      schedule_hash: row.scheduleHash,
      assignment_id: row.assignmentId,
      published_plan_version: row.publishedPlanVersion,
      basis_snapshot_id: row.basisSnapshotId,
      basis_snapshot_hash: row.basisSnapshotHash,
    },
    status: row.status,
    revision: row.revision,
    assignee: row.assignee
      ? { user_id: row.assignee.id, username: row.assignee.username, active: row.assignee.active }
      : null,
    planned_start_at: row.plannedStartAt.toISOString(),
    planned_end_at: row.plannedEndAt.toISOString(),
    actual_started_at: row.actualStartedAt?.toISOString() ?? null,
    actual_completed_at: row.actualCompletedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    source_is_current: Boolean(
      head &&
      head.scheduleId === row.scheduleId &&
      head.scheduleRevision === row.scheduleRevision &&
      head.planVersion === row.publishedPlanVersion,
    ),
    machine_in_current_snapshot: ctx.machines ? ctx.machines.has(row.machineId) : null,
    overdue: row.plannedEndAt < at && !terminal.includes(row.status),
    waiting_verification: row.status === 'COMPLETED',
  };
}
const pick = (value, keys) =>
  value == null
    ? null
    : Object.fromEntries(keys.filter((k) => Object.hasOwn(value, k)).map((k) => [k, value[k]]));
const publicReport = (value) => pick(value, ['outcome', 'work_performed', 'result', 'stop_reason']);
const publicVerification = (value) => pick(value, ['result', 'note', 'actor_id', 'verified_at']);
function detail(row, ctx, at, user) {
  const c = row.completions[0];
  return {
    success: true,
    data: {
      ...summary(row, ctx, at),
      source_technician_ids: row.sourceTechnicianIds,
      requirements: row.requirementsJson,
      attempt: row.attempt,
      blocker: row.blocker,
      latest_completion: c
        ? {
            attempt: c.attempt,
            actor_id: c.actorId,
            completed_at: c.completedAt.toISOString(),
            report: publicReport(c.reportJson),
          }
        : null,
      verification: publicVerification(row.verificationJson),
      cancel_reason: row.cancelReason,
      cancelled_at: row.cancelledAt?.toISOString() ?? null,
      available_commands: available(row, user),
    },
    meta: meta(at),
  };
}
async function getWorkOrder(db, user, id) {
  return db.$transaction(
    async (tx) => {
      const r = await scoped(tx, user, id);
      const at = await clock(tx);
      return detail(r.row, await context(tx, r.row.factoryId), at, r.user);
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
const limit = (max, defaultValue) =>
  z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(max))
    .default(defaultValue);
const listQuery = z
  .object({
    factory_id: identifier,
    status: z.enum(states).optional(),
    assignee_user_id: uuid.optional(),
    machine_id: identifier.optional(),
    overdue: z.enum(['true', 'false']).optional(),
    limit: limit(100, 25),
    cursor: z.string().min(1).max(4096).optional(),
  })
  .strict();
const invalidCursor = () =>
  new ApiError(400, 'INVALID_CURSOR', 'Cursor does not match this actor, scope and filters');
function sign(p) {
  if (!process.env.JWT_SECRET)
    throw new ApiError(503, 'CURSOR_SIGNING_UNAVAILABLE', 'Cursor signing unavailable');
  return createHmac('sha256', process.env.JWT_SECRET).update('work-order-list:v1:').update(p).digest();
}
function cursorScope(q, user) {
  return JSON.stringify({
    actor: user.id,
    source: accessSource(),
    factory: q.factory_id,
    status: q.status ?? null,
    assignee: q.assignee_user_id ?? null,
    machine: q.machine_id ?? null,
    overdue: q.overdue ?? null,
  });
}
function encodeCursor(key, q, user, at) {
  const p = Buffer.from(
    JSON.stringify({
      scope: cursorScope(q, user),
      id: key.id,
      created_at: key.cursorAt,
      read_at: at.toISOString(),
    }),
  ).toString('base64url');
  return p + '.' + sign(p).toString('base64url');
}
function decodeCursor(q, user) {
  if (!q.cursor) return null;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(q.cursor)) throw invalidCursor();
  const [p, s] = q.cursor.split('.'),
    b = Buffer.from(s, 'base64url');
  if (b.toString('base64url') !== s || !timingSafeEqual(sign(p), b)) throw invalidCursor();
  try {
    const r = JSON.parse(Buffer.from(p, 'base64url'));
    if (
      r.scope !== cursorScope(q, user) ||
      !uuid.safeParse(r.id).success ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(r.created_at) ||
      !Number.isFinite(Date.parse(r.created_at)) ||
      !z.string().datetime().safeParse(r.read_at).success
    )
      throw invalidCursor();
    return r;
  } catch {
    throw invalidCursor();
  }
}
async function listWorkOrders(db, user, raw) {
  const q = parse(listQuery, raw),
    after = decodeCursor(q, user);
  return db.$transaction(
    async (tx) => {
      await authorizeFactory(tx, user, q.factory_id);
      const at = after ? new Date(after.read_at) : await clock(tx);
      const overdue = Prisma.sql`(planned_end_at < ${at} AND status NOT IN ('CLOSED','CANCELLED'))`;
      const keys =
        await tx.$queryRaw(Prisma.sql`SELECT id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"
      FROM work_orders WHERE factory_id=${q.factory_id}
      ${q.status ? Prisma.sql`AND status=${q.status}` : Prisma.empty}
      ${q.assignee_user_id ? Prisma.sql`AND assignee_user_id=${q.assignee_user_id}::uuid` : Prisma.empty}
      ${q.machine_id ? Prisma.sql`AND machine_id=${q.machine_id}` : Prisma.empty}
      ${q.overdue ? Prisma.sql`AND ${overdue}=${q.overdue === 'true'}` : Prisma.empty}
      ${after ? Prisma.sql`AND (created_at,id)<(${after.created_at}::timestamptz,${after.id}::uuid)` : Prisma.empty}
      ORDER BY created_at DESC,id DESC LIMIT ${q.limit + 1}`);
      const page = keys.slice(0, q.limit),
        rows = await tx.workOrder.findMany({
          where: { factoryId: q.factory_id, id: { in: page.map((k) => k.id) } },
          select: summarySelect,
        });
      const byId = new Map(rows.map((r) => [r.id, r])),
        ctx = await context(tx, q.factory_id),
        more = keys.length > q.limit;
      return {
        success: true,
        data: page.map((k) => summary(byId.get(k.id), ctx, at)),
        meta: {
          ...meta(at),
          limit: q.limit,
          has_more: more,
          next_cursor: more ? encodeCursor(page.at(-1), q, user, at) : null,
        },
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
const lookupSchema = z
  .object({
    factory_id: identifier,
    ids: z
      .array(uuid)
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
async function lookupWorkOrderSummaries(tx, user, input) {
  const q = parse(lookupSchema, input);
  await authorizeFactory(tx, user, q.factory_id);
  const rows = await tx.workOrder.findMany({
    where: { factoryId: q.factory_id, id: { in: q.ids } },
    select: summarySelect,
  });
  if (rows.length !== q.ids.length) throw missing();
  const ctx = await context(tx, q.factory_id),
    at = await clock(tx),
    byId = new Map(rows.map((r) => [r.id, r]));
  return { success: true, data: q.ids.map((id) => summary(byId.get(id), ctx, at)), meta: meta(at) };
}
async function lookupHttp(db, user, raw) {
  const q = parse(z.object({ factory_id: identifier, ids: z.string().min(1).max(1849) }).strict(), raw);
  return db.$transaction(
    (tx) => lookupWorkOrderSummaries(tx, user, { factory_id: q.factory_id, ids: q.ids.split(',') }),
    { isolationLevel: 'RepeatableRead' },
  );
}
const eventQuery = z
  .object({
    after_sequence: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .transform(Number)
      .pipe(z.number().int().max(2147483647))
      .default(0),
    limit: limit(200, 100),
  })
  .strict();
async function events(db, user, id, raw) {
  const q = parse(eventQuery, raw);
  return db.$transaction(
    async (tx) => {
      await scoped(tx, user, id, false);
      const at = await clock(tx),
        rows = await tx.workOrderEvent.findMany({
          where: { workOrderId: id, sequence: { gt: q.after_sequence } },
          orderBy: { sequence: 'asc' },
          take: q.limit + 1,
        });
      const page = rows.slice(0, q.limit);
      return {
        success: true,
        data: page.map((r) => ({
          id: r.id,
          work_order_id: r.workOrderId,
          sequence: r.sequence,
          actor_id: r.actorId,
          occurred_at: r.occurredAt.toISOString(),
          command: r.command,
          payload: publicEvent(r.payloadJson),
        })),
        meta: {
          ...meta(at),
          limit: q.limit,
          has_more: rows.length > q.limit,
          next_after_sequence: page.at(-1)?.sequence ?? null,
        },
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
function publicEvent(p) {
  const keys = [
    'from_status',
    'to_status',
    'revision',
    'attempt',
    'assignee_user_id',
    'reason',
    'report',
    'verification',
    'overlap_override_reason',
    'overlapping_work_order_ids',
  ];
  const result = pick(p, keys);
  if (result.report) result.report = publicReport(result.report);
  if (result.verification) result.verification = pick(result.verification, ['result', 'note']);
  return result;
}
async function eligibleAssignees(db, identity, raw) {
  const q = parse(z.object({ factory_id: identifier, query: z.string().trim().max(100).default(''), after: uuid.optional(), limit: limit(100, 25) }).strict(), raw);
  return db.$transaction(async tx => {
    const actor = await authorizeFactory(tx, identity, q.factory_id);
    if (!['ADMIN', 'ENGINEER'].includes(actor.role)) throw new ApiError(403, 'FORBIDDEN', 'Management role required');
    const scope = accessSource() === 'environment'
      ? { id: { in: environmentGrants()[q.factory_id] ?? [], ...(q.after ? { gt: q.after } : {}) } }
      : { ...(q.after ? { id: { gt: q.after } } : {}), factoryMemberships: { some: { factoryId: q.factory_id, active: true } } };
    const rows = await tx.user.findMany({ where: { ...scope, active: true, role: { in: ['OPERATOR', 'ENGINEER'] }, username: { contains: q.query, mode: 'insensitive' } }, orderBy: { id: 'asc' }, take: q.limit + 1, select: { id: true, username: true } });
    const page = rows.slice(0, q.limit);
    return { success: true, data: page.map(u => ({ user_id: u.id, username: u.username })), meta: { ...meta(await clock(tx)), has_more: rows.length > q.limit, next_after: rows.length > q.limit ? page.at(-1).id : null } };
  }, { isolationLevel: 'RepeatableRead' });
}
async function byOrigin(db, user, raw) {
  const q = parse(z.object({ factory_id: identifier, schedule_id: identifier, schedule_revision: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(2147483647)), assignment_id: identifier }).strict(), raw);
  return db.$transaction(async tx => {
    await authorizeFactory(tx, user, q.factory_id);
    const row = await tx.workOrder.findFirst({ where: { factoryId: q.factory_id, scheduleId: q.schedule_id, scheduleRevision: q.schedule_revision, assignmentId: q.assignment_id }, select: { id: true } });
    if (!row) throw missing();
    return { success: true, data: { id: row.id }, meta: meta(await clock(tx)) };
  }, { isolationLevel: 'RepeatableRead' });
}
module.exports = {
  eligibleAssignees,
  byOrigin,
  getWorkOrder,
  listWorkOrders,
  lookupWorkOrderSummaries,
  lookupHttp,
  events,
  scoped,
  clock,
  context,
  detail,
  detailInclude,
  summarySelect,
  publicEvent,
};
