const { z } = require('zod');
const { ApiError, fromZodError } = require('../lib/api-error');
const { validatePayload, contentHash } = require('./operations-contract.service');

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const inputSchema = z.object({
  factoryId: identifier,
  expectedHeadRevision: z.number().int().min(0).max(2147483646),
  snapshot: z.record(z.string(), z.unknown()),
  sourceId: identifier,
}).strict();
const headConflict = () => new ApiError(409, 'HEAD_REVISION_CONFLICT', 'Operations head revision has changed');
const receipt = (row, head, replayed) => ({
  factoryId: row.factoryId, snapshotId: row.snapshotId, contentHash: row.contentHash,
  sourceId: row.sourceId, replayed,
  head: { snapshotId: head.snapshotId, revision: head.revision, scheduleId: head.scheduleId,
    scheduleRevision: head.scheduleRevision, planVersion: head.planVersion },
});

// Internal trusted-adapter entrypoint, not a public mutation or an authorization API.
// Optional client injection keeps integration tests on their isolated schema.
async function ingestFactorySnapshot(input, db = require('../config/prisma')) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw fromZodError(parsed.error);
  const { factoryId, expectedHeadRevision, snapshot, sourceId } = parsed.data;
  const payload = await validatePayload(snapshot); // No DB transaction until canonical validation succeeds.
  if (payload.factory_id !== factoryId) throw new ApiError(400, 'FACTORY_SCOPE_MISMATCH', 'Snapshot factory does not match ingestion scope');
  const hash = contentHash(payload);

  return db.$transaction(async (tx) => {
    // Same lock namespace as canonical seed; no unrelated factory is globally locked.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${factoryId}, 0))::text`;
    const key = { factoryId_snapshotId: { factoryId, snapshotId: payload.snapshot_id } };
    const existing = await tx.factorySnapshot.findUnique({ where: key });
    const current = await tx.operationsHead.findUnique({ where: { factoryId } });
    if (existing) {
      if (existing.contentHash !== hash || contentHash(existing.payloadJson) !== hash || existing.schemaVersion !== '3.0') {
        throw new ApiError(409, 'SNAPSHOT_CONTENT_CONFLICT', 'Snapshot ID already contains different immutable content');
      }
      // Replay is a no-op even with a stale expected revision or an older snapshot.
      // Never re-publish an old ID or append another audit event.
      if (!current) throw headConflict();
      return receipt(existing, current, true);
    }
    if ((current?.revision ?? 0) !== expectedHeadRevision) throw headConflict();
    const row = await tx.factorySnapshot.create({ data: {
      factoryId, snapshotId: payload.snapshot_id, sourceId, schemaVersion: '3.0',
      contentHash: hash, payloadJson: payload, capturedAt: new Date(payload.captured_at),
    } });
    let next;
    if (current) {
      const changed = await tx.operationsHead.updateMany({
        where: { factoryId, revision: expectedHeadRevision },
        data: { snapshotId: row.snapshotId, revision: { increment: 1 } },
      });
      if (changed.count !== 1) throw headConflict();
      next = await tx.operationsHead.findUnique({ where: { factoryId } });
    } else {
      // Ingestion is observation-only. Embedded current_schedule is evidence,
      // never authority to create/publish a schedule in a new factory.
      next = await tx.operationsHead.create({ data: { factoryId, snapshotId: row.snapshotId,
        revision: 1, planVersion: 0, scheduleId: null, scheduleRevision: null } });
    }
    await tx.auditLog.create({ data: {
      entityType: 'SYSTEM', entityId: factoryId, action: 'OPERATIONS_SNAPSHOT_INGESTED',
      payloadJson: { factoryId, snapshotId: row.snapshotId, sourceId, contentHash: hash,
        previousSnapshotId: current?.snapshotId ?? null, previousHeadRevision: current?.revision ?? 0,
        headRevision: next.revision, scheduleId: next.scheduleId, scheduleRevision: next.scheduleRevision,
        planVersion: next.planVersion },
    } });
    return receipt(row, next, false);
  }, { isolationLevel: 'ReadCommitted' }).catch((error) => {
    // CAS also fences writers that fail to take the advisory lock. Unique races
    // during first-head creation must never leak partial snapshot/audit writes.
    if (['P2002', 'P2034'].includes(error.code)) throw headConflict();
    throw error;
  });
}
module.exports = { ingestFactorySnapshot };
