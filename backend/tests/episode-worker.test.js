const { EpisodeWorker } = require('../src/worker/episode-worker');
const { FakeEngineRunner } = require('../src/engine/fake-engine');
const episode = { id: 'episode-1', episodeKey: 'ep-key', leaseToken: 'token', attempt: 1, experimentId: 'experiment-1', policyId: 'policy-1', seed: 3,
  experiment: { environmentConfig: require('./helpers/worker-fixtures').environmentConfig }, policy: { policyKey: 'policy-1', version: '1' } };
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
function repository(overrides = {}) {
  return { recoverStale: jest.fn().mockResolvedValue({ count: 0 }), claimNext: jest.fn().mockResolvedValue(episode),
    heartbeat: jest.fn().mockResolvedValue(), persistStep: jest.fn().mockResolvedValue(),
    persistSummary: jest.fn().mockResolvedValue(), markFailed: jest.fn().mockResolvedValue(), ...overrides };
}
function worker(repo, runner = new FakeEngineRunner(), options = {}) {
  return new EpisodeWorker({ repository: repo, runner, logger, ...options });
}
test('each validated step commits before requesting another event; summary is last', async () => {
  const repo = repository();
  const runner = { async *execute(request, options) {
    let count = 0;
    for await (const event of new FakeEngineRunner().execute(request, options)) {
      if (count === 3) expect(repo.persistStep).toHaveBeenCalledTimes(1);
      yield event;
      count += 1;
    }
  } };
  await worker(repo, runner).processNext();
  expect(repo.persistStep).toHaveBeenCalledTimes(2);
  expect(repo.persistSummary).toHaveBeenCalledWith(episode, expect.objectContaining({ type: 'EpisodeSummary', payload: expect.objectContaining({ steps_completed: 2 }) }));
  expect(repo.markFailed).not.toHaveBeenCalled();
});
test('step DB failure stops consumption and prevents summary completion', async () => {
  const error = new Error('database write failed');
  const repo = repository({ persistStep: jest.fn().mockRejectedValue(error) });
  await worker(repo).processNext();
  expect(repo.persistStep).toHaveBeenCalledTimes(1);
  expect(repo.persistSummary).not.toHaveBeenCalled();
  expect(repo.markFailed).toHaveBeenCalledWith(episode, error);
});
test('summary DB failure marks job failed', async () => {
  const repo = repository({ persistSummary: jest.fn().mockRejectedValue(new Error('summary failed')) });
  await worker(repo).processNext();
  expect(repo.persistStep).toHaveBeenCalledTimes(2);
  expect(repo.markFailed).toHaveBeenCalled();
});
test('engine crash preserves already committed step', async () => {
  const repo = repository();
  const runner = { async *execute(request) {
    let count = 0;
    for await (const event of new FakeEngineRunner().execute(request)) {
      yield event;
      if (++count === 3) throw new Error('crash');
    }
  } };
  await worker(repo, runner).processNext();
  expect(repo.persistStep).toHaveBeenCalledTimes(1);
  expect(repo.persistSummary).not.toHaveBeenCalled();
  expect(repo.markFailed).toHaveBeenCalledWith(episode, expect.objectContaining({ message: 'crash' }));
});
test('heartbeats continue while engine waits and shutdown aborts a stuck engine', async () => {
  const repo = repository();
  let signal;
  const runner = { execute(_request, options) { signal = options.signal; return { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; } }; } };
  const w = worker(repo, runner, { heartbeatMs: 5, staleAfterMs: 100, shutdownMs: 25, timeoutMs: 1000 });
  const active = w.processNext();
  await new Promise((resolve) => setTimeout(resolve, 15));
  await w.stop();
  await active;
  expect(repo.heartbeat).toHaveBeenCalled();
  expect(signal.aborted).toBe(true);
  expect(repo.markFailed).toHaveBeenCalledWith(episode, expect.objectContaining({ code: 'WORKER_SHUTDOWN' }));
  await expect(w.processNext()).resolves.toBe(false);
  expect(repo.claimNext).toHaveBeenCalledTimes(1);
});
test('lease loss cancels engine and cannot complete', async () => {
  const repo = repository({ heartbeat: jest.fn().mockRejectedValue(Object.assign(new Error('lost'), { code: 'WORKER_LEASE_LOST' })) });
  const runner = { async *execute() { await new Promise(() => {}); } };
  await worker(repo, runner, { heartbeatMs: 5, staleAfterMs: 100 }).processNext();
  expect(repo.persistSummary).not.toHaveBeenCalled();
  expect(repo.markFailed).toHaveBeenCalledWith(episode, expect.objectContaining({ code: 'WORKER_LEASE_LOST' }));
});
test('graceful drain completes current episode and prevents new claims', async () => {
  const repo = repository();
  let w;
  const runner = { async *execute(request) { w.stop(); yield* new FakeEngineRunner().execute(request); } };
  w = worker(repo, runner);
  await w.processNext();
  expect(repo.persistSummary).toHaveBeenCalledTimes(1);
  await expect(w.processNext()).resolves.toBe(false);
});
test('stop during claim marks claimed episode failed without starting engine', async () => {
  let release;
  const repo = repository({ claimNext: jest.fn(() => new Promise((resolve) => { release = resolve; })) });
  const runner = { execute: jest.fn() };
  const w = worker(repo, runner);
  const active = w.processNext();
  w.stop();
  release(episode);
  await active;
  expect(runner.execute).not.toHaveBeenCalled();
  expect(repo.markFailed).toHaveBeenCalledWith(episode, expect.objectContaining({ code: 'WORKER_SHUTDOWN' }));
});
test('same worker cannot start overlapping polls', async () => {
  const repo = repository();
  const w = worker(repo);
  await Promise.all([w.processNext(), w.processNext()]);
  expect(repo.claimNext).toHaveBeenCalledTimes(1);
});
