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
  if (events.some((event) => event.episodeId !== episodeId)) {
    throw new EngineProtocolError('Engine event episodeId does not match request');
  }
  const perStep = new Map();
  for (const event of events.slice(0, -1)) {
    if (event.type === 'EpisodeSummary') continue;
    const bucket = perStep.get(event.step) || [];
    bucket.push(event.type);
    perStep.set(event.step, bucket);
  }
  const steps = [...perStep.keys()].sort((a, b) => a - b);
  if (!steps.length || steps.some((step, index) => step !== index)) {
    throw new EngineProtocolError('Simulation steps must be contiguous and start at zero');
  }
  const expected = 'FleetObservation,PolicyRecommendation,StepResult';
  for (const step of steps) {
    if (perStep.get(step).join(',') !== expected) {
      throw new EngineProtocolError(`Step ${step} must contain one ordered observation, recommendation, and result`);
    }
  }
  const summary = summaries[0];
  if (summary.stepsCompleted !== steps.length) {
    throw new EngineProtocolError('Summary stepsCompleted does not match event stream');
  }
}

module.exports = { EngineProtocolError, collectEngineEvents, validateSequence };
