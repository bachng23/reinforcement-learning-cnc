const { validateEngineEvent, validateEngineRequest } = require('../engine/contracts');
class EngineProtocolError extends Error {
  constructor(message, code = 'ENGINE_PROTOCOL_ERROR') { super(message); this.name = 'EngineProtocolError'; this.code = code; }
}
function sequence(episodeId, request) {
  let step = 0;
  let pending = [];
  let summary;
  let terminated = false;
  return {
    accept(event) {
      if (summary) throw new EngineProtocolError('Unexpected event after summary');
      const payload = event.payload;
      if (event.type === 'EpisodeSummary') {
        if (pending.length || !step || payload.steps_completed !== step || payload.episode_id !== episodeId) {
          throw new EngineProtocolError('Summary does not match complete steps or episode');
        }
        if (request && (payload.policy_id !== request.policyId || payload.seed !== request.seed)) {
          throw new EngineProtocolError('Summary policy or seed does not match request');
        }
        summary = event;
        return null;
      }
      if (terminated || event.type !== ['FleetObservation', 'PolicyRecommendation', 'StepResult'][pending.length]) {
        throw new EngineProtocolError(`Step ${step} must contain one ordered observation, recommendation, and result`);
      }
      if (event.type !== 'PolicyRecommendation' && (payload.step !== step || payload.episode_id !== episodeId)) {
        throw new EngineProtocolError('Simulation steps must be contiguous and belong to the requested episode');
      }
      if (pending.length && (payload.observation_id !== pending[0].payload.observation_id
        || (event.type === 'PolicyRecommendation' && payload.actions.observation_id !== payload.observation_id))) {
        throw new EngineProtocolError(`Step ${step} events must reference the same observation`);
      }
      if (event.type === 'PolicyRecommendation' && request
        && (payload.policy_id !== request.policyId || payload.policy_version !== request.policyVersion)) {
        throw new EngineProtocolError('Recommendation policy does not match request');
      }
      pending.push(event);
      if (pending.length !== 3) return null;
      const complete = pending;
      pending = [];
      terminated = payload.episode_terminated;
      step += 1;
      return complete;
    },
    finish() {
      if (!summary) throw new EngineProtocolError('Exactly one final EpisodeSummary is required', 'ENGINE_SUMMARY_MISSING');
      return summary;
    },
  };
}
// Backpressure: request the next engine event only after the current step commits.
async function consumeEngineEvents(runner, request, { timeoutMs = 30000, signal, onStep = async () => {} } = {}) {
  validateEngineRequest(request);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let iterator;
  let timer;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  aborted.catch(() => {});
  // Install before starting the adapter; cancellation also bounds an unresponsive iterator.
  const onAbort = () => rejectAbort(controller.signal.reason || new Error('Engine aborted'));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  try {
    controller.signal.throwIfAborted();
    iterator = runner.execute(request, { signal: controller.signal })[Symbol.asyncIterator]();
    const state = sequence(request.episodeId, request);
    while (true) {
      // Timeout measures a single engine read, not total episode runtime or DB latency.
      timer = setTimeout(() => controller.abort(Object.assign(new Error(`Engine idle for ${timeoutMs}ms`), { code: 'ENGINE_TIMEOUT' })), timeoutMs);
      const item = await Promise.race([iterator.next(), aborted]);
      clearTimeout(timer);
      controller.signal.throwIfAborted();
      if (item.done) return state.finish();
      const step = state.accept(validateEngineEvent(item.value));
      if (step) {
        await onStep(step);
        controller.signal.throwIfAborted();
      }
    }
  } catch (error) {
    controller.abort(error);
    // Never await return(): generators can be stuck in an uncooperative next().
    if (iterator?.return) Promise.resolve().then(() => iterator.return()).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
    aborted.catch(() => {});
  }
}

// Compatibility helper for fixture tests only. Workers use consumeEngineEvents.
async function collectEngineEvents(runner, request, options) {
  const events = [];
  const summary = await consumeEngineEvents(runner, request, { ...options, onStep: async (step) => { events.push(...step); } });
  return [...events, summary];
}
function validateSequence(events, episodeId) {
  const state = sequence(episodeId);
  events.forEach((event) => state.accept(event));
  state.finish();
}
module.exports = { EngineProtocolError, consumeEngineEvents, collectEngineEvents, validateSequence };
