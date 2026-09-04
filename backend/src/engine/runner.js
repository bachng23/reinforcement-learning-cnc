class EngineRunner {
  // Implementations return an AsyncIterable of CNC contract v2 events.
  execute(_request, _options = {}) {
    throw new Error('EngineRunner.execute must be implemented');
  }
}

module.exports = { EngineRunner };
