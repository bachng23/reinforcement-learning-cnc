const jwt = require('jsonwebtoken');
const prisma = require('../../src/config/prisma');
const app = require('../../src/app');

let server;
let baseUrl;
let owner;
let otherOwner;
let policy;

const tokenFor = (user) => jwt.sign(
  { id: user.id },
  process.env.JWT_SECRET,
  { expiresIn: '1h' },
);

const request = async (path, {
  method = 'GET',
  user = owner,
  body,
  headers = {},
} = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, json: await response.json() };
};

const environmentConfig = (seed = 42) => ({
  schema_version: '2.0',
  environment_id: 'cnc-fleet-v0.1',
  number_of_machines: 2,
  spare_capacity: 2,
  initial_spares: 1,
  horizon_steps: 20,
  failure_threshold_um: 300,
  seed,
  costs: {
    replacement_cost: 100,
    failure_cost: 5000,
    waiting_cost_per_step: 20,
    unused_life_cost_per_step: 2,
  },
  risk: { objective: 'CVAR', cvar_alpha: 0.95 },
});

const createExperiment = async ({
  user = owner,
  episodeCount = 1,
  seed = 42,
  name = 'PostgreSQL integration experiment',
} = {}) => {
  const result = await request('/api/v1/experiments', {
    method: 'POST',
    user,
    body: {
      name,
      description: 'Created through Express and persisted by Prisma',
      policyKey: policy.policyKey,
      policyVersion: policy.version,
      episodeCount,
      environmentConfig: environmentConfig(seed),
    },
  });
  expect(result.response.status).toBe(201);
  return result.json.data;
};

const runExperiment = (experimentId, key, user = owner) => request(
  `/api/v1/experiments/${experimentId}/run`,
  {
    method: 'POST',
    user,
    headers: { 'Idempotency-Key': key },
  },
);

const makeObservationPayload = (episode) => ({
  schema_version: '2.0',
  observation_id: `${episode.episodeKey}:attempt:1:step:0`,
  episode_id: episode.episodeKey,
  step: 0,
  machines: [{
    machine_id: 'machine-01',
    tool_id: 'tool-01',
    job_id: 'job-01',
    cutting_condition: { condition_id: 'nominal', load_class: 'NOMINAL' },
    tool_state: {
      tool_age_steps: 0,
      observed_wear_um: 0,
      posterior_median_wear_um: 0,
      posterior_std_wear_um: 1,
      rul_distribution: {
        support_steps: [0, 1],
        probability_mass: [0.1, 0.2],
        survival_beyond_horizon: 0.7,
        model_version: 'integration-model-v1',
      },
    },
  }],
  inventory: { spares_available: 1, capacity: 2 },
});

const persistAttemptOne = async (episode, { withSummary = true } = {}) => {
  const observationPayload = makeObservationPayload(episode);
  const observation = await prisma.fleetObservation.create({
    data: {
      observationKey: observationPayload.observation_id,
      episodeId: episode.id,
      attempt: 1,
      step: 0,
      payloadJson: observationPayload,
    },
  });

  const recommendationPayload = {
    schema_version: '2.0',
    observation_id: observationPayload.observation_id,
    policy_id: policy.policyKey,
    policy_version: policy.version,
    actions: {
      schema_version: '2.0',
      observation_id: observationPayload.observation_id,
      actions: [{ machine_id: 'machine-01', action: 'CONTINUE' }],
    },
    estimated_expected_cost: 0,
    estimated_cvar_cost: 0,
  };
  const recommendation = await prisma.policyRecommendation.create({
    data: {
      observationId: observation.id,
      policyId: policy.id,
      payloadJson: recommendationPayload,
    },
  });

  const resultPayload = {
    schema_version: '2.0',
    observation_id: observationPayload.observation_id,
    episode_id: episode.episodeKey,
    step: 0,
    outcomes: [{
      machine_id: 'machine-01',
      requested_action: 'CONTINUE',
      outcome: 'CONTINUED',
      tool_id_before: 'tool-01',
      tool_id_after: 'tool-01',
      incurred_cost: 0,
    }],
    inventory_after: { spares_available: 1, capacity: 2 },
    total_cost: 0,
    episode_terminated: false,
  };
  const result = await prisma.stepResult.create({
    data: {
      observationId: observation.id,
      payloadJson: resultPayload,
      totalCost: 0,
      episodeTerminated: false,
    },
  });

  const summaryPayload = {
    schema_version: '2.0',
    episode_id: episode.episodeKey,
    policy_id: policy.policyKey,
    seed: episode.seed,
    steps_completed: 1,
    total_cost: 0,
    failure_count: 0,
    replacement_count: 0,
    waiting_steps: 0,
  };
  const summary = withSummary
    ? await prisma.episodeSummary.create({
      data: { episodeId: episode.id, attempt: 1, payloadJson: summaryPayload },
    })
    : null;

  return {
    observation,
    observationPayload,
    recommendation,
    recommendationPayload,
    result,
    resultPayload,
    summary,
    summaryPayload,
  };
};

