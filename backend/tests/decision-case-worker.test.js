const { DecisionCaseWorker } = require('../src/decision-worker/decision-case-worker');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('persistence waits for an in-flight heartbeat and uses its new revision', async () => {
  const started = deferred(), renewal = deferred();
  const claim = { id: 'case', revision: 2 };
  const lifecycleService = {
    claimNextDecisionCase: jest.fn().mockResolvedValue(claim),
    buildPlanningRequest: jest.fn().mockResolvedValue({}),
    heartbeatDecisionCase: jest.fn(async () => {
      started.resolve();
      return renewal.promise;
    }),
    persistDecisionRecommendation: jest.fn(async (_db, owner) => {
      expect(owner.revision).toBe(3);
    }),
  };
  const worker = new DecisionCaseWorker({ db: {}, lifecycleService, heartbeatMs: 10,
    planningClient: { plan: async () => {
      await started.promise;
      return { recommendation_id: 'recommendation' };
    } },
  });
  const running = worker.runOnce();
  await started.promise;
  await new Promise(resolve => setImmediate(resolve));
  expect(lifecycleService.persistDecisionRecommendation).not.toHaveBeenCalled();
  renewal.resolve({ revision: 3, leaseExpiresAt: new Date() });
  await expect(running).resolves.toMatchObject({ outcome: 'completed' });
  expect(lifecycleService.heartbeatDecisionCase).toHaveBeenCalledTimes(1);
});

test('a renewal that loses ownership cannot persist or record a planning failure', async () => {
  const started = deferred(), renewal = deferred();
  const lifecycleService = {
    claimNextDecisionCase: jest.fn().mockResolvedValue({ id: 'case', revision: 2 }),
    buildPlanningRequest: jest.fn().mockResolvedValue({}),
    heartbeatDecisionCase: jest.fn(async () => {
      started.resolve();
      return renewal.promise;
    }),
    persistDecisionRecommendation: jest.fn(),
    blockDecisionCase: jest.fn(),
  };
  const worker = new DecisionCaseWorker({ db: {}, lifecycleService, heartbeatMs: 10,
    planningClient: { plan: async () => {
      await started.promise;
      return { recommendation_id: 'recommendation' };
    } },
  });
  const running = worker.runOnce();
  await started.promise;
  renewal.resolve(null);
  await expect(running).resolves.toEqual({ outcome: 'lease-lost', caseId: 'case' });
  expect(lifecycleService.persistDecisionRecommendation).not.toHaveBeenCalled();
  expect(lifecycleService.blockDecisionCase).not.toHaveBeenCalled();
});
