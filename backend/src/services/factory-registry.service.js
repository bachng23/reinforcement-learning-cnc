const { z } = require('zod');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { ApiError, fromZodError } = require('../lib/api-error');
const {
  identifier,
  accessSource,
  requireDatabaseMode,
  currentUser,
  authorizeFactory,
  factoryWhere,
  lockFactory,
  lockUsers,
  notFound,
  accessError,
} = require('./factory-access.service');
const parse = (schema, value) => {
  const r = schema.safeParse(value);
  if (!r.success) throw fromZodError(r.error);
  return r.data;
};
const name = z.string().trim().min(1).max(200);
const createBody = z.object({ factory_id: identifier, name }).strict();
const renameBody = z.object({ name }).strict();
const empty = z.object({}).strict();
const paging = {
  limit: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .default(25),
  cursor: z.string().min(1).max(2048).optional(),
};
const listQuery = z.object(paging).strict(),
  membersQuery = z.object({ ...paging, state: z.enum(['all', 'active', 'revoked']).default('all') }).strict();
const userSelect = { id: true, username: true, active: true };
const factorySelect = { factoryId: true, name: true, createdAt: true, updatedAt: true };
const dto = (r, hasSnapshot) => ({
  factory_id: r.factoryId,
  name: r.name,
  created_at: r.createdAt.toISOString(),
  updated_at: r.updatedAt.toISOString(),
  has_snapshot: hasSnapshot,
});
function memberDto(r) {
  return r
    ? {
        membership_id: r.id,
        factory_id: r.factoryId,
        user: { user_id: r.user.id, username: r.user.username, active: r.user.active },
        active: r.active,
        granted_by: r.grantedBy,
        granted_at: r.grantedAt.toISOString(),
        grant_source: r.grantSource,
        revoked_by: r.revokedBy,
        revoked_at: r.revokedAt?.toISOString() ?? null,
        created_at: r.createdAt.toISOString(),
        updated_at: r.updatedAt.toISOString(),
      }
    : null;
}
const clock = async (tx) => (await tx.$queryRaw`SELECT clock_timestamp() AS at`)[0].at;
async function audit(
  tx,
  {
    factoryId,
    actorId = null,
    action,
    before = null,
    after = null,
    targetUserId = null,
    source = 'http',
    runId = null,
    at,
  },
) {
  await tx.auditLog.create({
    data: {
      entityType: 'SYSTEM',
      entityId: factoryId,
      factoryId,
      action,
      actorUserId: actorId,
      ...(at ? { createdAt: at } : {}),
      payloadJson: {
        factory_id: factoryId,
        target_user_id: targetUserId,
        source,
        run_id: runId,
        before,
        after,
      },
    },
  });
}
function signature(value) {
  if (!process.env.JWT_SECRET)
    throw new ApiError(503, 'CURSOR_SIGNING_UNAVAILABLE', 'Cursor signing is unavailable');
  return createHmac('sha256', process.env.JWT_SECRET).update('factory-access:v1:').update(value).digest();
}
const invalidCursor = () =>
  new ApiError(400, 'INVALID_CURSOR', 'Cursor is invalid or belongs to another scope');
