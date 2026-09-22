const { ApiError } = require('../lib/api-error');
const { contentHash, validatePayload } = require('./operations-contract.service');
const notFound = () => new ApiError(404, 'FACTORY_NOT_FOUND', 'Factory was not found');
const conflict = () => new ApiError(409, 'OPERATIONS_SEED_CONFLICT', 'Immutable seed content or current head differs; seed will not overwrite it');

function authorizeFactory(user, factoryId) {
  if (user.role === 'ADMIN') return;
  let grants;
  try { grants = JSON.parse(process.env.OPERATIONS_FACTORY_ACCESS || '{}'); }
  catch { throw new ApiError(503, 'FACTORY_ACCESS_UNAVAILABLE', 'Factory access configuration is unavailable'); }
  if (!grants || typeof grants !== 'object' || Array.isArray(grants)) throw new ApiError(503, 'FACTORY_ACCESS_UNAVAILABLE', 'Factory access configuration is unavailable');
  if (!Object.hasOwn(grants, factoryId) || !Array.isArray(grants[factoryId]) || !grants[factoryId].includes(user.id)) throw notFound();
}

async function seedOperations(db, plan, { factoryId } = {}) {
  const payload = await validatePayload(plan, 'seed');
  if (!factoryId || payload.factory_id !== factoryId) throw new ApiError(400, 'FACTORY_SCOPE_MISMATCH', 'Explicit seed factory must match canonical scenario');
  const schedule = payload.current_schedule;
  const planVersion = schedule ? 1 : 0;
  const snapshotHash = contentHash(payload);
  const scheduleHash = schedule ? contentHash(schedule) : null;
  // Stable IDs and per-factory transaction advisory lock serialize concurrent seed replays.
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${factoryId}, 0))::text`;
    const where = { factoryId_snapshotId: { factoryId, snapshotId: payload.snapshot_id } };
    let snapshotRow = await tx.factorySnapshot.findUnique({ where });
    if (snapshotRow && (snapshotRow.contentHash !== snapshotHash || contentHash(snapshotRow.payloadJson) !== snapshotHash || snapshotRow.schemaVersion !== '3.0')) throw conflict();
    if (!snapshotRow) snapshotRow = await tx.factorySnapshot.create({ data: {
      factoryId, snapshotId: payload.snapshot_id, schemaVersion: '3.0', contentHash: snapshotHash,
      payloadJson: payload, capturedAt: new Date(payload.captured_at),
    } });
    if (schedule) {
      const scheduleWhere = { factoryId_scheduleId_revision: { factoryId, scheduleId: schedule.schedule_id, revision: schedule.revision } };
      const previous = await tx.operationSchedule.findUnique({ where: scheduleWhere });
      if (previous && (previous.contentHash !== scheduleHash || contentHash(previous.payloadJson) !== scheduleHash || previous.snapshotId !== payload.snapshot_id || previous.schemaVersion !== '3.0')) throw conflict();
      if (!previous) await tx.operationSchedule.create({ data: {
        factoryId, scheduleId: schedule.schedule_id, revision: schedule.revision, snapshotId: payload.snapshot_id,
        schemaVersion: '3.0', contentHash: scheduleHash, payloadJson: schedule,
      } });
    }
    const head = await tx.operationsHead.findUnique({ where: { factoryId } });
    if (head && (head.snapshotId !== payload.snapshot_id || head.scheduleId !== (schedule?.schedule_id ?? null)
      || head.scheduleRevision !== (schedule?.revision ?? null) || head.planVersion !== planVersion)) throw conflict();
    if (!head) await tx.operationsHead.create({ data: { factoryId, snapshotId: payload.snapshot_id,
      scheduleId: schedule?.schedule_id ?? null, scheduleRevision: schedule?.revision ?? null, planVersion } });
    return { factory_id: factoryId, snapshot_id: payload.snapshot_id, snapshot_hash: snapshotHash,
      schedule_hash: scheduleHash, plan_version: planVersion, machines: payload.machines.length, replayed: Boolean(head) };
  });
}

async function readOperations(db, user, factoryId) {
  authorizeFactory(user, factoryId);
  const head = await db.$transaction((tx) => tx.operationsHead.findUnique({ where: { factoryId }, include: { snapshot: true, schedule: true } }), { isolationLevel: 'RepeatableRead' });
  if (!head) throw notFound();
  const { snapshot, schedule } = head;
  const corrupt = () => new ApiError(500, 'OPERATIONS_INTEGRITY_ERROR', 'Stored operations context failed integrity validation');
  if (snapshot.schemaVersion !== '3.0' || contentHash(snapshot.payloadJson) !== snapshot.contentHash) throw corrupt();
  let payload;
  try { payload = await validatePayload(snapshot.payloadJson); }
  catch (error) { if (error.statusCode === 400) throw corrupt(); throw error; }
  if (contentHash(payload) !== snapshot.contentHash || payload.factory_id !== factoryId || payload.snapshot_id !== snapshot.snapshotId
    || new Date(payload.captured_at).getTime() !== snapshot.capturedAt.getTime()) throw corrupt();
  if (schedule) {
    if (schedule.schemaVersion !== '3.0' || schedule.factoryId !== factoryId
      || contentHash(schedule.payloadJson) !== schedule.contentHash || contentHash(payload.current_schedule) !== schedule.contentHash
      || schedule.payloadJson.schedule_id !== schedule.scheduleId || schedule.payloadJson.revision !== schedule.revision) throw corrupt();
  } else if (payload.current_schedule !== null) throw corrupt();
  const currentSchedule = schedule?.payloadJson ?? null;
  return {
    snapshot: {
      factory_id: factoryId,
      snapshot_id: snapshot.snapshotId,
      schema_version: '3.0',
      captured_at: payload.captured_at,
      plan_version: head.planVersion,
      current_schedule_id: schedule?.scheduleId ?? null,
      snapshot: payload,
    },
    schedule: {
      factory_id: factoryId,
      snapshot_id: snapshot.snapshotId,
      plan_version: head.planVersion,
      schedule: currentSchedule,
      commit: null,
    },
    meta: {
      factory_id: factoryId, snapshot_id: snapshot.snapshotId, schema_version: '3.0', plan_version: head.planVersion,
      snapshot_hash: snapshot.contentHash, schedule_hash: schedule?.contentHash ?? null,
      schedule_revision: schedule?.revision ?? null, schedule_basis_snapshot_id: schedule?.snapshotId ?? null,
      head_revision: head.revision,
    },
  };
}
module.exports = { seedOperations, readOperations, authorizeFactory };
