const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { ApiError } = require('../lib/api-error');
const policy = require('./scenario-policy');
const workspaceService = require('./scenario-workspace.service');
const { contentHash } = require('./operations-contract.service');
const iso = value => value?.toISOString() ?? null;
const json = value => JSON.stringify(value);

function jobDto(row, points = []) {
  return { workspace_id: row.workspace_id, job_id: row.id, kind: row.kind, status: row.status,
    input_hash: row.input_hash, source_scenario_id: row.source_scenario_id, source_revision: row.source_revision,
    source_run_id: row.source_run_id, engine_version: row.engine_version, contract_version: row.contract_version,
    attempt: row.attempt, created_at: iso(row.created_at), started_at: iso(row.started_at), completed_at: iso(row.completed_at),
    deadline_at: iso(row.deadline_at), error_code: row.error_code, result: row.result_json,
    points: points.map(point => ({ point_index: point.point_index, value: point.value, status: point.status,
      error_code: point.error_code, result: point.result_json })) };
}
async function jobRow(tx, workspace, id, kind = 'RUN') {
  if (!policy.uuid.safeParse(id).success) throw workspaceService.notFound();
  const [row] = await tx.$queryRaw`SELECT * FROM scenario_jobs WHERE factory_id=${workspace.factory_id}
    AND workspace_id=${workspace.id}::uuid AND id=${id}::uuid AND kind=${kind}`;
  if (!row) throw workspaceService.notFound();
  return row;
}
function frozenInput(workspace, draft, publication = null) {
  const config = { ...workspace.config_json,
    objective_weights: draft?.payload_json.objective_weights ?? workspace.config_json.objective_weights };
  return { contract_version: workspace.contract_version, engine_version: workspace.engine_version,
    factory_id: workspace.factory_id, workspace_id: workspace.id,
    baseline: { snapshot_id: workspace.snapshot_id, snapshot_hash: workspace.snapshot_hash,
      plan_version: workspace.plan_version, schedule_id: workspace.schedule_id,
      schedule_revision: workspace.schedule_revision, schedule_hash: workspace.schedule_hash },
    factory_snapshot: workspace.baseline_json, reference_publication: publication, planning_config: config, sampling: workspace.sampling_json,
    overrides: policy.canonicalOverrides(draft?.payload_json.overrides ?? []) };
}
async function enqueueRun(tx, actor, workspace, body) {
  const configured = workspaceService.engineIdentity();
  if (configured.engine_version !== workspace.engine_version || configured.contract_version !== workspace.contract_version ||
    configured.sampling_version !== workspace.sampling_json.version)
    throw new ApiError(409, 'SCENARIO_ENGINE_VERSION_CONFLICT', 'Pinned engine and sampling versions are not served by this deployment');
  let draft = null;
  if (body.kind === 'SCENARIO') {
    draft = await workspaceService.draftRow(tx, workspace, body.scenario_id);
    if (draft.revision !== body.expected_revision)
      throw new ApiError(409, 'SCENARIO_REVISION_CONFLICT', 'Draft revision changed; reload before enqueueing');
  }
  const publication = workspace.schedule_id ? await tx.operationSchedule.findUnique({ where: { factoryId_scheduleId_revision: {
    factoryId: workspace.factory_id, scheduleId: workspace.schedule_id, revision: workspace.schedule_revision } } }) : null;
  if (workspace.schedule_id && (!publication || publication.contentHash !== workspace.schedule_hash || contentHash(publication.payloadJson) !== workspace.schedule_hash))
    throw new ApiError(500, 'SCENARIO_SOURCE_INTEGRITY_ERROR', 'Pinned publication hash validation failed');
  const input = frozenInput(workspace, draft, publication?.payloadJson ?? null), hash = policy.inputHash(input), id = randomUUID();
  if (contentHash(input.factory_snapshot) !== workspace.snapshot_hash)
    throw new ApiError(500, 'SCENARIO_SOURCE_INTEGRITY_ERROR', 'Pinned snapshot hash validation failed');
  const [row] = await tx.$queryRaw`INSERT INTO scenario_jobs
    (id,factory_id,workspace_id,kind,source_scenario_id,source_revision,input_json,input_hash,engine_version,contract_version,deadline_at,actor_id,created_at,updated_at)
    VALUES(${id}::uuid,${workspace.factory_id},${workspace.id}::uuid,'RUN',${draft?.id ?? null}::uuid,${draft?.revision ?? null},
      ${json(input)}::jsonb,${hash},${workspace.engine_version},${workspace.contract_version},statement_timestamp()+interval '300 seconds',${actor.id}::uuid,
      statement_timestamp(),statement_timestamp()) RETURNING *`;
  const evaluations = [{ role: 'BASELINE', input: { ...input, overrides: [] } }];
  if (draft) evaluations.push({ role: 'SCENARIO', input });
  for (const [index, point] of evaluations.entries()) {
    await tx.$executeRaw`INSERT INTO scenario_points(factory_id,workspace_id,job_id,point_index,role,input_json,input_hash)
      VALUES(${workspace.factory_id},${workspace.id}::uuid,${id}::uuid,${index},${point.role},${json(point.input)}::jsonb,${policy.inputHash(point.input)})`;
  }
  await workspaceService.event(tx, workspace, actor.id, 'RUN_ENQUEUED', { input_hash: hash,
    scenario_id: draft?.id ?? null, revision: draft?.revision ?? null }, id);
  const points = await tx.$queryRaw`SELECT point_index,value,status,error_code,result_json FROM scenario_points WHERE job_id=${id}::uuid ORDER BY point_index`;
  return { workspace, status: 202, data: jobDto(row, points) };
}
async function get(db, identity, workspaceId, runId, kind = 'RUN') {
  return db.$transaction(async tx => {
    const workspace = await workspaceService.accessible(tx, identity, workspaceId);
    const row = await jobRow(tx, workspace, runId, kind);
    const points = await tx.$queryRaw`SELECT point_index,value,status,error_code,result_json FROM scenario_points
      WHERE factory_id=${workspace.factory_id} AND workspace_id=${workspace.id}::uuid AND job_id=${row.id}::uuid ORDER BY point_index`;
    return { success: true, data: jobDto(row, points) };
  }, { isolationLevel: 'RepeatableRead' });
}
async function list(db, identity, workspaceId, rawQuery, kind = 'RUN') {
  const query = policy.parse(policy.page, rawQuery);
  return db.$transaction(async tx => {
    const workspace = await workspaceService.accessible(tx, identity, workspaceId);
    const scope = { actor_id: identity.id, factory_id: workspace.factory_id, workspace_id: workspace.id, kind };
    const cursor = workspaceService.decodeCursor(scope, query.cursor);
    const rows = await tx.$queryRaw(Prisma.sql`SELECT id,workspace_id,kind,status,input_hash,source_scenario_id,source_revision,source_run_id,
      engine_version,contract_version,attempt,created_at,started_at,completed_at,deadline_at,error_code,NULL::jsonb AS result_json,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
      FROM scenario_jobs WHERE factory_id=${workspace.factory_id} AND workspace_id=${workspace.id}::uuid AND kind=${kind}
      ${cursor ? Prisma.sql`AND (created_at,id)<(${cursor.at}::timestamptz,${cursor.id}::uuid)` : Prisma.empty}
      ORDER BY created_at DESC,id DESC LIMIT ${query.limit + 1}`);
    const selected = rows.slice(0, query.limit);
    return { success: true, data: { items: selected.map(row => jobDto(row)),
      next_cursor: rows.length > query.limit ? workspaceService.encodeCursor(scope, selected.at(-1)) : null } };
  }, { isolationLevel: 'RepeatableRead' });
}
async function completedRun(tx, workspace, id) {
  const row = await jobRow(tx, workspace, id);
  if (row.status !== 'SUCCEEDED') throw new ApiError(409, 'SCENARIO_RUN_NOT_READY', 'A completed saved run is required');
  if (contentHash(row.result_json) !== row.result_hash || policy.inputHash(row.input_json) !== row.input_hash)
    throw new ApiError(500, 'SCENARIO_SOURCE_INTEGRITY_ERROR', 'Saved run integrity failed');
  return row;
}
async function enqueueSensitivity(tx, actor, workspace, body) {
  const source = await completedRun(tx, workspace, body.source_run_id);
  const axis = body.axis;
  if (axis.type === 'OBJECTIVE_WEIGHT') {
    for (const value of axis.values) policy.parse(policy.weights, { ...source.input_json.planning_config.objective_weights, [axis.weight]: value });
  } else {
    const withoutTarget = source.input_json.overrides.filter(o => !(o.type === 'MAINTENANCE_DURATION' && o.maintenance_request_id === axis.maintenance_request_id));
    for (const value of axis.values) policy.validateTargets(source.input_json.factory_snapshot,
      [...withoutTarget, { type: axis.type, maintenance_request_id: axis.maintenance_request_id, expected_duration_minutes: value }]);
  }
  const id = randomUUID();
  const input = { contract_version: source.contract_version, engine_version: source.engine_version,
    source_job: { id: source.id, factory_id: source.factory_id, workspace_id: source.workspace_id,
      input_json: source.input_json, input_hash: source.input_hash },
    source_result: source.result_json, source_result_hash: source.result_hash, axis };
  const hash = contentHash(input);
  const [row] = await tx.$queryRaw`INSERT INTO scenario_jobs
    (id,factory_id,workspace_id,kind,source_run_id,input_json,input_hash,engine_version,contract_version,deadline_at,actor_id,created_at,updated_at)
    VALUES(${id}::uuid,${workspace.factory_id},${workspace.id}::uuid,'SENSITIVITY',${source.id}::uuid,
      ${json(input)}::jsonb,${hash},${source.engine_version},${source.contract_version},statement_timestamp()+interval '300 seconds',
      ${actor.id}::uuid,statement_timestamp(),statement_timestamp()) RETURNING *`;
  for (const [index, value] of [...axis.values].sort((a, b) => a - b).entries()) {
    const pointInput = { source_run_id: source.id, source_result_hash: source.result_hash, axis: { ...axis, values: [value] } };
    await tx.$executeRaw`INSERT INTO scenario_points(factory_id,workspace_id,job_id,point_index,value,role,input_json,input_hash)
      VALUES(${workspace.factory_id},${workspace.id}::uuid,${id}::uuid,${index},${value},'SAMPLE',${json(pointInput)}::jsonb,${contentHash(pointInput)})`;
  }
  await workspaceService.event(tx, workspace, actor.id, 'SENSITIVITY_ENQUEUED', { input_hash: hash, source_run_id: source.id, axis }, id);
  const points = await tx.$queryRaw`SELECT * FROM scenario_points WHERE job_id=${id}::uuid ORDER BY point_index`;
  return { workspace, status: 202, data: jobDto(row, points) };
}
async function compare(db, identity, workspaceId, query, { signal, client } = {}) {
  const body = policy.parse(policy.compare, query);
  const runs = await db.$transaction(async tx => {
    const workspace = await workspaceService.accessible(tx, identity, workspaceId);
    const rows = [];
    for (const id of body.run_ids) rows.push(await completedRun(tx, workspace, id));
    return rows;
  }, { isolationLevel: 'RepeatableRead' });
  const { evaluationRequest } = require('./scenario-engine.adapter');
  const { ScenarioEngineClient } = require('./scenario-engine.client');
  const result = await (client || new ScenarioEngineClient()).execute({ operation: 'COMPARE', budget: { remaining_ms: 30000 },
    runs: runs.map(row => ({ input: evaluationRequest(row, 30000), result: row.result_json, result_hash: row.result_hash })) }, { signal });
  // Recheck authorization after external work, including membership revocation.
  await db.$transaction(tx => workspaceService.accessible(tx, identity, workspaceId));
  return { success: true, data: result };
}
module.exports = { enqueueRun, enqueueSensitivity, compare, get, list, jobDto, jobRow, frozenInput };
