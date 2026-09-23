const { ApiError } = require('../lib/api-error');
const { readOperations } = require('./operations-context.service');
const { OperationsPlanningClient } = require('./operations-planning.client');

// Backend read adapter: never accepts a caller-supplied snapshot or fixture.
async function planPersistedSnapshot(db, user, {
  factoryId, decisionCaseId, trigger, planningConfig, mode = 'LIVE',
}, { client = new OperationsPlanningClient(), signal, requestId, correlationId } = {}) {
  const checkCancelled = () => {
    if (signal?.aborted) throw new ApiError(499, 'PLANNING_CANCELLED', 'Operations planning was cancelled');
  };
  checkCancelled();
  let context;
  try { context = await readOperations(db, user, factoryId, { signal }); }
  catch (error) { checkCancelled(); throw error; }
  checkCancelled();
  const snapshot = context.snapshot.snapshot;
  const request = {
    schema_version: '3.0', decision_case_id: decisionCaseId, mode,
    factory_snapshot: snapshot, requested_by_user_id: user.id,
    trigger: trigger ?? {
      type: 'MANUAL_REPLAN', event_id: decisionCaseId, occurred_at: snapshot.captured_at,
      requested_by_user_id: user.id, reason: 'Plan the persisted factory snapshot',
    },
    planning_config: planningConfig ?? {
      horizon_minutes: Math.ceil((Date.parse(snapshot.planning_window.end_at) - Date.parse(snapshot.planning_window.start_at)) / 60000),
      candidate_limit: 3, solver_timeout_seconds: 30, simulation_runs: 100, base_seed: 0,
    },
  };
  return client.plan(request, { signal, requestId, correlationId });
}
module.exports = { planPersistedSnapshot };
