const { collectEngineEvents, validateSequence } = require('../src/worker/event-collector');
const { FakeEngineRunner } = require('../src/engine/fake-engine');

const request = {
  episodeId: 'episode-1',
  attempt: 1,
  environmentConfig: {
    schema_version: '2.0',
    environment_id: 'fixture-environment',
    number_of_machines: 2,
    spare_capacity: 1,
    initial_spares: 1,
    horizon_steps: 2,
    failure_threshold_um: 300,
    seed: 7,
    costs: {
      replacement_cost: 25,
      failure_cost: 500,
      waiting_cost_per_step: 7,
      unused_life_cost_per_step: 1,
    },
    risk: { objective: 'EXPECTED_COST', cvar_alpha: 0.95 },
  },
  policyId: 'fixture-policy',
  policyVersion: '1.0.0',
  seed: 7,
};

test('collects a complete, correctly ordered engine stream', async () => {
  const events = await collectEngineEvents(new FakeEngineRunner(), request, { timeoutMs: 1000 });
  expect(events.map((event) => event.type)).toEqual([
    'FleetObservation', 'PolicyRecommendation', 'StepResult',
    'FleetObservation', 'PolicyRecommendation', 'StepResult', 'EpisodeSummary',
  ]);
});

test('rejects malformed engine events without repairing them', async () => {
  const runner = { async *execute() { yield { type: 'FleetObservation', payload: { broken: true } }; } };
  await expect(collectEngineEvents(runner, request)).rejects.toMatchObject({ code: 'ENGINE_EVENT_INVALID' });
});

test('rejects streams missing a final summary', async () => {
  const runner = { async *execute() {} };
  await expect(collectEngineEvents(runner, request)).rejects.toMatchObject({ code: 'ENGINE_SUMMARY_MISSING' });
});

test('rejects duplicate or incomplete step delivery', () => {
  expect(() => validateSequence([
    { type: 'FleetObservation', payload: { episode_id: 'episode-1', observation_id: 'obs-1', step: 0 } },
    { type: 'FleetObservation', payload: { episode_id: 'episode-1', observation_id: 'obs-1', step: 0 } },
    { type: 'EpisodeSummary', payload: { episode_id: 'episode-1', steps_completed: 1 } },
  ], 'episode-1')).toThrow(/ordered observation/);
});

test('rejects mismatched observation references', async () => {
  const events = await collectEngineEvents(new FakeEngineRunner(), request);
  events[1].payload.observation_id = 'different-observation';
  expect(() => validateSequence(events, request.episodeId)).toThrow(/same observation/);
});

test('times out a stalled engine and closes its iterator', async () => {
  const close = jest.fn().mockResolvedValue({ done: true });
  const runner = {
    execute() {
      return { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: close }; } };
    },
  };
  await expect(collectEngineEvents(runner, request, { timeoutMs: 10 })).rejects.toMatchObject({ code: 'ENGINE_TIMEOUT' });
  expect(close).toHaveBeenCalledTimes(1);
});

test('propagates unexpected engine failure', async () => {
  const runner = { async *execute() { throw new Error('engine crashed'); } };
  await expect(collectEngineEvents(runner, request)).rejects.toThrow('engine crashed');
});

test('episode may exceed timeout in total while each event arrives in time', async () => {
  const runner = { async *execute() {
    for await (const event of new FakeEngineRunner().execute(request)) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      yield event;
    }
  } };
  await expect(collectEngineEvents(runner, request, { timeoutMs: 80 })).resolves.toHaveLength(7);
});
test('rejects trailing events after summary', async () => {
  const runner = { async *execute() {
    const events = await collectEngineEvents(new FakeEngineRunner(), request);
    yield* events;
    yield events[0];
  } };
  await expect(collectEngineEvents(runner, request)).rejects.toMatchObject({ code: 'ENGINE_PROTOCOL_ERROR' });
});
test('rejects summary from another policy or seed', async () => {
  const runner = { async *execute() {
    for await (const event of new FakeEngineRunner().execute(request)) {
      if (event.type === 'EpisodeSummary') event.payload.seed += 1;
      yield event;
    }
  } };
  await expect(collectEngineEvents(runner, request)).rejects.toMatchObject({ code: 'ENGINE_PROTOCOL_ERROR' });
});