function decode(value, scope, uuid = false) {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) throw invalidCursor();
  const [p, s] = value.split('.');
  if (!timingSafeEqual(signature(p), Buffer.from(s, 'base64url'))) throw invalidCursor();
  try {
    const r = JSON.parse(Buffer.from(p, 'base64url'));
    if (
      r.scope !== JSON.stringify(scope) ||
      !(uuid ? z.string().uuid() : identifier).safeParse(r.after).success
    )
      throw invalidCursor();
    return r.after;
  } catch {
    throw invalidCursor();
  }
}
function encode(after, scope) {
  const p = Buffer.from(JSON.stringify({ scope: JSON.stringify(scope), after })).toString('base64url');
  return p + '.' + signature(p).toString('base64url');
}
async function listFactories(db, user, raw) {
  const q = parse(listQuery, raw),
    source = accessSource(),
    scope = { actor: user.id, source, route: 'factories' },
    after = decode(q.cursor, scope);
  return db
    .$transaction(
      async (tx) => {
        const where = await factoryWhere(tx, user);
        const rows = await tx.factory.findMany({
          where: { AND: [where, ...(after ? [{ factoryId: { gt: after } }] : [])] },
          orderBy: { factoryId: 'asc' },
          take: q.limit + 1,
          select: factorySelect,
        });
        const page = rows.slice(0, q.limit),
          heads = await tx.operationsHead.findMany({
            where: { factoryId: { in: page.map((r) => r.factoryId) } },
            select: { factoryId: true },
          });
        const ids = new Set(heads.map((r) => r.factoryId)),
          more = rows.length > q.limit;
        return {
          success: true,
          data: page.map((r) => dto(r, ids.has(r.factoryId))),
          meta: {
            limit: q.limit,
            has_more: more,
            next_cursor: more ? encode(page.at(-1).factoryId, scope) : null,
            access_source: source,
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    )
    .catch((e) => {
      throw accessError(e);
    });
}
async function getFactory(db, user, id) {
  parse(identifier, id);
  return db.$transaction(
    async (tx) => {
      await authorizeFactory(tx, user, id);
      const r = await tx.factory.findUnique({ where: { factoryId: id }, select: factorySelect });
      const head = await tx.operationsHead.findUnique({
        where: { factoryId: id },
        select: { factoryId: true },
      });
      return { success: true, data: dto(r, Boolean(head)) };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
async function writeFactory(db, identity, id, raw) {
  await currentUser(db, identity, ['ADMIN']);
  const body = parse(id === null ? createBody : renameBody, raw),
    factoryId = id === null ? body.factory_id : parse(identifier, id);
  return db.$transaction(async (tx) => {
    await lockFactory(tx, factoryId);
    await lockUsers(tx, [identity.id]);
    const user = await currentUser(tx, identity, ['ADMIN']);
    const before = await tx.factory.findUnique({ where: { factoryId } });
    if (id === null && before) throw new ApiError(409, 'FACTORY_ALREADY_EXISTS', 'Factory already exists');
    if (id !== null && !before) throw notFound();
    let row = before;
    const at = await clock(tx);
    if (!before || before.name !== body.name) {
      row = before
        ? await tx.factory.update({ where: { factoryId }, data: { name: body.name, updatedAt: at } })
        : await tx.factory.create({ data: { factoryId, name: body.name, createdAt: at, updatedAt: at } });
      await audit(tx, {
        factoryId,
        actorId: user.id,
        action: before ? 'FACTORY_UPDATED' : 'FACTORY_CREATED',
        before: before ? { name: before.name } : null,
        after: { name: row.name },
        at,
      });
    }
    const head = await tx.operationsHead.findUnique({ where: { factoryId }, select: { factoryId: true } });
    return { success: true, data: dto(row, Boolean(head)) };
  });
}
async function listMembers(db, identity, id, raw) {
  await currentUser(db, identity, ['ADMIN']);
  requireDatabaseMode();
  const factoryId = parse(identifier, id),
    q = parse(membersQuery, raw);
  const scope = { actor: identity.id, source: accessSource(), route: 'members', factoryId, state: q.state },
    after = decode(q.cursor, scope, true);
  return db.$transaction(
    async (tx) => {
      await currentUser(tx, identity, ['ADMIN']);
      if (!(await tx.factory.findUnique({ where: { factoryId } }))) throw notFound();
      const rows = await tx.factoryMembership.findMany({
        where: {
          factoryId,
          ...(q.state === 'all' ? {} : { active: q.state === 'active' }),
          ...(after ? { userId: { gt: after } } : {}),
        },
        orderBy: { userId: 'asc' },
        take: q.limit + 1,
        include: { user: { select: userSelect } },
      });
      const page = rows.slice(0, q.limit),
        more = rows.length > q.limit;
      return {
        success: true,
        data: page.map(memberDto),
        meta: {
          limit: q.limit,
          has_more: more,
          next_cursor: more ? encode(page.at(-1).userId, scope) : null,
          access_source: accessSource(),
        },
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
async function changeMembership(db, identity, id, target, active, raw) {
  await currentUser(db, identity, ['ADMIN']);
  requireDatabaseMode();
  const factoryId = parse(identifier, id),
    userId = parse(z.string().uuid(), target);
  parse(empty, raw ?? {});
  return db.$transaction(async (tx) => {
    await lockFactory(tx, factoryId);
    await lockUsers(tx, [identity.id, userId]);
    const actor = await currentUser(tx, identity, ['ADMIN']);
    requireDatabaseMode();
    if (!(await tx.factory.findUnique({ where: { factoryId } }))) throw notFound();
    const user = await tx.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User was not found');
    if (active && !user.active)
      throw new ApiError(409, 'TARGET_USER_INACTIVE', 'Inactive users cannot be granted access');
    const where = { factoryId_userId: { factoryId, userId } },
      before = await tx.factoryMembership.findUnique({ where, include: { user: { select: userSelect } } });
    if ((before && before.active === active) || (!before && !active))
      return { success: true, data: { membership: memberDto(before), changed: false } };
    const at = await clock(tx),
      data = active
        ? {
            active: true,
            grantedBy: actor.id,
            grantedAt: at,
            grantSource: 'http',
            revokedBy: null,
            revokedAt: null,
            updatedAt: at,
          }
        : { active: false, revokedBy: actor.id, revokedAt: at, updatedAt: at };
    const row = before
      ? await tx.factoryMembership.update({ where, data, include: { user: { select: userSelect } } })
      : await tx.factoryMembership.create({
          data: { factoryId, userId, createdAt: at, ...data },
          include: { user: { select: userSelect } },
        });
    await audit(tx, {
      factoryId,
      actorId: actor.id,
      targetUserId: userId,
      action: active ? 'FACTORY_ACCESS_GRANTED' : 'FACTORY_ACCESS_REVOKED',
      before: memberDto(before),
      after: memberDto(row),
      at,
    });
    return { success: true, data: { membership: memberDto(row), changed: true } };
  });
}
// Trusted bootstrap only: same transaction/lock as seed; never changes a managed name.
async function ensureFactory(tx, factoryId, source) {
  parse(identifier, factoryId);
  if (!source) throw new Error('Explicit bootstrap source is required');
  const previous = await tx.factory.findUnique({ where: { factoryId } });
  if (previous) return previous;
  const row = await tx.factory.create({ data: { factoryId, name: factoryId } });
  await audit(tx, { factoryId, action: 'FACTORY_CREATED', after: { name: row.name }, source });
  return row;
}
async function bootstrapFactory(db, factoryId, source) {
  return db.$transaction(async (tx) => {
    await lockFactory(tx, factoryId);
    return ensureFactory(tx, factoryId, source);
  });
}
module.exports = {
  listFactories,
  getFactory,
  writeFactory,
  listMembers,
  changeMembership,
  ensureFactory,
  bootstrapFactory,
  audit,
  memberDto,
  clock,
  parse,
  empty,
};
