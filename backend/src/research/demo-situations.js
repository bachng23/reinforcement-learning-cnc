const crypto = require('node:crypto');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { ApiError } = require('../lib/api-error');
const { canonical, sha } = require('./artifact-store');
const writes = require('./demo-write');
const runtime = require('./demo-situation-runtime');
const workOrders = require('./demo-work-orders');
const uint = z.number().int().min(0).max(2147483647);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const saveSchema = z.object({ revision: uint, name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''), layoutId: identifier }).strict();
const openSchema = z.object({ revision: uint }).strict();
const incidentSchema = z.object({ revision: uint, machineIndex: uint, componentIndex: uint,
  scheduledTick: uint, reason: z.string().trim().min(1).max(1000) }).strict();
const listSchema = z.object({
  limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().max(100)).default(20),
  cursor: z.string().min(1).max(2048).optional(),
}).strict();
const version = 'jcst-demo-snapshot/1';
const presentSession = row => require('./demo-service').present(row);
function metadata(row) {
  return { snapshotId: row.id, schemaVersion: row.schemaVersion, sourceSessionId: row.sourceSessionId,
    sourceRevision: row.sourceRevision, sourceTick: row.sourceTick, sourceCommit: row.sourceCommit,
    snapshotHash: row.snapshotHash, name: row.name, description: row.description, layoutId: row.layoutId,
    createdAt: row.createdAt, sessionId: row.sourceSessionId, revision: row.sourceRevision, tick: row.sourceTick };
}
async function read(user, id, db = prisma) {
  const row = await db.demoSnapshot.findFirst({ where: { id, ...writes.scope(user) } });
  if (!row) throw new ApiError(404, 'DEMO_SNAPSHOT_NOT_FOUND', 'Saved situation was not found');
  return row;
}
async function detail(user, id) {
  const row = await read(user, id), p = row.payloadJson.runtime;
  return { ...metadata(row), summary: { caseId: p.case_id, seed: p.physical_seed,
    status: p.status, primary: p.primary.controller, baseline: p.baseline.controller,
    machineCount: p.primary.state.components.length, technicianCount: p.primary.state.jobs.length } };
}
function cursor(user, row) {
  const body = Buffer.from(JSON.stringify({ v: 1, actor: user.id, role: user.role, createdAt: row.createdAt.toISOString(), id: row.id })).toString('base64url');
  const mac = crypto.createHmac('sha256', process.env.JWT_SECRET).update('demo-snapshots:' + body).digest('base64url');
  return `${body}.${mac}`;
}
function decode(user, value) {
  try {
    const [body, mac, extra] = value.split('.');
    const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update('demo-snapshots:' + body).digest('base64url');
    if (extra || !mac || mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw Error();
    const c = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (c.v !== 1 || c.actor !== user.id || c.role !== user.role || !z.string().uuid().safeParse(c.id).success
      || !z.string().datetime().safeParse(c.createdAt).success) throw Error();
    return c;
  } catch { throw new ApiError(400, 'DEMO_CURSOR_INVALID', 'Cursor is invalid for this scope'); }
}
async function list(user, { limit, cursor: value }) {
  const c = value && decode(user, value);
  const rows = await prisma.demoSnapshot.findMany({ where: { ...writes.scope(user), ...(c ? { OR: [
    { createdAt: { lt: new Date(c.createdAt) } }, { createdAt: new Date(c.createdAt), id: { lt: c.id } },
  ] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
  // Save supplies a millisecond-precise Date, so cursor and DB ordering agree.
  omit: { payloadJson: true } });
  return { items: rows.slice(0, limit).map(metadata), nextCursor: rows.length > limit ? cursor(user, rows[limit - 1]) : null };
}
async function save(user, id, input, key) {
  return writes.write(user, key, `snapshot.save:${id}`, input, (tx, actor) => writes.session(tx, actor, id), null,
    async (tx, actor, row) => {
      writes.revision(row, input.revision);
      runtime.validate(row.payloadJson);
      const frozenRuntime = { simulation_start: row.createdAt.toISOString(), step_seconds: 900, ...row.payloadJson };
      const payloadJson = { schemaVersion: version, runtime: frozenRuntime,
        context: { ...(row.payloadJson.context ?? {}), layoutId: input.layoutId },
        workOrders: row.workOrdersJson, provenance: { sourceSessionId: id, sourceOwnerId: row.ownerId,
          sourceRevision: row.revision, sourceTick: row.payloadJson.primary.state.tick } };
      const snapshotHash = sha(canonical(payloadJson));
      const saved = await tx.demoSnapshot.create({ data: { ownerId: actor.id, sourceSessionId: id,
        sourceRevision: row.revision, sourceTick: row.payloadJson.primary.state.tick,
        sourceCommit: row.payloadJson.source_commit, schemaVersion: version, snapshotHash,
        name: input.name, description: input.description, layoutId: input.layoutId,
        payloadJson, createdAt: new Date() } });
      await writes.audit(tx, actor, saved.id, 'DEMO_SNAPSHOT_SAVED', { sourceSessionId: id, sourceRevision: row.revision,
        sourceTick: saved.sourceTick, snapshotHash });
      return metadata(saved);
    });
}
async function open(user, id, input, key) {
  return writes.write(user, key, `snapshot.open:${id}`, input, (tx, actor) => read(actor, id, tx),
    async row => {
      if (input.revision !== row.sourceRevision) throw new ApiError(409, 'DEMO_STALE', 'Snapshot source revision differs');
      if (row.schemaVersion !== version || sha(canonical(row.payloadJson)) !== row.snapshotHash)
        throw new ApiError(409, 'DEMO_SNAPSHOT_INCOMPATIBLE', 'Snapshot integrity or schema validation failed');
      return runtime.restore(row.payloadJson);
    }, async (tx, actor, row, restored) => {
      const newId = crypto.randomUUID();
      const payloadJson = { ...restored, playbackPaused: true, branch: { branchId: newId, snapshotId: id,
        snapshotHash: row.snapshotHash, sourceSessionId: row.sourceSessionId,
        sourceRevision: row.sourceRevision, sourceTick: row.sourceTick,
        branchStartTick: row.sourceTick, interventionRevision: 0 }, context: row.payloadJson.context };
      // A branch owns new event/work-order identities; the frozen projection is
      // retained as provenance to preserve evidence evicted from source traces.
      const projection = rebaseProjection(row.payloadJson.workOrders, row.sourceSessionId, newId);
      const created = await tx.demoSession.create({ data: { id: newId, ownerId: actor.id, sourceSnapshotId: id,
        requestKey: `situation:${crypto.randomUUID()}`, requestHash: sha(canonical({ id, input })),
        payloadJson, workOrdersJson: projection ?? workOrders.project(newId, payloadJson) } });
      await writes.audit(tx, actor, newId, 'DEMO_SNAPSHOT_OPENED', payloadJson.branch);
      return presentSession(created);
    });
}
function rebaseProjection(projection, oldId, newId) {
  if (!projection) return null;
  const rename = value => {
    if (typeof value !== 'string') return value;
    const prefix = value.startsWith('wo:je1_') ? 'wo:' : '';
    const id = prefix ? value.slice(3) : value;
    if (!id.startsWith('je1_')) return value;
    const parts = JSON.parse(Buffer.from(id.slice(4), 'base64url').toString());
    if (parts[0] !== oldId) throw new ApiError(409, 'DEMO_SNAPSHOT_INCOMPATIBLE', 'Work-order scope is inconsistent');
    parts[0] = newId;
    return prefix + 'je1_' + Buffer.from(JSON.stringify(parts)).toString('base64url');
  };
  const walk = value => Array.isArray(value) ? value.map(walk) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([k, v]) => [rename(k), walk(v)])) : rename(value);
  return walk(projection);
}
function checkIncident(row, input) {
  writes.revision(row, input.revision);
  const p = row.payloadJson, tick = p.primary.state.tick;
  if (!row.sourceSnapshotId || !p.branch) throw new ApiError(409, 'DEMO_BRANCH_REQUIRED', 'Open a saved situation before creating incidents');
  if (p.status === 'COMPLETE') throw new ApiError(409, 'DEMO_COMPLETE', 'Simulation has completed');
  if (!p.primary.state.components[input.machineIndex]?.[input.componentIndex] || input.scheduledTick < tick || input.scheduledTick > Math.min(2147483647, tick + 100000))
    throw new ApiError(422, 'DEMO_INCIDENT_INVALID', 'Incident target or scheduled tick is outside the session bounds');
  if (p.status === 'REVIEW' && input.scheduledTick === tick) throw new ApiError(409, 'DEMO_REVIEW_REQUIRED', 'Resolve the pending matching before injecting an incident');
  const events = p.incidents ?? [];
  if (events.length >= 1024) throw new ApiError(409, 'DEMO_INCIDENT_LIMIT', 'Session incident limit reached');
  if (events.some(e => e.machineIndex === input.machineIndex && e.componentIndex === input.componentIndex && e.scheduledTick === input.scheduledTick))
    throw new ApiError(409, 'DEMO_INCIDENT_DUPLICATE', 'This component already has an incident at this tick');
}
async function incident(user, id, input, key) {
  return writes.write(user, key, `incident.create:${id}`, input, (tx, actor) => writes.session(tx, actor, id),
    async (row, actor) => {
      checkIncident(row, input);
      const event = { eventId: crypto.randomUUID(), machineIndex: input.machineIndex, componentIndex: input.componentIndex,
        scheduledTick: input.scheduledTick, status: 'SCHEDULED', appliedTick: null, reason: null,
        requestedReason: input.reason, createdBy: actor.id, createdAt: new Date().toISOString() };
      return runtime.incident(row.payloadJson, event);
    }, async (tx, actor, row, result) => {
      checkIncident(row, input);
      result.session.branch.interventionRevision = row.revision + 1;
      const updated = await tx.demoSession.update({ where: { id }, data: { payloadJson: result.session, revision: { increment: 1 } } });
      await writes.audit(tx, actor, id, 'DEMO_INCIDENT_CREATED', { ...result.event, revision: updated.revision, tick: result.session.primary.state.tick });
      return { session: presentSession(updated), event: result.event };
    });
}
function incidents(row) {
  return { sessionId: row.id, revision: row.revision, tick: row.payloadJson.primary.state.tick,
    source: 'JCST_SIMULATION', events: row.payloadJson.incidents ?? [] };
}
module.exports = { saveSchema, openSchema, incidentSchema, listSchema, save, open, read, detail, list, incident, incidents, rebaseProjection };
