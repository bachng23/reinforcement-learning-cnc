const { z } = require('zod');
const { ApiError } = require('../lib/api-error');
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const unavailable = () =>
  new ApiError(503, 'FACTORY_ACCESS_UNAVAILABLE', 'Factory access configuration is unavailable');
function accessSource() {
  const value = process.env.FACTORY_ACCESS_SOURCE ?? 'environment';
  if (!['environment', 'database'].includes(value)) throw unavailable();
  return value;
}
function environmentGrants(raw = process.env.OPERATIONS_FACTORY_ACCESS ?? '{}') {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw unavailable();
  }
  const result = z
    .record(
      identifier,
      z.array(
        z
          .string()
          .uuid()
          .transform((id) => id.toLowerCase()),
      ),
    )
    .safeParse(value);
  if (!result.success) throw unavailable();
  return Object.assign(Object.create(null), result.data);
}
function validateAccessConfiguration() {
  if (accessSource() === 'environment') environmentGrants();
}
function requireDatabaseMode() {
  if (accessSource() !== 'database')
    throw new ApiError(
      503,
      'FACTORY_ACCESS_MODE_MISMATCH',
      'Membership administration requires database mode',
    );
}
const notFound = () => new ApiError(404, 'FACTORY_NOT_FOUND', 'Factory was not found');
function accessError(error) {
  if (
    ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code) ||
    error.name === 'PrismaClientInitializationError'
  )
    return new ApiError(503, 'DB_UNAVAILABLE', 'Factory access database is unavailable');
  return error;
}
async function currentUser(db, identity, roles) {
  const user = await db.user
    .findUnique({ where: { id: identity.id }, select: { id: true, role: true, active: true } })
    .catch((e) => {
      throw accessError(e);
    });
  if (!user?.active) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication is required');
  if (roles && !roles.includes(user.role))
    throw new ApiError(403, 'FORBIDDEN', 'This role cannot perform this action');
  return user;
}
async function lockFactory(tx, factoryId) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${factoryId}, 0))::text`;
}
async function lockUsers(tx, ids, exclusive = false) {
  // Ordered row locks serialize even direct SQL user role/active changes.
  for (const id of [...new Set(ids.map((id) => id.toLowerCase()))].sort()) {
    if (exclusive) await tx.$queryRaw`SELECT id FROM users WHERE id=${id}::uuid FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM users WHERE id=${id}::uuid FOR SHARE`;
  }
}
async function authorizeFactory(db, identity, factoryId) {
  try {
    const user = await currentUser(db, identity);
    const source = accessSource();
    if (!(await db.factory.findUnique({ where: { factoryId }, select: { factoryId: true } })))
      throw notFound();
    if (user.role === 'ADMIN') return user;
    const allowed =
      source === 'environment'
        ? environmentGrants()[factoryId]?.includes(user.id)
        : (
            await db.factoryMembership.findUnique({
              where: { factoryId_userId: { factoryId, userId: user.id } },
              select: { active: true },
            })
          )?.active;
    if (!allowed) throw notFound();
    return user;
  } catch (error) {
    throw accessError(error);
  }
}
async function authorizeFactoryWrite(tx, identity, factoryId) {
  await lockUsers(tx, [identity.id]);
  const user = await currentUser(tx, identity, ['ADMIN', 'OPERATOR', 'ENGINEER']);
  await authorizeFactory(tx, user, factoryId);
  return user;
}
async function factoryWhere(db, identity) {
  const user = await currentUser(db, identity);
  if (user.role === 'ADMIN') return {};
  if (accessSource() === 'database') return { memberships: { some: { userId: user.id, active: true } } };
  return {
    factoryId: {
      in: Object.entries(environmentGrants())
        .filter(([, ids]) => ids.includes(user.id))
        .map(([id]) => id),
    },
  };
}
module.exports = {
  identifier,
  accessSource,
  environmentGrants,
  validateAccessConfiguration,
  requireDatabaseMode,
  currentUser,
  lockFactory,
  lockUsers,
  authorizeFactory,
  authorizeFactoryWrite,
  factoryWhere,
  notFound,
  accessError,
};
