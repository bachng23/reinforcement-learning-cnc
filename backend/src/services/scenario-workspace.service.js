const { randomUUID, createHmac, timingSafeEqual } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { ApiError } = require('../lib/api-error');
const access = require('./factory-access.service');
const policy = require('./scenario-policy');
const { contentHash, validatePayload } = require('./operations-contract.service');
const notFound = () => new ApiError(404, 'SCENARIO_NOT_FOUND', 'Scenario resource was not found');
const conflict = () => new ApiError(409, 'SCENARIO_REVISION_CONFLICT', 'Draft revision changed; reload before editing or enqueueing.');
const json = value => JSON.stringify(value);
const iso = value => value?.toISOString() ?? null;

function engineIdentity() {
  const values = [process.env.SCENARIO_ENGINE_VERSION, process.env.SCENARIO_CONTRACT_VERSION, process.env.SCENARIO_SAMPLING_VERSION];
  if (!values.every(value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)))
    throw new ApiError(503, 'SCENARIO_ENGINE_CONTRACT_UNAVAILABLE', 'A reviewed engine, contract and sampling version must be configured');
  return { engine_version: values[0], contract_version: values[1], sampling_version: values[2] };
}
function workspaceDto(row, head) {
  return { workspace_id: row.id, name: row.name,
    baseline: { factory_id: row.factory_id, snapshot_id: row.snapshot_id, snapshot_hash: row.snapshot_hash,
      plan_version: row.plan_version, publication: row.schedule_id ? { schedule_id: row.schedule_id,
        schedule_revision: row.schedule_revision, schedule_hash: row.schedule_hash } : null },
    planning_config: row.config_json, engine_version: row.engine_version, contract_version: row.contract_version,
    created_by: row.actor_id, created_at: iso(row.created_at),
    current_head: head ? { snapshot_id: head.snapshotId, plan_version: head.planVersion, revision: head.revision } : null,
    stale: !head || head.snapshotId !== row.snapshot_id || head.planVersion !== row.plan_version };
}
function draftDto(row) {
  return { ...row.payload_json, workspace_id: row.workspace_id, scenario_id: row.id, revision: row.revision,
    created_at: iso(row.created_at), updated_at: iso(row.updated_at) };
}
async function workspaceRow(tx, id) {
  if (!policy.uuid.safeParse(id).success) throw notFound();
  const [row] = await tx.$queryRaw`SELECT * FROM scenario_workspaces WHERE id=${id}::uuid`;
  if (!row) throw notFound();
  return row;
}
async function accessible(tx, identity, id) {
  const row = await workspaceRow(tx, id);
  try { await access.authorizeFactory(tx, identity, row.factory_id); }
  catch (error) { if (error.statusCode === 404) throw notFound(); throw error; }
  return row;
}
async function authorizeWrite(tx, identity, factoryId) {
  await access.lockFactory(tx, factoryId);
  await access.lockUsers(tx, [identity.id]);
  const user = await access.currentUser(tx, identity, ['ADMIN', 'ENGINEER']);
  try { await access.authorizeFactory(tx, user, factoryId); }
  catch (error) { if (error.statusCode === 404) throw notFound(); throw error; }
  return user;
}
async function event(tx, workspace, actorId, type, payload, jobId = null) {
  await tx.$executeRaw`INSERT INTO scenario_events(factory_id,workspace_id,job_id,type,actor_id,source,payload_json)
    VALUES(${workspace.factory_id},${workspace.id}::uuid,${jobId}::uuid,${type},${actorId}::uuid,${actorId ? 'HTTP' : 'WORKER'},${json(payload)}::jsonb)`;
}
async function draftRow(tx, workspace, id) {
  if (!policy.uuid.safeParse(id).success) throw notFound();
  const [row] = await tx.$queryRaw`SELECT d.*,r.payload_json FROM scenario_drafts d
    JOIN scenario_draft_revisions r ON (r.factory_id,r.workspace_id,r.scenario_id,r.revision)=(d.factory_id,d.workspace_id,d.id,d.revision)
    WHERE d.factory_id=${workspace.factory_id} AND d.workspace_id=${workspace.id}::uuid AND d.id=${id}::uuid`;
  if (!row) throw notFound();
  return row;
}
function checkHead(head, expected) {
  if (!head || head.snapshotId !== expected.snapshot_id || head.planVersion !== expected.plan_version || head.revision !== expected.revision)
    throw new ApiError(409, 'SCENARIO_HEAD_CONFLICT', 'Expected Operations head is no longer current');
}
async function create(tx, actor, body) {
  const head = await tx.operationsHead.findUnique({ where: { factoryId: body.factory_id }, include: { snapshot: true, schedule: true } });
  checkHead(head, body.expected_head);
  const identity = engineIdentity(), snapshot = head.snapshot;
  if (contentHash(snapshot.payloadJson) !== snapshot.contentHash || (head.schedule && contentHash(head.schedule.payloadJson) !== head.schedule.contentHash))
    throw new ApiError(500, 'SCENARIO_SOURCE_INTEGRITY_ERROR', 'Immutable source hash validation failed');
  const windowMinutes = (Date.parse(snapshot.payloadJson.planning_window.end_at) - Date.parse(snapshot.payloadJson.planning_window.start_at)) / 60000;
  if (body.planning_config.horizon_minutes !== windowMinutes)
    throw new ApiError(400, 'SCENARIO_INVALID_WINDOW', 'Planning horizon must equal the pinned snapshot window');
  const id = randomUUID();
  const sampling = { version: identity.sampling_version, base_seed: body.planning_config.base_seed, sample_count: body.planning_config.simulation_runs };
  const [row] = await tx.$queryRaw`INSERT INTO scenario_workspaces
    (id,factory_id,name,snapshot_id,snapshot_hash,plan_version,schedule_id,schedule_revision,schedule_hash,baseline_json,config_json,sampling_json,engine_version,contract_version,actor_id)
    VALUES(${id}::uuid,${body.factory_id},${body.name},${head.snapshotId},${snapshot.contentHash},${head.planVersion},
      ${head.scheduleId},${head.scheduleRevision},${head.schedule?.contentHash ?? null},${json(snapshot.payloadJson)}::jsonb,
      ${json(body.planning_config)}::jsonb,${json(sampling)}::jsonb,${identity.engine_version},${identity.contract_version},${actor.id}::uuid) RETURNING *`;
  await event(tx, row, actor.id, 'WORKSPACE_CREATED', { baseline_snapshot_id: row.snapshot_id, baseline_hash: row.snapshot_hash, plan_version: row.plan_version });
  return { workspace: row, status: 201, data: workspaceDto(row, head) };
}
async function saveDraft(tx, actor, workspace, body, id) {
  const previous = id ? await draftRow(tx, workspace, id) : null;
  if (previous && previous.revision !== body.expected_revision) throw conflict();
  const payload = { name: body.name, note: body.note,
    overrides: policy.validateTargets(workspace.baseline_json, body.overrides), objective_weights: body.objective_weights };
  const revision = previous ? previous.revision + 1 : 1;
  id ??= randomUUID();
  if (!previous) await tx.$executeRaw`INSERT INTO scenario_drafts(id,factory_id,workspace_id,actor_id)
    VALUES(${id}::uuid,${workspace.factory_id},${workspace.id}::uuid,${actor.id}::uuid)`;
  await tx.$executeRaw`INSERT INTO scenario_draft_revisions(factory_id,workspace_id,scenario_id,revision,payload_json,content_hash,actor_id)
    VALUES(${workspace.factory_id},${workspace.id}::uuid,${id}::uuid,${revision},${json(payload)}::jsonb,${contentHash(payload)},${actor.id}::uuid)`;
  if (previous) {
    const changed = await tx.$executeRaw`UPDATE scenario_drafts SET revision=${revision},updated_at=clock_timestamp()
      WHERE id=${id}::uuid AND factory_id=${workspace.factory_id} AND workspace_id=${workspace.id}::uuid AND revision=${body.expected_revision}`;
    if (changed !== 1) throw conflict();
  }
  await event(tx, workspace, actor.id, previous ? 'DRAFT_REVISED' : 'DRAFT_CREATED', { scenario_id: id, revision, content_hash: contentHash(payload) });
  return { workspace, status: previous ? 200 : 201, data: draftDto(await draftRow(tx, workspace, id)) };
}
const commands = { create: policy.createWorkspace, createDraft: policy.createDraft, updateDraft: policy.updateDraft, enqueueRun: policy.enqueueRun, enqueueSensitivity: policy.enqueueSensitivity, liveEvaluation: policy.liveEvaluation };
async function write(db, identity, command, workspaceId, rawBody, rawKey, resourceId, prepared) {
  const body = policy.parse(commands[command], rawBody), key = policy.parse(policy.key, rawKey);
  if (body.overrides) body.overrides = policy.canonicalOverrides(body.overrides);
  const requestHash = contentHash({ command, workspace_id: workspaceId ?? null, resource_id: resourceId ?? null, body });
  const written = await db.$transaction(async tx => {
    // Role denial must not reveal whether a guessed workspace exists. This is
    // only an early guard; authorizeWrite rechecks after factory/user locks.
    await access.currentUser(tx, identity, ['ADMIN', 'ENGINEER']);
    const workspace = command === 'create' ? null : await workspaceRow(tx, workspaceId);
    const factoryId = workspace?.factory_id ?? body.factory_id;
    const actor = await authorizeWrite(tx, identity, factoryId);
    const [receipt] = await tx.$queryRaw`SELECT request_hash,response_json,response_status FROM scenario_command_receipts
      WHERE factory_id=${factoryId} AND actor_id=${actor.id}::uuid AND key=${key}`;
    if (receipt) {
      if (receipt.request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used with a different request');
      return { body: receipt.response_json, status: receipt.response_status, replayed: true };
    }
    if (command === 'liveEvaluation' && !prepared)
      return { preparation: await require('./scenario-live.service').prepare(tx, actor, workspace, body) };
    const result = command === 'create' ? await create(tx, actor, body)
      : command === 'enqueueRun' ? await require('./scenario-job.service').enqueueRun(tx, actor, workspace, body)
        : command === 'enqueueSensitivity' ? await require('./scenario-job.service').enqueueSensitivity(tx, actor, workspace, body)
        : command === 'liveEvaluation' ? await require('./scenario-live.service').create(tx, actor, workspace, body, prepared)
        : await saveDraft(tx, actor, workspace, body, command === 'updateDraft' ? resourceId : undefined);
    const response = { success: true, data: result.data };
    await tx.$executeRaw`INSERT INTO scenario_command_receipts(factory_id,actor_id,key,workspace_id,request_hash,response_json,response_status)
      VALUES(${factoryId},${actor.id}::uuid,${key},${result.workspace.id}::uuid,${requestHash},${json(response)}::jsonb,${result.status})`;
    return { body: response, status: result.status, replayed: false };
  }, { timeout: 15000 });
  if (!written.preparation) return written;
  // Canonical Python validation runs outside a DB transaction. The second
  // transaction repeats authorization, receipt lookup and the current-head fence.
  const request = await validatePayload(written.preparation.request, 'case-request');
  return write(db, identity, command, workspaceId, rawBody, rawKey, resourceId, { ...written.preparation, request });
}
function cursorSignature(payload) {
  if (!process.env.JWT_SECRET) throw new ApiError(503, 'SCENARIO_CURSOR_UNAVAILABLE', 'Cursor signing is unavailable');
  return createHmac('sha256', process.env.JWT_SECRET).update(`scenario-v1:${payload}`).digest();
}
function encodeCursor(scope, row) {
  const payload = Buffer.from(json({ scope, at: row.cursor_at, id: row.id })).toString('base64url');
  return `${payload}.${cursorSignature(payload).toString('base64url')}`;
}
function decodeCursor(scope, raw) {
  if (!raw) return null;
  const invalid = () => new ApiError(400, 'INVALID_CURSOR', 'Cursor is invalid for this scope');
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw)) throw invalid();
  const [payload, signature] = raw.split('.');
  const bytes = Buffer.from(signature, 'base64url');
  if (bytes.toString('base64url') !== signature || !timingSafeEqual(cursorSignature(payload), bytes)) throw invalid();
  let parsed;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw invalid(); }
  if (json(parsed.scope) !== json(scope) || !policy.uuid.safeParse(parsed.id).success ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(parsed.at)) throw invalid();
  return parsed;
}
async function get(db, identity, workspaceId, scenarioId) {
  return db.$transaction(async tx => {
    const workspace = await accessible(tx, identity, workspaceId);
    const data = scenarioId ? draftDto(await draftRow(tx, workspace, scenarioId))
      : workspaceDto(workspace, await tx.operationsHead.findUnique({ where: { factoryId: workspace.factory_id } }));
    return { success: true, data };
  }, { isolationLevel: 'RepeatableRead' });
}
async function baselineEntities(db, identity, workspaceId) {
  return db.$transaction(async tx => {
    const workspace = await accessible(tx, identity, workspaceId);
    const snapshot = workspace.baseline_json;
    if (contentHash(snapshot) !== workspace.snapshot_hash || snapshot.factory_id !== workspace.factory_id || snapshot.snapshot_id !== workspace.snapshot_id)
      throw new ApiError(500, 'SCENARIO_SOURCE_INTEGRITY_ERROR', 'Pinned snapshot integrity validation failed');
    return { success: true, data: { workspace_id: workspace.id, baseline: workspaceDto(workspace, null).baseline,
      planning_window: { start_at: snapshot.planning_window.start_at, end_at: snapshot.planning_window.end_at },
      technicians: snapshot.technicians.map(row => ({ technician_id: row.technician_id, display_name: row.display_name,
        availability: row.availability.map(interval => ({ start_at: interval.start_at, end_at: interval.end_at })) })),
      maintenance_requests: snapshot.maintenance_requests.map(row => ({ maintenance_request_id: row.maintenance_request_id,
        machine_id: row.machine_id, expected_duration_minutes: row.expected_duration_minutes,
        earliest_start_at: row.earliest_start_at ?? null, latest_start_at: row.latest_start_at ?? null,
        mandatory: row.mandatory, priority: row.priority, status: row.status })) } };
  }, { isolationLevel: 'RepeatableRead' });
}
async function list(db, identity, rawQuery, workspaceId) {
  const query = policy.parse(workspaceId ? policy.page : policy.listWorkspaces, rawQuery);
  return db.$transaction(async tx => {
    const workspace = workspaceId ? await accessible(tx, identity, workspaceId) : null;
    const factoryId = workspace?.factory_id ?? query.factory_id;
    await access.authorizeFactory(tx, identity, factoryId);
    const scope = { actor_id: identity.id, factory_id: factoryId, workspace_id: workspaceId ?? null, kind: workspaceId ? 'draft' : 'workspace' };
    const after = decodeCursor(scope, query.cursor);
    const table = workspaceId ? Prisma.sql`scenario_drafts` : Prisma.sql`scenario_workspaces`;
    const columns = workspaceId ? Prisma.sql`id,workspace_id,revision,created_at,updated_at`
      : Prisma.sql`id,factory_id,name,snapshot_id,snapshot_hash,plan_version,schedule_id,schedule_revision,schedule_hash,config_json,engine_version,contract_version,actor_id,created_at`;
    const rows = await tx.$queryRaw(Prisma.sql`SELECT ${columns},to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
      FROM ${table} WHERE factory_id=${factoryId}
      ${workspaceId ? Prisma.sql`AND workspace_id=${workspaceId}::uuid` : Prisma.empty}
      ${after ? Prisma.sql`AND (created_at,id)<(${after.at}::timestamptz,${after.id}::uuid)` : Prisma.empty}
      ORDER BY created_at DESC,id DESC LIMIT ${query.limit + 1}`);
    const selected = rows.slice(0, query.limit);
    let items;
    if (workspaceId) {
      // One revision query for the whole page, no N+1 hydration.
      const revisions = selected.length ? await tx.$queryRaw(Prisma.sql`SELECT r.* FROM scenario_draft_revisions r
        JOIN scenario_drafts d ON (d.factory_id,d.workspace_id,d.id,d.revision)=(r.factory_id,r.workspace_id,r.scenario_id,r.revision)
        WHERE r.factory_id=${factoryId} AND r.workspace_id=${workspaceId}::uuid AND r.scenario_id IN (${Prisma.join(selected.map(r => Prisma.sql`${r.id}::uuid`))})`) : [];
      const byId = new Map(revisions.map(row => [row.scenario_id, row.payload_json]));
      items = selected.map(row => draftDto({ ...row, payload_json: byId.get(row.id) }));
    } else {
      const head = await tx.operationsHead.findUnique({ where: { factoryId } });
      items = selected.map(row => workspaceDto(row, head));
    }
    return { success: true, data: { items, next_cursor: rows.length > query.limit ? encodeCursor(scope, selected.at(-1)) : null } };
  }, { isolationLevel: 'RepeatableRead' });
}
module.exports = { write, get, baselineEntities, list, accessible, workspaceRow, draftRow, authorizeWrite, event, checkHead, engineIdentity, workspaceDto, draftDto, notFound, encodeCursor, decodeCursor };
