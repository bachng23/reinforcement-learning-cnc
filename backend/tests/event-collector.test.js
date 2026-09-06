const { collectEngineEvents, validateSequence } = require('../src/worker/event-collector');
const { FakeEngineRunner } = require('../src/engine/fake-engine');

const request = {
  episodeId: 'episode-1', environmentConfig: { machineCount: 2, steps: 2 },
  policyId: 'policy-1', policyVersion: '1', seed: 7,
};

test('collects a complete, correctly ordered engine stream', async () => {
  const events = await collectEngineEvents(new FakeEngineRunner(), request, { timeoutMs: 1000 });
  expect(events.map((event) => event.type)).toEqual([
    'FleetObservation', 'PolicyRecommendation', 'StepResult',
    'FleetObservation', 'PolicyRecommendation', 'StepResult', 'EpisodeSummary',
  ]);
});

test('rejects malformed engine events without repairing them', async () => {
  const runner = { async *execute() { yield { type: 'FleetObservation', broken: true }; } };
  await expect(collectEngineEvents(runner, request)).rejects.toMatchObject({ code: 'ENGINE_EVENT_INVALID' });
});

test('rejects streams missing a final summary', async () => {
  const runner = { async *execute() {} };
  await expect(collectEngineEvents(runner, request)).rejects.toMatchObject({ code: 'ENGINE_SUMMARY_MISSING' });
});

test('rejects duplicate or incomplete step delivery', () => {
  expect(() => validateSequence([
    { type: 'FleetObservation', episodeId: 'episode-1', step: 0 },
    { type: 'FleetObservation', episodeId: 'episode-1', step: 0 },
    { type: 'EpisodeSummary', episodeId: 'episode-1', stepsCompleted: 1 },
  ], 'episode-1')).toThrow(/must contain one ordered/);
});

test('times out a stalled engine', async () => {
  const runner = {
    execute() {
      return { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; } };
    },
  };
  await expect(collectEngineEvents(runner, request, { timeoutMs: 10 })).rejects.toMatchObject({ code: 'ENGINE_TIMEOUT' });
});

test('propagates unexpected engine failure', async () => {
  const runner = { async *execute() { throw new Error('engine crashed'); } };
  await expect(collectEngineEvents(runner, request)).rejects.toThrow('engine crashed');
});

test('rejects a trailing event after summary before completing', async () => {
  const runner = { async *execute() {
    const events = await collectEngineEvents(new FakeEngineRunner(), request);
    yield* events;
    yield events[0];
  } };
  await expect(collectEngineEvents(runner, request)).rejects.toMatchObject({ code: 'ENGINE_PROTOCOL_ERROR' });
});
test('episode may exceed timeout in total while every event arrives in time', async () => {
  const runner = { async *execute() {
    for await (const event of new FakeEngineRunner().execute(request)) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      yield event;
    }
  } };
  await expect(collectEngineEvents(runner, request, { timeoutMs: 80 })).resolves.toHaveLength(7);
});
test('rejects a stream that ends halfway through the next step', async () => {
  const runner = { async *execute() {
    let count = 0;
    for await (const event of new FakeEngineRunner().execute(request)) {
      yield event;
      if (++count === 4) return;
    }
  } };
  await expect(collectEngineEvents(runner, request)).rejects.toMatchObject({ code: 'ENGINE_SUMMARY_MISSING' });
});
