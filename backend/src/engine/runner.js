const { validateEngineRequest } = require('./contracts');
class EngineRunner {
  // Return an AsyncIterable of v2 events. Honor signal; release resources on abort/return.
  // CPU-intensive execution belongs in a child process/service, never on the worker event loop.
  execute(_request, _options = {}) { throw new Error('EngineRunner.execute must be implemented'); }
}
class AdapterEngineRunner extends EngineRunner {
  constructor(adapter) {
    super();
    if (!adapter || typeof adapter.execute !== 'function' || !adapter.version) throw new Error('Engine adapter requires version and execute(request, { signal })');
    this.adapter = adapter;
    this.version = adapter.version;
  }
  execute(request, { signal } = {}) {
    const stream = this.adapter.execute(validateEngineRequest(request), { signal });
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') throw new Error('Engine adapter must return an AsyncIterable');
    return stream;
  }
}
function createEngineRunner(env = process.env, adapter) {
  if (env.ENGINE_RUNNER === 'fake') {
    if (!['development', 'test'].includes(env.NODE_ENV)) throw new Error('Fake engine requires NODE_ENV=development or test');
    const { FakeEngineRunner } = require('./fake-engine');
    return new FakeEngineRunner();
  }
  if (env.ENGINE_RUNNER === 'adapter' && adapter) return new AdapterEngineRunner(adapter);
  throw new Error('Configure ENGINE_RUNNER=fake explicitly in development/test, or provide a real EngineRunner adapter');
}
module.exports = { EngineRunner, AdapterEngineRunner, createEngineRunner };
