const { EpisodeWorker } = require('../src/worker/episode-worker');
const { FakeEngineRunner } = require('../src/engine/fake-engine');

const episode = {
  id: 'episode-1', episodeKey: 'ep-key', experimentId: 'experiment-1', policyId: 'policy-1', seed: 3,
  experiment: { environmentConfig: { machineCount: 3, steps: 2, spareCount: 1 } },
  policy: { version: '1' },
};

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function repository(overrides = {}) {
  return {
    recoverStale: jest.fn().mockResolvedValue({ count: 0 }),
    claimNext: jest.fn().mockResolvedValue(episode),
    prepareRetry: jest.fn().mockResolvedValue(),
    persistCompleted: jest.fn().mockResolvedValue(),
    markFailed: jest.fn().mockResolvedValue(),
    ...overrides,
  };
}

test('successful execution cleans retries then persists summary and completed data', async () => {
  const repo = repository();
  const worker = new EpisodeWorker({ repository: repo, runner: new FakeEngineRunner(), logger: silentLogger });
  await expect(worker.processNext()).resolves.toBe(true);
  expect(repo.prepareRetry).toHaveBeenCalledWith('episode-1');
  expect(repo.persistCompleted).toHaveBeenCalledTimes(1);
  const events = repo.persistCompleted.mock.calls[0][1];
  expect(events.at(-1).type).toBe('EpisodeSummary');
  expect(repo.markFailed).not.toHaveBeenCalled();
  expect(worker.health.snapshot().state).toBe('HEALTHY');
});

test('partial persistence failure cannot produce completed status and is marked failed', async () => {
  const error = Object.assign(new Error('database write failed'), { code: 'PERSISTENCE_FAILED' });
  const repo = repository({ persistCompleted: jest.fn().mockRejectedValue(error) });
  const worker = new EpisodeWorker({ repository: repo, runner: new FakeEngineRunner(), logger: silentLogger });
  await worker.processNext();
  expect(repo.markFailed).toHaveBeenCalledWith(episode, error);
  expect(worker.health.snapshot().state).toBe('DEGRADED');
});

test('unexpected engine failure is marked failed with diagnostics', async () => {
  const runner = { version: 'broken-v1', async *execute() { throw new Error('boom'); } };
  const repo = repository();
  await new EpisodeWorker({ repository: repo, runner, logger: silentLogger }).processNext();
  expect(repo.persistCompleted).not.toHaveBeenCalled();
  expect(repo.markFailed).toHaveBeenCalledWith(episode, expect.objectContaining({ message: 'boom' }));
});

test('duplicate workers cannot process one repository claim', async () => {
  let available = true;
  const shared = repository({
    claimNext: jest.fn(async () => {
      if (!available) return null;
      available = false;
      return episode;
    }),
  });
  const workers = [1, 2].map(() => new EpisodeWorker({ repository: shared, runner: new FakeEngineRunner(), logger: silentLogger }));
  await Promise.all(workers.map((worker) => worker.processNext()));
  expect(shared.persistCompleted).toHaveBeenCalledTimes(1);
});

test('recovers stale work before polling', async () => {
  const repo = repository({ recoverStale: jest.fn().mockResolvedValue({ count: 2 }) });
  const worker = new EpisodeWorker({ repository: repo, runner: new FakeEngineRunner(), logger: silentLogger, staleAfterMs: 5000 });
  await expect(worker.recoverStale()).resolves.toBe(2);
  expect(repo.recoverStale.mock.calls[0][0]).toBeInstanceOf(Date);
});
