const { createEngineRunner, AdapterEngineRunner } = require('../src/engine/runner');
const { FakeEngineRunner } = require('../src/engine/fake-engine');
test.each([{}, { NODE_ENV: 'production', ENGINE_RUNNER: 'fake' }, { NODE_ENV: 'development' }])('fails closed for unconfigured or forbidden fake runner %j', (env) => {
  expect(() => createEngineRunner(env)).toThrow();
});
test('explicit test fake selection works', () => {
  expect(createEngineRunner({ NODE_ENV: 'test', ENGINE_RUNNER: 'fake' })).toBeInstanceOf(FakeEngineRunner);
});
test('fake constructor rejects production even when directly imported', () => {
  const old = process.env.NODE_ENV;
  try { process.env.NODE_ENV = 'production'; expect(() => new FakeEngineRunner()).toThrow(/restricted/); }
  finally { process.env.NODE_ENV = old; }
});
test('adapter boundary requires a versioned streaming implementation', () => {
  expect(() => new AdapterEngineRunner({})).toThrow();
  expect(createEngineRunner({ ENGINE_RUNNER: 'adapter' }, { version: 'external-v1', async *execute() {} })).toBeInstanceOf(AdapterEngineRunner);
});
