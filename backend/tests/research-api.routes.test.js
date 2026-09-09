process.env.JWT_SECRET = 'test-secret-at-least-32-characters';
process.env.NODE_ENV = 'test';

jest.mock('../src/config/prisma', () => require('./helpers/in-memory-prisma'));

const jwt = require('jsonwebtoken');
const prisma = require('../src/config/prisma');
const app = require('../src/app');

let server;
let baseUrl;

const tokenFor = (userId) => jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

const request = async (path, {
  method = 'GET',
  userId,
  body,
  headers = {},
} = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(userId ? { Authorization: `Bearer ${tokenFor(userId)}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, json: await response.json() };
};

const validEnvironmentConfig = (overrides = {}) => ({
  schema_version: '2.0',
  environment_id: 'cnc-fleet-v0.1',
  number_of_machines: 4,
  spare_capacity: 3,
  initial_spares: 2,
  horizon_steps: 480,
  failure_threshold_um: 300,
  seed: 42,
  costs: {
    replacement_cost: 100,
    failure_cost: 5000,
    waiting_cost_per_step: 20,
    unused_life_cost_per_step: 2,
  },
  risk: { objective: 'CVAR', cvar_alpha: 0.95 },
  ...overrides,
});

const validExperimentBody = (overrides = {}) => ({
  name: 'CNC policy comparison',
  description: 'A deterministic API test experiment',
  policyKey: 'fixed-schedule',
  policyVersion: '1.0.0',
  episodeCount: 3,
  environmentConfig: validEnvironmentConfig(),
  ...overrides,
});

const createExperiment = async (userId = prisma.__ids.owner, overrides = {}) => {
  const result = await request('/api/v1/experiments', {
    method: 'POST',
    userId,
    body: validExperimentBody(overrides),
  });
  expect(result.response.status).toBe(201);
  return result.json.data;
};

const runExperiment = (experimentId, userId = prisma.__ids.owner, key = 'run-request-1') => (
  request(`/api/v1/experiments/${experimentId}/run`, {
    method: 'POST',
    userId,
    headers: { 'Idempotency-Key': key },
  })
);

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.__reset();
});

describe('research API authentication and policy catalog', () => {
  test('requires authentication and enforces read-only viewer role', async () => {
    const unauthenticated = await request('/api/v1/policies');
    expect(unauthenticated.response.status).toBe(401);
    expect(unauthenticated.json.error.code).toBe('UNAUTHORIZED');

    const viewerCreate = await request('/api/v1/experiments', {
      method: 'POST',
      userId: prisma.__ids.viewer,
      body: validExperimentBody(),
    });
    expect(viewerCreate.response.status).toBe(403);
    expect(viewerCreate.json.error.code).toBe('FORBIDDEN');
  });

  test('lists active policies in a deterministic public shape', async () => {
    const { response, json } = await request('/api/v1/policies', {
      userId: prisma.__ids.owner,
    });

    expect(response.status).toBe(200);
    expect(json.meta).toEqual({ total: 1 });
    expect(json.data[0]).toMatchObject({
      policyKey: 'fixed-schedule',
      version: '1.0.0',
      config: { strategy: 'FIXED_SCHEDULE' },
    });
    expect(json.data[0].configJson).toBeUndefined();
  });

  test('does not expose internal database errors in public responses', async () => {
    prisma.policy.findMany.mockRejectedValueOnce(
      new Error('secret connection string and internal SQL details'),
    );

    const { response, json } = await request('/api/v1/policies', {
      userId: prisma.__ids.owner,
    });

    expect(response.status).toBe(500);
    expect(json.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(json)).not.toContain('secret connection string');
  });
});

describe('experiment creation, validation, ownership, and pagination', () => {
  test('creates a READY experiment with exact CNC configuration and audit entry', async () => {
    const input = validExperimentBody();
    const { response, json } = await request('/api/v1/experiments', {
      method: 'POST',
      userId: prisma.__ids.owner,
      body: input,
    });

    expect(response.status).toBe(201);
    expect(json.data).toMatchObject({
      name: input.name,
      status: 'READY',
      episodeCount: 3,
      createdById: prisma.__ids.owner,
      environmentConfig: input.environmentConfig,
      policy: { policyKey: 'fixed-schedule', version: '1.0.0' },
    });
    expect(prisma.__state.episodes).toHaveLength(0);
    expect(prisma.__state.auditLogs).toEqual([
      expect.objectContaining({ action: 'EXPERIMENT_CREATE', actorUserId: prisma.__ids.owner }),
    ]);
  });

  test.each([
    ['missing policy', { policyKey: undefined }, 'VALIDATION_ERROR'],
    ['invalid inventory', {
      environmentConfig: validEnvironmentConfig({ spare_capacity: 1, initial_spares: 2 }),
    }, 'VALIDATION_ERROR'],
    ['invalid policy version', { policyVersion: '9.9.9' }, 'POLICY_VERSION_NOT_FOUND'],
    ['unknown policy', { policyKey: 'does-not-exist' }, 'POLICY_NOT_FOUND'],
  ])('rejects %s consistently', async (_label, override, expectedCode) => {
    const body = validExperimentBody(override);
    if (Object.hasOwn(override, 'policyKey') && override.policyKey === undefined) {
      delete body.policyKey;
    }
    const { response, json } = await request('/api/v1/experiments', {
      method: 'POST',
      userId: prisma.__ids.owner,
      body,
    });

    expect([400, 404]).toContain(response.status);
    expect(json).toMatchObject({ success: false, error: { code: expectedCode } });
    expect(prisma.__state.experiments).toHaveLength(0);
  });

  test('paginates deterministically, scopes owners, and lets ADMIN inspect all', async () => {
    const owned = await createExperiment(prisma.__ids.owner, { name: 'Owned experiment' });
    await createExperiment(prisma.__ids.other, { name: 'Other experiment' });

    const ownerList = await request('/api/v1/experiments?page=1&limit=1', {
      userId: prisma.__ids.owner,
    });
    expect(ownerList.response.status).toBe(200);
    expect(ownerList.json.meta).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
    expect(ownerList.json.data[0].id).toBe(owned.id);

    const adminList = await request('/api/v1/experiments?page=1&limit=20', {
      userId: prisma.__ids.admin,
    });
    expect(adminList.json.meta.total).toBe(2);

    const forbiddenDetail = await request(
      `/api/v1/experiments/${owned.id}`,
      { userId: prisma.__ids.other },
    );
    expect(forbiddenDetail.response.status).toBe(404);
    expect(forbiddenDetail.json.error.code).toBe('EXPERIMENT_NOT_FOUND');

    const adminDetail = await request(
      `/api/v1/experiments/${owned.id}`,
      { userId: prisma.__ids.admin },
    );
    expect(adminDetail.response.status).toBe(200);
    expect(adminDetail.json.data.episodesCreated).toBe(0);
  });

  test('rejects malformed pagination and resource identifiers', async () => {
    const badPage = await request('/api/v1/experiments?page=0', { userId: prisma.__ids.owner });
    expect(badPage.response.status).toBe(400);
    expect(badPage.json.error.code).toBe('VALIDATION_ERROR');

    const badId = await request('/api/v1/experiments/not-a-uuid', { userId: prisma.__ids.owner });
    expect(badId.response.status).toBe(400);
    expect(badId.json.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('queued experiment execution and idempotency', () => {
  test('creates deterministic PENDING episodes transactionally and returns immediately', async () => {
    const experiment = await createExperiment();
    const { response, json } = await runExperiment(experiment.id);

    expect(response.status).toBe(202);
    expect(json.data).toMatchObject({
      experimentId: experiment.id,
      status: 'RUNNING',
      episodeCount: 3,
    });
    expect(json.data.episodes.map((episode) => episode.seed)).toEqual([42, 43, 44]);
    expect(json.data.episodes.every((episode) => episode.status === 'PENDING')).toBe(true);
    expect(prisma.__state.auditLogs.map((log) => log.action)).toEqual([
      'EXPERIMENT_CREATE',
      'EXPERIMENT_RUN',
    ]);
  });

  test('replays the same run key without duplicates and rejects a different key', async () => {
    const experiment = await createExperiment();
    const first = await runExperiment(experiment.id, prisma.__ids.owner, 'stable-key');
    const replay = await runExperiment(experiment.id, prisma.__ids.owner, 'stable-key');

    expect(first.response.status).toBe(202);
    expect(replay.response.status).toBe(202);
    expect(replay.response.headers.get('idempotency-replayed')).toBe('true');
    expect(replay.json.data.episodes.map((episode) => episode.id)).toEqual(
      first.json.data.episodes.map((episode) => episode.id),
    );
    expect(prisma.__state.episodes).toHaveLength(3);

    const conflict = await runExperiment(experiment.id, prisma.__ids.owner, 'another-key');
    expect(conflict.response.status).toBe(409);
    expect(conflict.json.error.code).toBe('EXPERIMENT_ALREADY_RUN');
    expect(prisma.__state.episodes).toHaveLength(3);
  });

  test('requires an idempotency key and supports an empty episode list before run', async () => {
    const experiment = await createExperiment();
    const empty = await request(`/api/v1/experiments/${experiment.id}/episodes`, {
      userId: prisma.__ids.owner,
    });
    expect(empty.response.status).toBe(200);
    expect(empty.json.data).toEqual([]);
    expect(empty.json.meta.total).toBe(0);

    const missingKey = await request(`/api/v1/experiments/${experiment.id}/run`, {
      method: 'POST',
      userId: prisma.__ids.owner,
    });
    expect(missingKey.response.status).toBe(400);
    expect(missingKey.json.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  test('paginates an experiment episode list', async () => {
    const experiment = await createExperiment();
    await runExperiment(experiment.id);
    const pageTwo = await request(
      `/api/v1/experiments/${experiment.id}/episodes?page=2&limit=2&status=PENDING`,
      { userId: prisma.__ids.owner },
    );

    expect(pageTwo.response.status).toBe(200);
    expect(pageTwo.json.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(pageTwo.json.data).toHaveLength(1);
    expect(pageTwo.json.data[0].episodeIndex).toBe(2);
  });
});

describe('episode status, persisted events, summary, retry, and cancellation', () => {
  const prepareEpisode = async () => {
    const experiment = await createExperiment(prisma.__ids.owner, { episodeCount: 1 });
    const run = await runExperiment(experiment.id);
    return run.json.data.episodes[0];
  };

  test('retrieves episode detail and persisted domain events without calculating them', async () => {
    const episode = await prepareEpisode();
    const observationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const now = new Date('2026-09-02T01:00:00.000Z');
    prisma.__state.observations.push({
      id: observationId,
      observationKey: 'observation:attempt:1:step:0',
      episodeId: episode.id,
      attempt: 1,
      step: 0,
      schemaVersion: '2.0',
      payloadJson: { schema_version: '2.0', observation_id: 'obs:1', step: 0 },
      createdAt: now,
    });
    prisma.__state.recommendations.push({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      observationId,
      policyId: prisma.__ids.policy,
      schemaVersion: '2.0',
      payloadJson: { schema_version: '2.0', observation_id: 'obs:1', policy_id: 'fixed-schedule' },
      createdAt: now,
    });
    prisma.__state.results.push({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      observationId,
      schemaVersion: '2.0',
      totalCost: 100,
      episodeTerminated: false,
      payloadJson: { schema_version: '2.0', observation_id: 'obs:1', total_cost: 100 },
      createdAt: now,
    });

    const detail = await request(`/api/v1/episodes/${episode.id}`, {
      userId: prisma.__ids.owner,
    });
    const observations = await request(`/api/v1/episodes/${episode.id}/observations`, {
      userId: prisma.__ids.owner,
    });
    const recommendations = await request(`/api/v1/episodes/${episode.id}/recommendations`, {
      userId: prisma.__ids.owner,
    });
    const results = await request(`/api/v1/episodes/${episode.id}/results`, {
      userId: prisma.__ids.owner,
    });

    expect(detail.response.status).toBe(200);
    expect(detail.json.data).toMatchObject({ id: episode.id, status: 'PENDING', attempt: 1 });
    expect(observations.json.data[0].payload).toEqual(
      prisma.__state.observations[0].payloadJson,
    );
    expect(recommendations.json.data[0]).toMatchObject({
      step: 0,
      policyId: prisma.__ids.policy,
      schemaVersion: '2.0',
    });
    expect(results.json.data[0].payload.total_cost).toBe(100);
  });

  test('returns empty event sets and only a worker-persisted summary', async () => {
    const episode = await prepareEpisode();
    const empty = await request(`/api/v1/episodes/${episode.id}/results`, {
      userId: prisma.__ids.owner,
    });
    expect(empty.response.status).toBe(200);
    expect(empty.json.data).toEqual([]);

    const unavailable = await request(`/api/v1/episodes/${episode.id}/summary`, {
      userId: prisma.__ids.owner,
    });
    expect(unavailable.response.status).toBe(409);
    expect(unavailable.json.error.code).toBe('SUMMARY_NOT_AVAILABLE');

    const payload = {
      schema_version: '2.0',
      episode_id: episode.episodeKey,
      policy_id: 'fixed-schedule',
      seed: 42,
      steps_completed: 480,
      total_cost: 900,
      failure_count: 0,
      replacement_count: 3,
      waiting_steps: 0,
    };
    prisma.__state.summaries.push({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      episodeId: episode.id,
      attempt: 1,
      payloadJson: payload,
      createdAt: new Date(),
    });
    const persisted = await request(`/api/v1/episodes/${episode.id}/summary`, {
      userId: prisma.__ids.owner,
    });
    expect(persisted.response.status).toBe(200);
    expect(persisted.json.data.payload).toEqual(payload);
  });

  test('retries FAILED -> PENDING as a new attempt and preserves prior events', async () => {
    const episode = await prepareEpisode();
    const stored = prisma.__state.episodes.find((item) => item.id === episode.id);
    Object.assign(stored, {
      status: 'FAILED',
      failedAt: new Date(),
      errorCode: 'SAFE_ENGINE_ERROR',
      errorMessage: 'Safe failure message',
      stepsCompleted: 7,
    });
    prisma.__state.observations.push({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      episodeId: episode.id,
      attempt: 1,
      step: 6,
      payloadJson: { schema_version: '2.0' },
      createdAt: new Date(),
    });

    const retry = await request(`/api/v1/episodes/${episode.id}/retry`, {
      method: 'POST',
      userId: prisma.__ids.owner,
    });
    expect(retry.response.status).toBe(202);
    expect(retry.json.data).toMatchObject({ status: 'PENDING', attempt: 2, stepsCompleted: 0 });
    expect(retry.json.data.error).toBeNull();
    expect(prisma.__state.observations).toHaveLength(1);
    expect(prisma.__state.auditLogs.at(-1).action).toBe('EPISODE_RETRY');

    const invalidRetry = await request(`/api/v1/episodes/${episode.id}/retry`, {
      method: 'POST',
      userId: prisma.__ids.owner,
    });
    expect(invalidRetry.response.status).toBe(409);
    expect(invalidRetry.json.error.code).toBe('INVALID_EPISODE_TRANSITION');
  });

  test('cancels PENDING atomically and rejects RUNNING cancellation this week', async () => {
    const pending = await prepareEpisode();
    const cancelled = await request(`/api/v1/episodes/${pending.id}/cancel`, {
      method: 'POST',
      userId: prisma.__ids.owner,
    });
    expect(cancelled.response.status).toBe(200);
    expect(cancelled.json.data.status).toBe('CANCELLED');
    expect(cancelled.json.data.cancelledAt).not.toBeNull();
    expect(prisma.__state.auditLogs.at(-1).action).toBe('EPISODE_CANCEL');

    prisma.__reset();
    const running = await prepareEpisode();
    prisma.__state.episodes.find((item) => item.id === running.id).status = 'RUNNING';
    const rejected = await request(`/api/v1/episodes/${running.id}/cancel`, {
      method: 'POST',
      userId: prisma.__ids.owner,
    });
    expect(rejected.response.status).toBe(409);
    expect(rejected.json.error.code).toBe('INVALID_EPISODE_TRANSITION');
  });

  test('prevents another owner from reading or mutating an episode', async () => {
    const episode = await prepareEpisode();
    const read = await request(`/api/v1/episodes/${episode.id}`, {
      userId: prisma.__ids.other,
    });
    const cancel = await request(`/api/v1/episodes/${episode.id}/cancel`, {
      method: 'POST',
      userId: prisma.__ids.other,
    });
    expect(read.response.status).toBe(404);
    expect(cancel.response.status).toBe(404);
  });
});
