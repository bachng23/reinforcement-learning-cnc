const { createHmac, timingSafeEqual } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { z } = require('zod');
const { ApiError } = require('../lib/api-error');
const { authorizeFactory } = require('./factory-access.service');
const { parse } = require('./decision-case.service');

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const statuses = ['CREATED', 'ANALYZING', 'GENERATING', 'VALIDATING', 'EXPLAINING',
  'AWAITING_APPROVAL', 'APPROVED', 'MODIFIED', 'REJECTED', 'COMMITTED', 'FAILED', 'CANCELLED'];
const modes = ['LIVE', 'SIMULATION_ONLY'];
const listQuery = z.object({ factory_id: identifier, status: z.enum(statuses).optional(),
  mode: z.enum(modes).optional(), cursor: z.string().optional(),
  limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number)
    .pipe(z.number().int().min(1).max(100)).default(25) }).strict();
const cursorPayload = z.object({ v: z.literal(1), factory_id: identifier,
  status: z.enum(statuses).nullable(), mode: z.enum(modes).nullable(), actor_id: z.string().uuid(),
  created_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
    .refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)),
  id: z.string().uuid() }).strict();
const invalidCursor = () => new ApiError(400, 'INVALID_CURSOR', 'Cursor is invalid or does not match this actor, factory and filters');
function sign(value) {
  if (!process.env.JWT_SECRET) throw new ApiError(503, 'CURSOR_SIGNING_UNAVAILABLE', 'Cursor signing is unavailable');
  return createHmac('sha256', process.env.JWT_SECRET).update('decision-case-list:v1:').update(value).digest();
}
const scope = (query, user) => ({ v: 1, factory_id: query.factory_id,
  status: query.status ?? null, mode: query.mode ?? null, actor_id: user.id });
function decodeCursor(value, query, user) {
  if (value === undefined) return null;
  if (value.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) throw invalidCursor();
  const [payload, signature] = value.split('.');
  const bytes = Buffer.from(signature, 'base64url');
  if (bytes.toString('base64url') !== signature || !timingSafeEqual(sign(payload), bytes)) throw invalidCursor();
  let parsed;
  try {
    const json = Buffer.from(payload, 'base64url');
    if (json.toString('base64url') !== payload) throw invalidCursor();
    parsed = cursorPayload.safeParse(JSON.parse(json.toString('utf8')));
  } catch { throw invalidCursor(); }
  if (!parsed.success || Object.entries(scope(query, user)).some(([key, expected]) => parsed.data[key] !== expected)) throw invalidCursor();
  return parsed.data;
}
function encodeCursor(key, query, user) {
  const payload = Buffer.from(JSON.stringify({ ...scope(query, user), created_at: key.cursorCreatedAt, id: key.id })).toString('base64url');
  return `${payload}.${sign(payload).toString('base64url')}`;
}

// Explicit projection excludes even loading raw request/artifact/snapshot/notes/leases.
const summarySelect = { id: true, factoryId: true, snapshotId: true, mode: true, status: true,
  createdAt: true, updatedAt: true, basePlanVersion: true, revision: true, processingErrorCode: true,
  recommendation: { select: { recommendationId: true } },
  humanDecision: { select: { decision: true, recommendationId: true, candidateId: true,
    candidateVersion: true, actorId: true, decidedAt: true } },
  commit: { select: { scheduleId: true, scheduleRevision: true, planVersion: true,
    snapshotId: true, actorId: true, committedAt: true } } };
function summary(row, head) {
  const human = row.humanDecision, publication = row.commit;
  return { schema_version: '3.0', decision_case_id: row.id, factory_id: row.factoryId,
    mode: row.mode, status: row.status, snapshot_id: row.snapshotId,
    created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
    recommendation_id: row.recommendation?.recommendationId ?? null,
    committed_schedule_id: publication?.scheduleId ?? null,
    error_code: row.status === 'FAILED' ? row.processingErrorCode : null,
    base_plan_version: row.basePlanVersion, case_revision: row.revision,
    current_context: { snapshot_id: head.snapshotId, plan_version: head.planVersion },
    stale: row.snapshotId !== head.snapshotId || row.basePlanVersion !== head.planVersion,
    human_decision: human ? { decision: human.decision, recommendation_id: human.recommendationId,
      candidate_plan_id: human.candidateId, candidate_version: human.candidateVersion,
      actor_id: human.actorId, decided_at: human.decidedAt.toISOString() } : null,
    publication: publication ? { schedule_id: publication.scheduleId, schedule_revision: publication.scheduleRevision,
      plan_version: publication.planVersion, snapshot_id: publication.snapshotId,
      actor_id: publication.actorId, committed_at: publication.committedAt.toISOString() } : null };
}
async function listDecisionCases(db, user, rawQuery) {
  const query = parse(listQuery, rawQuery);
  const after = decodeCursor(query.cursor, query, user);
  return db.$transaction(async tx => {
    await authorizeFactory(tx, user, query.factory_id);
    const head = await tx.operationsHead.findUnique({ where: { factoryId: query.factory_id },
      select: { snapshotId: true, planVersion: true } });
    if (!head) throw new ApiError(404, 'FACTORY_NOT_FOUND', 'Factory was not found');
    // Do not round-trip the ordering timestamp through JS Date: PostgreSQL stores microseconds.
    // All external values are bound parameters, including the tuple seek and page size.
    const keys = await tx.$queryRaw(Prisma.sql`
      SELECT id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorCreatedAt"
      FROM decision_cases WHERE factory_id = ${query.factory_id}
      ${query.status ? Prisma.sql`AND status = ${query.status}` : Prisma.empty}
      ${query.mode ? Prisma.sql`AND mode = ${query.mode}` : Prisma.empty}
      ${after ? Prisma.sql`AND (created_at, id) < (${after.created_at}::timestamptz, ${after.id}::uuid)` : Prisma.empty}
      ORDER BY created_at DESC, id DESC LIMIT ${query.limit + 1}`);
    const page = keys.slice(0, query.limit);
    const rows = page.length ? await tx.decisionCase.findMany({ where: {
      factoryId: query.factory_id, id: { in: page.map(key => key.id) } }, select: summarySelect }) : [];
    const byId = new Map(rows.map(row => [row.id, row]));
    const hasMore = keys.length > query.limit;
    return { success: true, data: page.map(key => summary(byId.get(key.id), head)),
      meta: { factory_id: query.factory_id, limit: query.limit, has_more: hasMore,
        next_cursor: hasMore ? encodeCursor(page.at(-1), query, user) : null } };
  }, { isolationLevel: 'RepeatableRead' });
}
module.exports = { listDecisionCases, listQuery, summarySelect, summary };
