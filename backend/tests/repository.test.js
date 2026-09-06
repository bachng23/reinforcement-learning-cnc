const { EpisodeRepository } = require('../src/worker/repository');

test('atomic claim only returns an episode after conditional PENDING update wins', async () => {
  const prisma = {
    episode: {
      findMany: jest.fn().mockResolvedValue([{ id: 'episode-1' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
    },
  };
  await expect(new EpisodeRepository(prisma).claimNext()).resolves.toBeNull();
  expect(prisma.episode.findUnique).not.toHaveBeenCalled();
  expect(prisma.episode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'episode-1', status: 'PENDING' },
  }));
});

test('event persistence is attempt-aware, immutable, and completes last', async () => {
  const calls = [];
  const tx = {
    fleetObservation: {
      upsert: jest.fn(async (args) => {
        calls.push('observation');
        return { id: 'observation-1', ...args };
      }),
    },
    policyRecommendation: { upsert: jest.fn(async () => { calls.push('recommendation'); }) },
    stepResult: { upsert: jest.fn(async () => { calls.push('result'); }) },
    episodeSummary: { upsert: jest.fn(async () => { calls.push('summary'); }) },
    episode: { updateMany: jest.fn(async () => { calls.push('completed'); return { count: 1 }; }) },
  };
  const prisma = { $transaction: (callback) => callback(tx) };
  const repo = new EpisodeRepository(prisma);
  const episode = { id: 'episode-1', attempt: 2, policyId: 'policy-db-id' };
  const events = [
    {
      type: 'FleetObservation',
      payload: {
        schema_version: '2.0', observation_id: 'obs-attempt-2-step-0', episode_id: 'episode-1', step: 0,
      },
    },
    {
      type: 'PolicyRecommendation',
      payload: { schema_version: '2.0', observation_id: 'obs-attempt-2-step-0' },
    },
    {
      type: 'StepResult',
      payload: {
        schema_version: '2.0', observation_id: 'obs-attempt-2-step-0', total_cost: 1,
        episode_terminated: true,
      },
    },
    {
      type: 'EpisodeSummary',
      payload: {
        schema_version: '2.0', steps_completed: 1, total_cost: 1, failure_count: 0,
        replacement_count: 0, waiting_steps: 0,
      },
    },
  ];

  await repo.persistCompleted(episode, events);
  await repo.persistCompleted(episode, events);

  expect(tx.fleetObservation.upsert).toHaveBeenCalledTimes(2);
  expect(tx.fleetObservation.upsert.mock.calls[0][0]).toMatchObject({
    where: { episodeId_attempt_step: { episodeId: 'episode-1', attempt: 2, step: 0 } },
    create: { observationKey: 'obs-attempt-2-step-0', attempt: 2 },
    update: {},
  });
  expect(tx.episodeSummary.upsert.mock.calls[0][0]).toMatchObject({
    where: { episodeId_attempt: { episodeId: 'episode-1', attempt: 2 } },
    update: {},
  });
  expect(calls.slice(0, 5)).toEqual(['observation', 'recommendation', 'result', 'summary', 'completed']);
});

test('stale recovery marks interrupted work failed without deleting research events', async () => {
  const prisma = {
    episode: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    fleetObservation: { deleteMany: jest.fn() },
  };
  const staleBefore = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date('2026-01-01T01:00:00.000Z');
  await expect(new EpisodeRepository(prisma).recoverStale(staleBefore, now)).resolves.toEqual({ count: 2 });
  expect(prisma.episode.updateMany).toHaveBeenCalledWith({
    where: { status: 'RUNNING', updatedAt: { lt: staleBefore } },
    data: expect.objectContaining({ status: 'FAILED', failedAt: now, errorCode: 'WORKER_STALE' }),
  });
  expect(prisma.fleetObservation.deleteMany).not.toHaveBeenCalled();
});

test('failure status is conditional on the worker still owning the attempt', async () => {
  const tx = {
    episode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: (callback) => callback(tx) };
  const error = Object.assign(new Error('engine stopped'), { code: 'ENGINE_TIMEOUT' });
  await new EpisodeRepository(prisma).markFailed({ id: 'episode-1', attempt: 2 }, error);
  expect(tx.episode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'episode-1', status: 'RUNNING', attempt: 2 },
  }));
  expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
});
