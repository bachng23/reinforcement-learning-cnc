const { FakeEngineRunner } = require('../src/engine/fake-engine');
const { validateEngineEvent } = require('../src/engine/contracts');

const environmentConfig = {
  schema_version: '2.0',
  environment_id: 'fixture-environment',
  number_of_machines: 4,
  spare_capacity: 1,
  initial_spares: 1,
  horizon_steps: 4,
  failure_threshold_um: 300,
  seed: 42,
  costs: {
    replacement_cost: 25,
    failure_cost: 500,
    waiting_cost_per_step: 7,
    unused_life_cost_per_step: 1,
  },
  risk: { objective: 'CVAR', cvar_alpha: 0.95 },
};

async function run(seed, config = environmentConfig) {
  const events = [];
  const runner = new FakeEngineRunner();
  for await (const event of runner.execute({
    episodeId: 'episode-1',
    attempt: 2,
    environmentConfig: config,
    policyId: 'fixture-policy',
    policyVersion: '1.0.0',
    seed,
  })) events.push(event);
  return events;
}

test('fake engine is deterministic and emits canonical CNC v2 payloads', async () => {
  const first = await run(42);
  const second = await run(42);
  expect(second).toEqual(first);
  first.forEach((event) => expect(() => validateEngineEvent(event)).not.toThrow());

  const observation = first[0].payload;
  expect(observation).toMatchObject({
    schema_version: '2.0',
    observation_id: 'observation:episode-1:attempt:2:step:0',
    episode_id: 'episode-1',
  });
  expect(observation.machines).toHaveLength(4);
  expect(observation).not.toHaveProperty('fixture');

  const serialized = JSON.stringify(first);
  expect(serialized).toContain('CONTINUE');
  expect(serialized).toContain('REPLACE');
  expect(serialized).toContain('REPLACED');
  expect(serialized).toContain('WAITING_FOR_SPARE');
  expect(first.at(-1)).toMatchObject({
    type: 'EpisodeSummary',
    payload: { steps_completed: 4, policy_id: 'fixture-policy', seed: 42 },
  });
});

test('uses canonical machine, horizon, and zero-spare configuration fields', async () => {
  const events = await run(9, {
    ...environmentConfig,
    number_of_machines: 1,
    spare_capacity: 0,
    initial_spares: 0,
    horizon_steps: 2,
  });
  expect(events.filter((event) => event.type === 'FleetObservation')).toHaveLength(2);
  expect(events[0].payload.machines).toHaveLength(1);
  expect(events[0].payload.inventory).toEqual({ spares_available: 0, capacity: 0 });
});

test('different seeds vary stochastic fixture fields', async () => {
  expect(await run(42)).not.toEqual(await run(43));
});