beforeAll(async () => {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.includes('schema=product_api_it_')) {
    throw new Error('Run this suite only through `npm run test:integration`');
  }

  const databaseIdentity = await prisma.$queryRaw`
    SELECT current_schema() AS schema, current_database() AS database
  `;
  expect(databaseIdentity[0].schema).toMatch(/^product_api_it_/);
  expect(jest.isMockFunction(prisma.user.create)).toBe(false);

  [owner, otherOwner] = await Promise.all([
    prisma.user.create({
      data: {
        username: 'integration-owner',
        passwordHash: 'not-used-by-bearer-token-tests',
        role: 'ENGINEER',
      },
    }),
    prisma.user.create({
      data: {
        username: 'integration-other-owner',
        passwordHash: 'not-used-by-bearer-token-tests',
        role: 'ENGINEER',
      },
    }),
  ]);
  policy = await prisma.policy.create({
    data: {
      policyKey: 'integration-policy',
      version: '1.0.0',
      name: 'Integration policy',
      description: 'Policy fixture stored in PostgreSQL',
      configJson: { strategy: 'INTEGRATION_TEST' },
      active: true,
      createdById: owner.id,
    },
  });

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await prisma.$disconnect();
});

test('runs create -> run -> episodes -> events -> summary against PostgreSQL', async () => {
  const experiment = await createExperiment({ episodeCount: 2, seed: 100 });
  const storedExperiment = await prisma.experiment.findUnique({ where: { id: experiment.id } });
  expect(storedExperiment).toMatchObject({
    createdById: owner.id,
    status: 'READY',
    episodeCount: 2,
    environmentConfig: environmentConfig(100),
  });

  const firstRun = await runExperiment(experiment.id, 'full-flow-run-key');
  expect(firstRun.response.status).toBe(202);
  expect(firstRun.response.headers.get('idempotency-replayed')).toBeNull();
  expect(firstRun.json.data).toMatchObject({
    experimentId: experiment.id,
    status: 'RUNNING',
    episodeCount: 2,
  });
  expect(firstRun.json.data.episodes.map(({ seed, status }) => ({ seed, status }))).toEqual([
    { seed: 100, status: 'PENDING' },
    { seed: 101, status: 'PENDING' },
  ]);

  const replay = await runExperiment(experiment.id, 'full-flow-run-key');
  expect(replay.response.status).toBe(202);
  expect(replay.response.headers.get('idempotency-replayed')).toBe('true');
  expect(replay.json.data.episodes).toEqual(firstRun.json.data.episodes);
  expect(await prisma.episode.count({ where: { experimentId: experiment.id } })).toBe(2);

  const conflictingRun = await runExperiment(experiment.id, 'different-run-key');
  expect(conflictingRun.response.status).toBe(409);
  expect(conflictingRun.json.error.code).toBe('EXPERIMENT_ALREADY_RUN');

  const episodeList = await request(`/api/v1/experiments/${experiment.id}/episodes`);
  expect(episodeList.response.status).toBe(200);
  expect(episodeList.json.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
  expect(episodeList.json.data.map((episode) => episode.episodeIndex)).toEqual([0, 1]);

  const episode = episodeList.json.data[0];
  await prisma.episode.update({
    where: { id: episode.id },
    data: { status: 'RUNNING', startedAt: new Date() },
  });
  const events = await persistAttemptOne(episode);
  await prisma.episode.update({
    where: { id: episode.id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      stepsCompleted: 1,
      totalCost: 0,
      failureCount: 0,
      replacementCount: 0,
      waitingSteps: 0,
    },
  });

  const [observations, recommendations, results, summary] = await Promise.all([
    request(`/api/v1/episodes/${episode.id}/observations`),
    request(`/api/v1/episodes/${episode.id}/recommendations`),
    request(`/api/v1/episodes/${episode.id}/results`),
    request(`/api/v1/episodes/${episode.id}/summary`),
  ]);

  expect(observations.response.status).toBe(200);
  expect(observations.json.data).toEqual([expect.objectContaining({
    id: events.observation.id,
    observationKey: events.observation.observationKey,
    attempt: 1,
    step: 0,
    schemaVersion: '2.0',
    payload: events.observationPayload,
  })]);
  expect(observations.json.meta.attempt).toBe(1);

  expect(recommendations.response.status).toBe(200);
  expect(recommendations.json.data).toEqual([expect.objectContaining({
    id: events.recommendation.id,
    observationId: events.observation.id,
    policyId: policy.id,
    attempt: 1,
    step: 0,
    payload: events.recommendationPayload,
  })]);

  expect(results.response.status).toBe(200);
  expect(results.json.data).toEqual([expect.objectContaining({
    id: events.result.id,
    observationId: events.observation.id,
    attempt: 1,
    step: 0,
    totalCost: 0,
    episodeTerminated: false,
    payload: events.resultPayload,
  })]);

  expect(summary.response.status).toBe(200);
  expect(summary.json.data).toEqual(expect.objectContaining({
    id: events.summary.id,
    attempt: 1,
    payload: events.summaryPayload,
  }));
});

test('hides experiments and episodes from a different non-admin owner', async () => {
  const experiment = await createExperiment({ name: 'Owner isolation experiment' });
  const run = await runExperiment(experiment.id, 'ownership-run-key');
  const episodeId = run.json.data.episodes[0].id;

  const ownerRead = await request(`/api/v1/experiments/${experiment.id}`);
  expect(ownerRead.response.status).toBe(200);

  const attempts = await Promise.all([
    request(`/api/v1/experiments/${experiment.id}`, { user: otherOwner }),
    request(`/api/v1/experiments/${experiment.id}/episodes`, { user: otherOwner }),
    runExperiment(experiment.id, 'ownership-other-key', otherOwner),
    request(`/api/v1/episodes/${episodeId}`, { user: otherOwner }),
    request(`/api/v1/episodes/${episodeId}/observations`, { user: otherOwner }),
    request(`/api/v1/episodes/${episodeId}/retry`, { method: 'POST', user: otherOwner }),
    request(`/api/v1/episodes/${episodeId}/cancel`, { method: 'POST', user: otherOwner }),
  ]);

  for (const attempt of attempts) {
    expect(attempt.response.status).toBe(404);
  }
  expect(await prisma.episode.findUnique({ where: { id: episodeId } })).toMatchObject({
    status: 'PENDING',
    attempt: 1,
  });
});

test('retry starts attempt two without deleting attempt-one events or summary', async () => {
  const experiment = await createExperiment({ name: 'Retry history experiment', seed: 200 });
  const run = await runExperiment(experiment.id, 'retry-history-run-key');
  const episode = run.json.data.episodes[0];

  await prisma.episode.update({
    where: { id: episode.id },
    data: { status: 'RUNNING', startedAt: new Date(), stepsCompleted: 1 },
  });
  const priorAttempt = await persistAttemptOne(episode);
  await prisma.episode.update({
    where: { id: episode.id },
    data: {
      status: 'FAILED',
      failedAt: new Date(),
      errorCode: 'INTEGRATION_FAILURE',
      errorMessage: 'Safe integration failure',
    },
  });

  const retry = await request(`/api/v1/episodes/${episode.id}/retry`, { method: 'POST' });
  expect(retry.response.status).toBe(202);
  expect(retry.json.data).toMatchObject({
    id: episode.id,
    status: 'PENDING',
    attempt: 2,
    stepsCompleted: 0,
    error: null,
  });

  const [oldObservations, oldResults, oldSummary, currentObservations] = await Promise.all([
    request(`/api/v1/episodes/${episode.id}/observations?attempt=1`),
    request(`/api/v1/episodes/${episode.id}/results?attempt=1`),
    request(`/api/v1/episodes/${episode.id}/summary?attempt=1`),
    request(`/api/v1/episodes/${episode.id}/observations`),
  ]);
  expect(oldObservations.json.data[0].payload).toEqual(priorAttempt.observationPayload);
  expect(oldResults.json.data[0].payload).toEqual(priorAttempt.resultPayload);
  expect(oldSummary.json.data.payload).toEqual(priorAttempt.summaryPayload);
  expect(currentObservations.json.meta.attempt).toBe(2);
  expect(currentObservations.json.data).toEqual([]);

  await expect(prisma.fleetObservation.count({
    where: { episodeId: episode.id, attempt: 1 },
  })).resolves.toBe(1);
  await expect(prisma.episodeSummary.count({
    where: { episodeId: episode.id, attempt: 1 },
  })).resolves.toBe(1);
});

test('cancel accepts PENDING only and leaves a RUNNING episode unchanged', async () => {
  const pendingExperiment = await createExperiment({ name: 'Pending cancellation experiment' });
  const pendingRun = await runExperiment(pendingExperiment.id, 'pending-cancel-run-key');
  const pendingEpisode = pendingRun.json.data.episodes[0];

  const cancelled = await request(`/api/v1/episodes/${pendingEpisode.id}/cancel`, {
    method: 'POST',
  });
  expect(cancelled.response.status).toBe(200);
  expect(cancelled.json.data).toMatchObject({ status: 'CANCELLED', attempt: 1 });
  expect(cancelled.json.data.cancelledAt).not.toBeNull();

  const cancelledAgain = await request(`/api/v1/episodes/${pendingEpisode.id}/cancel`, {
    method: 'POST',
  });
  expect(cancelledAgain.response.status).toBe(409);
  expect(cancelledAgain.json.error.code).toBe('INVALID_EPISODE_TRANSITION');

  const runningExperiment = await createExperiment({ name: 'Running cancellation experiment' });
  const runningRun = await runExperiment(runningExperiment.id, 'running-cancel-run-key');
  const runningEpisode = runningRun.json.data.episodes[0];
  await prisma.episode.update({
    where: { id: runningEpisode.id },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  const rejected = await request(`/api/v1/episodes/${runningEpisode.id}/cancel`, {
    method: 'POST',
  });
  expect(rejected.response.status).toBe(409);
  expect(rejected.json.error).toMatchObject({
    code: 'INVALID_EPISODE_TRANSITION',
    message: 'Episode is RUNNING; expected PENDING',
  });
  await expect(prisma.episode.findUnique({ where: { id: runningEpisode.id } }))
    .resolves.toMatchObject({ status: 'RUNNING', cancelledAt: null });
});
