class EngineRunner {
  // Each event is a { type, payload } envelope containing one canonical v2 payload.
  execute(_request, _options = {}) {
    throw new Error('EngineRunner.execute must be implemented');
  }
}

module.exports = { EngineRunner };
