const { contentHash } = require('./operations-contract.service');
const { ApiError } = require('../lib/api-error');
const strategies = { PRODUCTION_PRIORITY: 'production-priority', BALANCED: 'balanced', RELIABILITY_PRIORITY: 'reliability-priority' };

function evaluationRequest(job, remainingMs) {
  const source = job.input_json;
  if (contentHash(source) !== job.input_hash || source.factory_id !== job.factory_id || source.workspace_id !== job.workspace_id)
    throw new ApiError(500, 'SCENARIO_SOURCE_INTEGRITY_ERROR', 'Frozen Scenario input integrity failed');
  const baseline = source.baseline;
  const config = structuredClone(source.planning_config);
  // Product API uses strategy enum names. Explicit one-to-one mapping to the
  // canonical planner IDs; unknown names are rejected, never silently dropped.
  config.allowed_strategy_ids = config.allowed_strategy_ids.map(value => {
    if (!strategies[value]) throw new ApiError(422, 'INVALID_SCENARIO_REQUEST', 'Unsupported strategy');
    return strategies[value];
  });
  return { contract_version: source.contract_version, engine_version: source.engine_version, operation: 'EVALUATE',
    identity: { factory_id: job.factory_id, workspace_id: job.workspace_id, run_id: job.id, frozen_input_hash: job.input_hash },
    baseline: { snapshot: source.factory_snapshot, snapshot_hash: baseline.snapshot_hash,
      publication: baseline.schedule_id ? { schedule_id: baseline.schedule_id, schedule_revision: baseline.schedule_revision,
        schedule_hash: baseline.schedule_hash, plan_version: baseline.plan_version } : null },
    reference_publication: source.reference_publication, planning_config: config,
    overrides: source.overrides, sampling: { ...source.sampling, coupling: 'COMMON_RANDOM_NUMBERS' },
    budget: { remaining_ms: Math.max(1, Math.min(300000, remainingMs)) } };
}

function requestForJob(job, remainingMs) {
  if (job.kind === 'RUN') return evaluationRequest(job, remainingMs);
  if (contentHash(job.input_json) !== job.input_hash) throw new ApiError(500, 'SCENARIO_SOURCE_INTEGRITY_ERROR', 'Frozen sweep input integrity failed');
  const frozen = job.input_json;
  const input = evaluationRequest(frozen.source_job, remainingMs);
  return { contract_version: frozen.contract_version, operation: 'SENSITIVITY', input,
    source_result: frozen.source_result, source_result_hash: frozen.source_result_hash, axis: frozen.axis };
}

module.exports = { evaluationRequest, requestForJob };
