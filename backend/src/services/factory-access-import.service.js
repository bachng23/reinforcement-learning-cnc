const { randomUUID } = require('node:crypto');
const { environmentGrants, lockFactory, lockUsers } = require('./factory-access.service');
const { audit, clock, memberDto } = require('./factory-registry.service');
const { ApiError } = require('../lib/api-error');
async function importFactoryAccess(db, raw, { apply = false } = {}) {
  const grants = environmentGrants(raw),
    entries = Object.entries(grants).sort(([a], [b]) => a.localeCompare(b));
  const pairs = entries.flatMap(([factoryId, ids]) =>
    [...new Set(ids)].sort().map((userId) => ({ factoryId, userId })),
  );
  const factoryIds = entries.map(([id]) => id).sort(),
    userIds = [...new Set(pairs.map((p) => p.userId))].sort();
  const runId = randomUUID();
  return db.$transaction(
    async (tx) => {
      if (apply) {
        for (const id of factoryIds) await lockFactory(tx, id);
        await lockUsers(tx, userIds);
      }
      const factories = await tx.factory.findMany({
        where: { factoryId: { in: factoryIds } },
        select: { factoryId: true },
      });
      const users = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, active: true, username: true },
      });
      if (factories.length !== factoryIds.length || users.length !== userIds.length)
        throw new ApiError(
          400,
          'IMPORT_UNKNOWN_REFERENCE',
          'Import contains unregistered factories or unknown users; nothing was imported',
        );
      const existing = await tx.factoryMembership.findMany({
        where: { factoryId: { in: factoryIds }, userId: { in: userIds } },
        include: { user: { select: { id: true, username: true, active: true } } },
      });
      const byPair = new Map(existing.map((r) => [r.factoryId + '\0' + r.userId, r]));
      const missing = pairs.filter((p) => !byPair.has(p.factoryId + '\0' + p.userId));
      const conflicts = pairs.filter((p) => byPair.get(p.factoryId + '\0' + p.userId)?.active === false);
      const result = {
        run_id: runId,
        apply,
        entries: pairs.length,
        created: apply ? missing.length : 0,
        would_create: missing.length,
        unchanged: pairs.length - missing.length - conflicts.length,
        revoked_conflicts: conflicts,
        inactive_users: users.filter((u) => !u.active).map((u) => u.id),
      };
      if (apply && missing.length) {
        const at = await clock(tx);
        for (const p of missing) {
          const row = await tx.factoryMembership.create({
            data: {
              ...p,
              active: true,
              grantSource: 'import:' + runId,
              grantedAt: at,
              createdAt: at,
              updatedAt: at,
            },
            include: { user: { select: { id: true, username: true, active: true } } },
          });
          await audit(tx, {
            factoryId: p.factoryId,
            targetUserId: p.userId,
            action: 'FACTORY_ACCESS_GRANTED',
            after: memberDto(row),
            source: 'legacy-environment-import',
            runId,
            at,
          });
        }
        await tx.auditLog.create({
          data: {
            entityType: 'SYSTEM',
            entityId: runId,
            action: 'FACTORY_ACCESS_IMPORTED',
            payloadJson: { source: 'legacy-environment-import', ...result },
            createdAt: at,
          },
        });
      }
      return result;
    },
    { isolationLevel: apply ? 'ReadCommitted' : 'RepeatableRead', timeout: 30000 },
  );
}
module.exports = { importFactoryAccess };
