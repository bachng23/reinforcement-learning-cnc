const { FakeEngineRunner } = require('../src/engine/fake-engine');
const { validateEngineEvent } = require('../src/engine/contracts');

async function run(seed, environmentConfig = { machineCount: 4, steps: 4, spareCount: 1 }) {
  const events = [];
  const runner = new FakeEngineRunner();
  for await (const event of runner.execute({
    episodeId: 'episode-1', environmentConfig, policyId: 'policy-1', policyVersion: '1', seed,
  })) events.push(event);
  return events;
}

test('fake engine is deterministic, valid, and includes required fixture outcomes', async () => {
  const first = await run(42);
  const second = await run(42);
  expect(second).toEqual(first);
  first.forEach((event) => expect(() => validateEngineEvent(event)).not.toThrow());

  const serialized = JSON.stringify(first);
  expect(serialized).toContain('CONTINUE');
  expect(serialized).toContain('REPLACE');
  expect(serialized).toContain('REPLACED');
  expect(serialized).toContain('WAITING_FOR_SPARE');
  expect(first.at(-1)).toMatchObject({ type: 'EpisodeSummary', fixture: true, stepsCompleted: 4 });
});

test('different seeds vary stochastic fixture fields', async () => {
  expect(await run(42)).not.toEqual(await run(43));
});
