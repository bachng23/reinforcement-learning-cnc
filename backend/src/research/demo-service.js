const prisma = require('../config/prisma');
const { bridge } = require('./bridge');
const { ApiError } = require('../lib/api-error');
const { canonical, sha } = require('./artifact-store');
const scope = user => user.role === 'ADMIN' ? {} : { ownerId: user.id };
const present = row => ({ id: row.id, revision: row.revision, createdAt: row.createdAt, simulation_start: row.createdAt.toISOString(), step_seconds: 900, ...row.payloadJson });

async function read(user, id) {
  const row = await prisma.demoSession.findFirst({ where: { id, ...scope(user) } });
  if (!row) throw new ApiError(404, 'DEMO_NOT_FOUND', 'Simulation session was not found');
  return row;
}
async function create(user, input, key) {
  const hash = sha(canonical(input));
  const identity = { ownerId_requestKey: { ownerId: user.id, requestKey: key } };
  const replay = row => {
    if (row.requestHash !== hash) throw new ApiError(409, 'DEMO_KEY_CONFLICT', 'Create key belongs to another scenario');
    return present(row);
  };
  const previous = await prisma.demoSession.findUnique({ where: identity });
  if (previous) return replay(previous);
  const payloadJson = await bridge({ operation: 'demo_init', options: input });
  try {
    const row = await prisma.$transaction(async tx => {
      const created = await tx.demoSession.create({ data: { ownerId: user.id, requestKey: key, requestHash: hash, payloadJson } });
      await tx.auditLog.create({ data: { entityType: 'SYSTEM', entityId: created.id, action: 'DEMO_CREATED', actorUserId: user.id, payloadJson: { ...input, sourceCommit: payloadJson.source_commit, domain: 'ENGINEERING_SIMULATION' } } });
      return created;
    });
    return present(row);
  } catch (e) {
    if (e.code === 'P2002') {
      const existing = await prisma.demoSession.findUnique({ where: identity });
      if (existing) return replay(existing);
    }
    throw e;
  }
}
async function command(user, id, input, key) {
  const row = await read(user, id);
  const hash = sha(canonical(input));
  if (row.lastCommandKey === key) {
    if (row.lastCommandHash !== hash) throw new ApiError(409, 'DEMO_KEY_CONFLICT', 'Command key belongs to another action');
    return present(row);
  }
  if (row.revision !== input.revision) throw new ApiError(409, 'DEMO_STALE', 'Session changed; reload before deciding');
  if (row.payloadJson.status === 'COMPLETE' && input.command !== 'configure') throw new ApiError(409, 'DEMO_COMPLETE', 'Simulation has completed');
  let payloadJson;
  if (input.command === 'configure') {
    payloadJson = await bridge({ operation: 'demo_configure', session: row.payloadJson, primary: input.primary, baseline: input.baseline, continuous: true });
  } else if (input.command === 'autoplay') {
    payloadJson = await bridge({ operation: 'demo_autoplay', session: row.payloadJson, stop_at: input.stopAt, max_ticks: input.maxTicks });
  } else if (input.command === 'advance') {
    if (row.payloadJson.status === 'REVIEW') throw new ApiError(409, 'DEMO_REVIEW_REQUIRED', 'Review the pending matching before advancing');
    payloadJson = await bridge({ operation: 'demo_prepare', session: row.payloadJson });
    if (input.autoApprove && payloadJson.status === 'REVIEW') {
      payloadJson = await bridge({ operation: 'demo_commit', session: payloadJson, action: payloadJson.pending.action, actor: 'automatic', reason: 'Automatic policy comparison; no human override' });
    }
  } else {
    if (row.payloadJson.status !== 'REVIEW') throw new ApiError(409, 'DEMO_NOT_PENDING', 'No decision is awaiting review');
    const action = input.command === 'approve' ? row.payloadJson.pending.action : input.action;
    payloadJson = await bridge({ operation: 'demo_commit', session: row.payloadJson, action, actor: user.id, reason: input.reason });
  }
  const result = await prisma.$transaction(async tx => {
    const updated = await tx.demoSession.updateMany({ where: { id: row.id, revision: row.revision }, data: {
      payloadJson, revision: { increment: 1 }, lastCommandKey: key, lastCommandHash: hash,
    } });
    if (!updated.count) throw new ApiError(409, 'DEMO_STALE', 'Another command advanced the session; reload');
    await tx.auditLog.create({ data: { entityType: 'SYSTEM', entityId: id, action: `DEMO_${input.command.toUpperCase()}`, actorUserId: user.id,
      payloadJson: { revision: row.revision, tick: row.payloadJson.primary.state.tick, command: input.command, stopAt: input.stopAt, advancedTicks: payloadJson.primary.state.tick - row.payloadJson.primary.state.tick, reason: input.reason, domain: 'ENGINEERING_SIMULATION' } } });
    return tx.demoSession.findUnique({ where: { id } });
  });
  return present(result);
}
module.exports = { read, create, command, present, scope };
