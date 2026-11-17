const prisma = require('../config/prisma');
const { ApiError } = require('../lib/api-error');
const { canonical, sha } = require('./artifact-store');
const json = value => JSON.parse(JSON.stringify(value));
const scope = user => user.role === 'ADMIN' ? {} : { ownerId: user.id };

async function session(tx, actor, id) {
  await tx.$queryRaw`SELECT id FROM demo_sessions WHERE id = ${id}::uuid FOR UPDATE`;
  const row = await tx.demoSession.findFirst({ where: { id, ...scope(actor) } });
  if (!row) throw new ApiError(404, 'DEMO_NOT_FOUND', 'Simulation session was not found');
  return row;
}
function revision(row, expected) {
  if (row.revision !== expected) throw new ApiError(409, 'DEMO_STALE', 'Session changed; reload before writing');
}

// Runtime work is deliberately outside transactions. Both phases recheck active
// role and scope; the final phase checks revision under the session lock.
async function write(user, key, operation, input, access, prepare, apply) {
  const requestHash = sha(canonical({ operation, input }));
  const phase = commit => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR SHARE`;
    const actor = await tx.user.findUnique({ where: { id: user.id } });
    if (!actor?.active) throw new ApiError(401, 'UNAUTHORIZED', 'Active authentication required');
    if (!['ADMIN', 'ENGINEER'].includes(actor.role)) throw new ApiError(403, 'FORBIDDEN', 'Write role required');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.id + ':' + key}, 0))::text`;
    const row = await access(tx, actor);
    const saved = await tx.demoWriteReceipt.findUnique({ where: { actorId_key: { actorId: actor.id, key } } });
    if (saved) {
      if (saved.requestHash !== requestHash) throw new ApiError(409, 'DEMO_KEY_CONFLICT', 'Key belongs to another request');
      return { replay: true, value: saved.responseBody };
    }
    if (!commit) return { row, actor };
    const value = json(await commit(tx, actor, row));
    await tx.demoWriteReceipt.create({ data: { actorId: actor.id, key, requestHash, responseBody: value } });
    return { value };
  }, { maxWait: 10000, timeout: 15000 });
  if (!prepare) return (await phase(apply)).value;
  const first = await phase(null);
  if (first.replay) return first.value;
  const prepared = await prepare(first.row, first.actor);
  return (await phase((tx, actor, row) => apply(tx, actor, row, prepared))).value;
}
async function audit(tx, actor, entityId, action, payloadJson) {
  await tx.auditLog.create({ data: { entityType: 'SYSTEM', entityId, action,
    actorUserId: actor.id, payloadJson: json({ ...payloadJson, domain: 'ENGINEERING_SIMULATION' }) } });
}
module.exports = { write, session, revision, audit, scope, json };
