const { EpisodeRepository } = require('../src/worker/repository');
const ep = { id: 'episode-1', episodeKey: 'key', policyId: 'policy-1', leaseToken: 'token' };
const events = [
  { type: 'FleetObservation', schemaVersion: '2.0', step: 0 },
  { type: 'PolicyRecommendation', schemaVersion: '2.0', step: 0 },
  { type: 'StepResult', schemaVersion: '2.0', step: 0, stepCost: 1, episodeTerminated: true },
];
function setup() {
  const calls = [];
  const tx = {
    fleetObservation: { create: jest.fn(async () => { calls.push('observation'); return { id: 'obs' }; }) },
    policyRecommendation: { create: jest.fn(async () => { calls.push('recommendation'); }) },
    stepResult: { create: jest.fn(async () => { calls.push('result'); }) },
    episodeSummary: { create: jest.fn(async () => { calls.push('summary'); }) },
    auditLog: { create: jest.fn() },
    episode: { updateMany: jest.fn(async () => { calls.push('guard'); return { count: 1 }; }),
      update: jest.fn(async () => { calls.push('completed'); }) },
  };
  const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
  return { tx, calls, prisma, repo: new EpisodeRepository(prisma) };
}
test('atomic claim loser never runs the candidate', async () => {
  const { tx, repo } = setup();
  tx.episode.findFirst = jest.fn().mockResolvedValue({ id: ep.id });
  tx.episode.findUnique = jest.fn();
  tx.episode.updateMany.mockResolvedValue({ count: 0 });
  await expect(repo.claimNext()).resolves.toBeNull();
  expect(tx.episode.findUnique).not.toHaveBeenCalled();
  expect(tx.episode.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ep.id, status: 'PENDING' } }));
});
test('step records and progress are in one guarded transaction', async () => {
  const { repo, calls, tx, prisma } = setup();
  await repo.persistStep(ep, events);
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(calls).toEqual(['guard', 'observation', 'recommendation', 'result']);
  expect(tx.episode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ leaseToken: ep.leaseToken, status: 'RUNNING', stepsCompleted: 0, leaseExpiresAt: { gt: expect.any(Date) } }),
    data: expect.objectContaining({ stepsCompleted: 1 }),
  }));
  expect(tx.episode.update).not.toHaveBeenCalled();
});
test('summary persists before COMPLETED in same transaction', async () => {
  const { repo, calls, prisma } = setup();
  await repo.persistSummary(ep, { schemaVersion: '2.0', stepsCompleted: 1 });
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(calls).toEqual(['guard', 'summary', 'completed']);
});
test('summary failure never writes COMPLETED', async () => {
  const { repo, tx } = setup();
  tx.episodeSummary.create.mockRejectedValue(new Error('DB failure'));
  await expect(repo.persistSummary(ep, { stepsCompleted: 1 })).rejects.toThrow('DB failure');
  expect(tx.episode.update).not.toHaveBeenCalled();
});
test.each(['persistStep', 'persistSummary', 'markFailed'])('lost owner is fenced out of %s', async (method) => {
  const { repo, tx } = setup();
  tx.episode.updateMany.mockResolvedValue({ count: 0 });
  const arg = method === 'persistStep' ? events : method === 'markFailed' ? new Error('fail') : { stepsCompleted: 1 };
  await expect(repo[method](ep, arg)).rejects.toMatchObject({ code: 'WORKER_LEASE_LOST' });
  expect(tx.fleetObservation.create).not.toHaveBeenCalled();
  expect(tx.episodeSummary.create).not.toHaveBeenCalled();
  expect(tx.auditLog.create).not.toHaveBeenCalled();
});
test('stale recovery uses lease expiry and preserves progress', async () => {
  const prisma = { episode: { updateMany: jest.fn() } };
  const now = new Date();
  await new EpisodeRepository(prisma).recoverStale(now);
  const { where, data } = prisma.episode.updateMany.mock.calls[0][0];
  expect(where.OR).toContainEqual({ leaseExpiresAt: { lte: now } });
  expect(data.status).toBe('FAILED');
  expect(data.stepsCompleted).toBeUndefined();
});
