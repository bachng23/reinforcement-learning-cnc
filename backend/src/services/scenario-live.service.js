const { ApiError } = require('../lib/api-error');
const policy = require('./scenario-policy');
const workspaceService = require('./scenario-workspace.service');
const { jobRow } = require('./scenario-job.service');
const { contentHash } = require('./operations-contract.service');
const { insertValidatedDecisionCase } = require('./decision-case.service');

async function source(tx, workspace, body) {
  const run = await jobRow(tx, workspace, body.source_run_id);
  if (run.status !== 'SUCCEEDED') throw new ApiError(409, 'SCENARIO_RUN_NOT_READY', 'LIVE evaluation requires a saved completed run');
  if (!run.result_json || contentHash(run.result_json) !== run.result_hash || policy.inputHash(run.input_json) !== run.input_hash ||
    run.input_json.factory_id !== workspace.factory_id || run.input_json.workspace_id !== workspace.id ||
    run.input_json.baseline.snapshot_hash !== workspace.snapshot_hash)
    throw new ApiError(500, 'SCENARIO_SOURCE_INTEGRITY_ERROR', 'Completed run integrity validation failed');
  const overrides = policy.canonicalOverrides(run.input_json.overrides);
  if (overrides.some(override => override.type !== 'DEFER_MAINTENANCE')) {
    const physical = overrides.some(override => ['TECHNICIAN_UNAVAILABLE', 'MAINTENANCE_DURATION'].includes(override.type));
    throw new ApiError(409, 'SCENARIO_LIVE_MAPPING_UNSUPPORTED', physical
      ? 'Availability and duration are hypothetical. Update actual data through authorized ingestion and evaluate a new scenario before LIVE handoff.'
      : 'DEFER_MAINTENANCE is not yet representable in the reviewed LIVE contract. A coordinated canonical and engine extension is required.');
  }
  const head = await tx.operationsHead.findUnique({ where: { factoryId: workspace.factory_id } });
  workspaceService.checkHead(head, body.expected_head);
  if (head.snapshotId !== workspace.snapshot_id || head.planVersion !== workspace.plan_version)
    throw new ApiError(409, 'SCENARIO_HEAD_CONFLICT', 'Historical scenario cannot be silently rebased. Create and evaluate a workspace on the current head.');
  return { run, head };
}
async function prepare(tx, actor, workspace, body) {
  const { run } = await source(tx, workspace, body);
  if (run.result_json.scenario?.outcome !== 'FEASIBLE' || run.result_json.live_mapping?.supported !== true)
    throw new ApiError(409, 'SCENARIO_LIVE_MAPPING_UNSUPPORTED', 'Saved run is not feasible or has no supported LIVE mapping');
  const config = require('./scenario-engine.adapter').evaluationRequest(run, 30000).planning_config;
  const bounds = policy.canonicalOverrides(run.input_json.overrides).map(({maintenance_request_id, earliest_start_at}) => ({maintenance_request_id, earliest_start_at}));
  return { source_hash: run.input_hash, actor_id: actor.id, request: { mode: 'LIVE', trigger: { type: 'MANUAL_REPLAN',
    reason: `Evaluate saved scenario run ${run.id} under current LIVE context; a new recommendation and human review are required.`,
    ...(bounds.length ? {maintenance_start_constraints: bounds} : {}) }, planning_config: config } };
}
async function create(tx, actor, workspace, body, prepared) {
  const { run, head } = await source(tx, workspace, body);
  if (prepared.source_hash !== run.input_hash || prepared.request.mode !== 'LIVE' || prepared.request.trigger.type !== 'MANUAL_REPLAN' ||
    prepared.actor_id !== actor.id)
    throw new ApiError(409, 'SCENARIO_RUN_NOT_READY', 'Prepared LIVE request no longer matches its source');
  const caseBody = { factory_id: workspace.factory_id, schema_version: '3.0', expected_snapshot_id: head.snapshotId,
    expected_plan_version: head.planVersion, request: prepared.request };
  const provenance = { workspace_id: workspace.id, run_id: run.id, input_hash: run.input_hash, result_hash: run.result_hash };
  const { row } = await insertValidatedDecisionCase(tx, actor, caseBody, provenance);
  await tx.$executeRaw`INSERT INTO scenario_live_evaluations(case_id,factory_id,workspace_id,run_id,actor_id,input_hash,result_hash,head_revision)
    VALUES(${row.id}::uuid,${workspace.factory_id},${workspace.id}::uuid,${run.id}::uuid,${actor.id}::uuid,${run.input_hash},${run.result_hash},${head.revision})`;
  await workspaceService.event(tx, workspace, actor.id, 'LIVE_EVALUATION_CREATED', { ...provenance, decision_case_id: row.id,
    expected_head: body.expected_head, mapping: prepared.request.trigger.maintenance_start_constraints?.length ? 'OBJECTIVE_WEIGHTS_AND_DEFER_BOUNDS' : 'OBJECTIVE_WEIGHTS_ONLY' }, run.id);
  return { workspace, status: 201, data: { workspace_id: workspace.id, source_run_id: run.id,
    decision_case_id: row.id, mode: 'LIVE', current_head: body.expected_head } };
}
module.exports = { prepare, create };
