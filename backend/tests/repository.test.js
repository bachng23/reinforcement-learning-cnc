const { EpisodeRepository } = require('../src/worker/repository');

test('atomic claim only returns an episode after conditional PENDING update wins', async () => {
  const tx = {
    episode: {
      findFirst: jest.fn().mockResolvedValue({ id: 'episode-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn(),
    },
  };
  const prisma = { $transaction: (callback) => callback(tx) };
  await expect(new EpisodeRepository(prisma).claimNext()).resolves.toBeNull();
  expect(tx.episode.findUnique).not.toHaveBeenCalled();
  expect(tx.episode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'episode-1', status: 'PENDING' },
  }));
});

test('event persistence uses idempotent unique-key upserts and completes last', async () => {
  const calls = [];
  const tx = {
    fleetObservation: { upsert: jest.fn(async (args) => { calls.push('observation'); return { id: 'observation-1', ...args }; }) },
    policyRecommendation: { upsert: jest.fn(async () => { calls.push('recommendation'); }) },
    stepResult: { upsert: jest.fn(async () => { calls.push('result'); }) },
    episode: { update: jest.fn(async () => { calls.push('completed'); }) },
  };
  const prisma = { $transaction: (callback) => callback(tx) };
  const repo = new EpisodeRepository(prisma);
  const ep = { id: 'episode-1', episodeKey: 'key', policyId: 'policy-1' };
  const events = [
    { type: 'FleetObservation', schemaVersion: '2.0', step: 0 },
    { type: 'PolicyRecommendation', schemaVersion: '2.0', step: 0 },
    { type: 'StepResult', schemaVersion: '2.0', step: 0, stepCost: 1, episodeTerminated: true },
    { type: 'EpisodeSummary', stepsCompleted: 1, totalCost: 1, failureCount: 0, replacementCount: 0, waitingSteps: 0 },
  ];
  await repo.persistCompleted(ep, events);
  await repo.persistCompleted(ep, events);
  expect(tx.fleetObservation.upsert).toHaveBeenCalledTimes(2);
  expect(tx.fleetObservation.upsert.mock.calls[0][0].where).toEqual({ episodeId_step: { episodeId: 'episode-1', step: 0 } });
  expect(calls.slice(0, 4)).toEqual(['observation', 'recommendation', 'result', 'completed']);
});

test('retry preparation deletes the old execution root so cascading children cannot mix', async () => {
  const prisma = { fleetObservation: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) } };
  await new EpisodeRepository(prisma).prepareRetry('episode-1');
  expect(prisma.fleetObservation.deleteMany).toHaveBeenCalledWith({ where: { episodeId: 'episode-1' } });
});
