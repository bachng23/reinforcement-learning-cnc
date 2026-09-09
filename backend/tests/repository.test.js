const { EpisodeRepository } = require('../src/worker/repository');
const ep = { id: 'episode-1', episodeKey: 'key', policyId: 'policy-1', leaseToken: 'token', attempt: 1 };
const events = [
  { type: 'FleetObservation', payload: { schema_version: '2.0', observation_id: 'obs-1', step: 0 } },
  { type: 'PolicyRecommendation', payload: { schema_version: '2.0' } },
  { type: 'StepResult', payload: { schema_version: '2.0', step: 0, total_cost: 1, episode_terminated: true } },
];
function setup() {
  const calls = [];
  const tx = {
    fleetObservation: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(async () => { calls.push('observation'); return { id: 'obs' }; }) },
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
  expect(calls).toEqual(['guard', 'guard', 'observation', 'recommendation', 'result']);
  expect(tx.episode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ leaseToken: ep.leaseToken, status: 'RUNNING', stepsCompleted: 0, leaseExpiresAt: { gt: expect.any(Date) } }),
    data: expect.objectContaining({ stepsCompleted: 1 }),
  }));
  expect(tx.episode.update).not.toHaveBeenCalled();
});
test('summary persists before COMPLETED in same transaction', async () => {
  const { repo, calls, prisma } = setup();
  await repo.persistSummary(ep, { payload: { schema_version: '2.0', steps_completed: 1 } });
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(calls).toEqual(['guard', 'summary', 'completed']);
});
test('summary failure never writes COMPLETED', async () => {
  const { repo, tx } = setup();
  tx.episodeSummary.create.mockRejectedValue(new Error('DB failure'));
  await expect(repo.persistSummary(ep, { payload: { steps_completed: 1 } })).rejects.toThrow('DB failure');
  expect(tx.episode.update).not.toHaveBeenCalled();
});
test.each(['persistStep', 'persistSummary', 'markFailed'])('lost owner is fenced out of %s', async (method) => {
  const { repo, tx } = setup();
  tx.episode.updateMany.mockResolvedValue({ count: 0 });
  const arg = method === 'persistStep' ? events : method === 'markFailed' ? new Error('fail') : { payload: { steps_completed: 1 } };
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


test('identical step replay is idempotent and keeps immutable records', async () => {
  const { repo, tx } = setup();
  tx.fleetObservation.findUnique.mockResolvedValue({ payloadJson: events[0].payload,
    recommendation: { payloadJson: events[1].payload }, stepResult: { payloadJson: events[2].payload } });
  await repo.persistStep(ep, events);
  expect(tx.fleetObservation.create).not.toHaveBeenCalled();
  expect(tx.episode.updateMany).toHaveBeenCalledTimes(1);
});
test('conflicting step replay fails instead of overwriting history', async () => {
  const { repo, tx } = setup();
  tx.fleetObservation.findUnique.mockResolvedValue({ payloadJson: { altered: true } });
  await expect(repo.persistStep(ep, events)).rejects.toMatchObject({ code: 'ENGINE_PROTOCOL_ERROR' });
  expect(tx.fleetObservation.create).not.toHaveBeenCalled();
});
test('raw engine and DB errors never enter public errorMessage or audit payload', async () => {
  const { repo, tx } = setup();
  await repo.markFailed(ep, Object.assign(new Error('password=secret SELECT private_data'), { code: 'P2002' }));
  const data = tx.episode.updateMany.mock.calls[0][0].data;
  expect(data.errorCode).toBe('ENGINE_EXECUTION_FAILED');
  expect(data.errorMessage).not.toMatch(/secret|SELECT|private_data/);
  expect(data.failedAt).toBeInstanceOf(Date);
  expect(data.completedAt).toBeNull();
  expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toMatch(/secret|SELECT|private_data/);
});
