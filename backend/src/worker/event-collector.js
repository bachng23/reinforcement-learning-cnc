const { validateEngineEvent } = require('../engine/contracts');

class EngineProtocolError extends Error {
  constructor(message, code = 'ENGINE_PROTOCOL_ERROR') {
    super(message);
    this.name = 'EngineProtocolError';
    this.code = code;
  }
}

async function nextWithTimeout(iterator, timeoutMs, signal) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Engine exceeded ${timeoutMs}ms timeout`);
      error.name = 'EngineTimeoutError';
      error.code = 'ENGINE_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([iterator.next(), timeout]);
  } finally {
    clearTimeout(timer);
    if (signal?.aborted && iterator.return) await iterator.return();
  }
}

async function collectEngineEvents(runner, request, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const iterator = runner.execute(request, { signal: controller.signal })[Symbol.asyncIterator]();
  const events = [];
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const error = new Error(`Engine exceeded ${timeoutMs}ms timeout`);
        error.name = 'EngineTimeoutError';
        error.code = 'ENGINE_TIMEOUT';
        throw error;
      }
      const item = await nextWithTimeout(iterator, remaining, controller.signal);
      if (item.done) break;
      events.push(validateEngineEvent(item.value));
    }
  } catch (error) {
    controller.abort(error);
    if (iterator.return) {
      try {
        await iterator.return();
      } catch (_cancellationError) {
        // Preserve the original engine or timeout error.
      }
    }
    throw error;
  }

  validateSequence(events, request.episodeId);
  return events;
}

function validateSequence(events, episodeId) {
  const summaries = events.filter((event) => event.type === 'EpisodeSummary');
  if (summaries.length !== 1 || events.at(-1)?.type !== 'EpisodeSummary') {
    throw new EngineProtocolError('Exactly one final EpisodeSummary is required', 'ENGINE_SUMMARY_MISSING');
  }
  const stepEvents = events.slice(0, -1);
  if (!stepEvents.length || stepEvents.length % 3 !== 0) {
    throw new EngineProtocolError('Each step must contain one ordered observation, recommendation, and result');
  }

  const stepCount = stepEvents.length / 3;
  for (let step = 0; step < stepCount; step += 1) {
    const [observationEvent, recommendationEvent, resultEvent] = stepEvents.slice(step * 3, step * 3 + 3);
    if (observationEvent.type !== 'FleetObservation'
      || recommendationEvent.type !== 'PolicyRecommendation'
      || resultEvent.type !== 'StepResult') {
      throw new EngineProtocolError(`Step ${step} must contain one ordered observation, recommendation, and result`);
    }
    const observation = observationEvent.payload;
    const recommendation = recommendationEvent.payload;
    const result = resultEvent.payload;
    if (observation.step !== step || result.step !== step) {
      throw new EngineProtocolError('Simulation steps must be contiguous and start at zero');
    }
    if (observation.episode_id !== episodeId || result.episode_id !== episodeId) {
      throw new EngineProtocolError('Engine event episode_id does not match request');
    }
    if (recommendation.observation_id !== observation.observation_id
      || recommendation.actions.observation_id !== observation.observation_id
      || result.observation_id !== observation.observation_id) {
      throw new EngineProtocolError(`Step ${step} events must reference the same observation`);
    }
  }

  const summary = summaries[0].payload;
  if (summary.episode_id !== episodeId) {
    throw new EngineProtocolError('Episode summary episode_id does not match request');
  }
  if (summary.steps_completed !== stepCount) {
    throw new EngineProtocolError('Summary steps_completed does not match event stream');
  }
}

module.exports = { EngineProtocolError, collectEngineEvents, validateSequence };
