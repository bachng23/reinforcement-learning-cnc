const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { EpisodeRepository } = require('../src/worker/repository');
const { collectEngineEvents } = require('../src/worker/event-collector');
const { FakeEngineRunner } = require('../src/engine/fake-engine');
const describeDb = process.env.WORKER_TEST_DATABASE_URL ? describe : describe.skip;
describeDb('PostgreSQL worker durability (dedicated migrated database)', () => {
  let db, repo, experiment, policy;
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: process.env.WORKER_TEST_DATABASE_URL } } });
    if (await db.episode.count()) throw new Error('Worker integration tests require a dedicated database with no episodes');
    repo = new EpisodeRepository(db);
    const key = randomUUID();

    policy = await db.policy.create({ data: { policyKey: key, version: 'test', name: 'worker test' } });
    experiment = await db.experiment.create({ data: { experimentKey: key, name: 'worker test', policyId: policy.id, episodeCount: 10, runIdempotencyKey: key, environmentConfig: require('./helpers/worker-fixtures').environmentConfig } });
  });
  afterAll(async () => {
    if (experiment) await db.experiment.delete({ where: { id: experiment.id } });
    if (policy) await db.policy.delete({ where: { id: policy.id } });
    await db?.$disconnect();
  });
  async function pending(seed) {
    return db.episode.create({ data: { episodeKey: randomUUID(), experimentId: experiment.id, policyId: policy.id, episodeIndex: seed, seed } });
  }
  async function events(ep) {
    return collectEngineEvents(new FakeEngineRunner(), { episodeId: ep.id, attempt: ep.attempt, environmentConfig: require('./helpers/worker-fixtures').environmentConfig, policyId: policy.policyKey, policyVersion: 'test', seed: ep.seed });
  }
  test('two competing transactions claim a single pending episode once', async () => {
    const pendingEp = await pending(1);
    const claimed = (await Promise.all([repo.claimNext(), repo.claimNext()])).filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(pendingEp.id);
    await repo.markFailed(claimed[0], new Error('test cleanup'));
    await db.auditLog.deleteMany({ where: { entityId: pendingEp.id } });
  });
  test('step rollback includes progress and observation; summary rollback preserves RUNNING', async () => {
    await pending(2);
    const ep = await repo.claimNext();
    const stream = await events(ep);
    // Foreign key failure occurs after progress and observation writes inside transaction.
    await expect(repo.persistStep({ ...ep, policyId: randomUUID() }, stream.slice(0, 3))).rejects.toThrow();
    expect(await db.fleetObservation.count({ where: { episodeId: ep.id } })).toBe(0);
    expect((await db.episode.findUnique({ where: { id: ep.id } })).stepsCompleted).toBe(0);
    await repo.persistStep(ep, stream.slice(0, 3));
    await repo.persistStep(ep, stream.slice(0, 3));
    expect(await db.fleetObservation.count({ where: { episodeId: ep.id } })).toBe(1);
    await repo.persistStep(ep, stream.slice(3, 6));
    // A duplicate summary forces a DB error before completion.
    await db.episodeSummary.create({ data: { episodeId: ep.id, attempt: ep.attempt, schemaVersion: '2.0', payloadJson: stream.at(-1).payload } });
    await expect(repo.persistSummary(ep, stream.at(-1))).rejects.toThrow();
    expect((await db.episode.findUnique({ where: { id: ep.id } })).status).toBe('RUNNING');
    await db.episodeSummary.deleteMany({ where: { episodeId: ep.id } });
    await repo.persistSummary(ep, stream.at(-1));
    expect((await db.episode.findUnique({ where: { id: ep.id }, include: { summaries: true } }))).toMatchObject({ status: 'COMPLETED', stepsCompleted: 2, summaries: [{ payloadJson: stream.at(-1).payload }] });
  });
  test('renewed lease survives recovery; expired owner cannot write or fail a replacement', async () => {
    await pending(3);
    const ep = await repo.claimNext();
    const stream = await events(ep);
    await repo.heartbeat(ep, 120000);
    await repo.persistStep(ep, stream.slice(0, 3));
    await repo.recoverStale();
    expect((await db.episode.findUnique({ where: { id: ep.id } })).status).toBe('RUNNING');
    await db.episode.update({ where: { id: ep.id }, data: { leaseExpiresAt: new Date(0) } });
    await repo.recoverStale();
    await expect(repo.persistStep(ep, stream.slice(0, 3))).rejects.toMatchObject({ code: 'WORKER_LEASE_LOST' });
    await require('../src/services/episode-lifecycle.service').transitionEpisode({ client: db, episodeId: ep.id, from: 'FAILED', to: 'PENDING' });
    const replacement = await repo.claimNext();
    expect(replacement.attempt).toBe(ep.attempt + 1);
    const replay = await events(replacement);
    await repo.persistStep(replacement, replay.slice(0, 3));
    const history = await db.fleetObservation.findMany({ where: { episodeId: ep.id }, orderBy: { attempt: 'asc' } });
    expect(history.map((row) => row.attempt)).toEqual([1, 2]);
    expect(history[0].observationKey).not.toBe(history[1].observationKey);
    await expect(repo.markFailed(ep, new Error('old owner'))).rejects.toMatchObject({ code: 'WORKER_LEASE_LOST' });
    expect((await db.episode.findUnique({ where: { id: ep.id } })).status).toBe('RUNNING');
  });
});
