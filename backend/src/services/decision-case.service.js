const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { ApiError, fromZodError } = require('../lib/api-error');
const { authorizeFactory } = require('./operations-context.service');
const { validatePayload, contentHash } = require('./operations-contract.service');

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const createSchema = z.object({ factory_id: identifier, schema_version: z.literal('3.0'),
  expected_snapshot_id: identifier, expected_plan_version: z.number().int().min(0).max(2147483647),
  request: z.object({ mode: z.enum(['LIVE', 'SIMULATION_ONLY']), trigger: z.record(z.string(), z.unknown()),
    planning_config: z.record(z.string(), z.unknown()) }).strict(),
}).strict();
const keySchema = z.string().min(1).max(128).regex(/^[\x21-\x7e]+$/);
const notFound = () => new ApiError(404, 'DECISION_CASE_NOT_FOUND', 'Decision case was not found');
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}
function status(row) {
  return { schema_version: '3.0', decision_case_id: row.id, mode: row.mode, status: row.status,
    snapshot_id: row.snapshotId, created_at: row.createdAt.toISOString(), updated_at: row.createdAt.toISOString(),
    recommendation_id: null, committed_schedule_id: null, error_code: null };
}
function meta(row, head) {
  return { factory_id: row.factoryId, base_plan_version: row.basePlanVersion, case_revision: row.revision,
    current_context: head ? { snapshot_id: head.snapshotId, plan_version: head.planVersion } : null,
    stale: !head || head.snapshotId !== row.snapshotId || head.planVersion !== row.basePlanVersion };
}
async function accessible(tx, user, id) {
  if (!z.string().uuid().safeParse(id).success) throw notFound();
  const row = await tx.decisionCase.findUnique({ where: { id } });
  if (!row) throw notFound();
  try { authorizeFactory(user, row.factoryId); }
  catch (error) { if (error.statusCode === 404) throw notFound(); throw error; }
  return row;
}
async function createDecisionCase(db, user, rawBody, rawKey) {
  if (!['OPERATOR', 'ENGINEER', 'ADMIN'].includes(user.role)) throw new ApiError(403, 'FORBIDDEN', 'This role cannot create decision cases');
  const body = parse(createSchema, rawBody);
  const key = parse(keySchema, rawKey);
  authorizeFactory(user, body.factory_id);
  body.request = await validatePayload(body.request, 'case-request');
  const hash = contentHash(body);
  return db.$transaction(async tx => {
    // Same lock namespace as ingestion/seed: head cannot change between fence and commit.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${body.factory_id}, 0))::text`;
    const receipt = await tx.decisionCaseIdempotencyReceipt.findUnique({ where: {
      factoryId_actorId_key: { factoryId: body.factory_id, actorId: user.id, key },
    } });
    if (receipt) {
      if (receipt.requestHash !== hash) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used with another request');
      return { body: receipt.responseJson, location: `/api/v1/decision-cases/${receipt.caseId}`, replayed: true };
    }
    const head = await tx.operationsHead.findUnique({ where: { factoryId: body.factory_id }, include: { snapshot: true } });
    if (!head) throw new ApiError(404, 'FACTORY_NOT_FOUND', 'Factory was not found');
    if (head.snapshotId !== body.expected_snapshot_id) throw new ApiError(409, 'SNAPSHOT_CONFLICT', 'Expected snapshot is no longer current');
    if (head.planVersion !== body.expected_plan_version) throw new ApiError(409, 'PLAN_VERSION_CONFLICT', 'Expected plan version is no longer current');
    const snapshot = head.snapshot.payloadJson;
    if (contentHash(snapshot) !== head.snapshot.contentHash) throw new ApiError(500, 'OPERATIONS_INTEGRITY_ERROR', 'Snapshot integrity check failed');
    const trigger = body.request.trigger;
    const references = { machine_id: ['machines', 'machine_id'], technician_id: ['technicians', 'technician_id'],
      maintenance_request_id: ['maintenance_requests', 'maintenance_request_id'] };
    for (const [field, [collection, id]] of Object.entries(references)) {
      if (trigger[field] && !(snapshot[collection] || []).some(row => row[id] === trigger[field])) {
        throw new ApiError(400, 'INVALID_TRIGGER_REFERENCE', 'Trigger references a resource outside the pinned snapshot');
      }
    }
    const row = await tx.decisionCase.create({ data: { id: randomUUID(), factoryId: body.factory_id,
      snapshotId: head.snapshotId, basePlanVersion: head.planVersion, mode: body.request.mode,
      requestJson: body, requestHash: hash, actorId: user.id } });
    await tx.decisionCaseEvent.create({ data: { caseId: row.id, sequence: 1, type: 'CASE_CREATED', actorId: user.id,
      payloadJson: { status: 'CREATED', revision: 1 } } });
    const response = { success: true, data: status(row), meta: meta(row, head) };
    await tx.decisionCaseIdempotencyReceipt.create({ data: { factoryId: row.factoryId, actorId: user.id, key,
      requestHash: hash, caseId: row.id, responseJson: response } });
    return { body: response, location: `/api/v1/decision-cases/${row.id}`, replayed: false };
  }, { timeout: 15000 });
}
async function getDecisionCase(db, user, id) {
  return db.$transaction(async tx => {
    const row = await accessible(tx, user, id);
    const head = await tx.operationsHead.findUnique({ where: { factoryId: row.factoryId } });
    return { success: true, data: status(row), meta: meta(row, head) };
  }, { isolationLevel: 'RepeatableRead' });
}
const cursor = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(z.number().int().max(2147483647));
const eventQuery = z.object({ after_sequence: cursor.default(0),
  limit: z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().min(1).max(200)).default(100),
}).strict();
async function getDecisionCaseEvents(db, user, id, rawQuery) {
  const query = parse(eventQuery, rawQuery);
  return db.$transaction(async tx => {
    await accessible(tx, user, id);
    const rows = await tx.decisionCaseEvent.findMany({ where: { caseId: id, sequence: { gt: query.after_sequence } },
      orderBy: { sequence: 'asc' }, take: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { success: true, data: page.map(row => ({ id: row.id, case_id: row.caseId, sequence: row.sequence,
      type: row.type, actor: { kind: 'HUMAN', id: row.actorId }, occurred_at: row.occurredAt.toISOString(),
      // Allowlisted projection; never expose request JSON, arbitrary stored payloads or future worker traces.
      payload: row.type === 'CASE_CREATED' ? { status: 'CREATED', revision: 1 } : {},
    })), meta: { has_more: rows.length > query.limit, next_after_sequence: page.at(-1)?.sequence ?? query.after_sequence } };
  }, { isolationLevel: 'RepeatableRead' });
}
module.exports = { createDecisionCase, getDecisionCase, getDecisionCaseEvents };
