const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { decide } = require('../src/services/maintenance-decision.service');
const describeDb = process.env.MAINTENANCE_TEST_DATABASE_URL ? describe : describe.skip;

describeDb('Maintenance PostgreSQL integration (dedicated migrated database)', () => {
  let db;
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url: process.env.MAINTENANCE_TEST_DATABASE_URL } } }); });
  afterAll(async () => { await db.$disconnect(); });
  test('atomic review, audit, immutable snapshots, database transition guards and rollback', async () => {
    const rollback = new Error('rollback test fixtures');
    await expect(db.$transaction(async (tx) => {
      const key = randomUUID();
      const user = await tx.user.create({ data: { username: key, passwordHash: 'test-only', role: 'OPERATOR' } });
      const policy = await tx.policy.create({ data: { policyKey: key, version: 'test', name: 'test' } });
      const experiment = await tx.experiment.create({ data: {
        experimentKey: key, name: 'test', policyId: policy.id, createdById: user.id, episodeCount: 1,
        environmentConfig: { risk: { objective: 'CVAR' } },
      } });
      const episode = await tx.episode.create({ data: { episodeKey: key, experimentId: experiment.id, policyId: policy.id, episodeIndex: 0, seed: 1 } });
      const observation = await tx.fleetObservation.create({ data: { observationKey: key, episodeId: episode.id, step: 0, payloadJson: { machines: [{ machine_id: 'm1', risk: 0.8 }] } } });
      const joint = { schema_version: '2.0', observation_id: key, actions: [{ machine_id: 'm1', action: 'CONTINUE' }] };
      const recommendation = await tx.policyRecommendation.create({ data: { observationId: observation.id, policyId: policy.id, payloadJson: { actions: joint, estimated_cvar_cost: 42 } } });
      const decision = await tx.maintenanceDecision.create({ data: { recommendationId: recommendation.id } });
      const client = { $transaction: (fn) => fn(tx) };

      // Simulate audit storage failure after the status/action writes and prove rollback.
      await tx.$executeRawUnsafe('SAVEPOINT failed_review');
      const broken = { $transaction: (fn) => fn({
        maintenanceDecision: tx.maintenanceDecision,
        maintenanceDecisionAction: tx.maintenanceDecisionAction,
        auditLog: { create: async () => { throw new Error('audit unavailable'); } },
      }) };
      await expect(decide(broken, { id: decision.id, user, to: 'APPROVED', body: {} })).rejects.toThrow('audit unavailable');
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT failed_review');
      expect((await tx.maintenanceDecision.findUnique({ where: { id: decision.id } })).status).toBe('PENDING_REVIEW');
      expect(await tx.maintenanceDecisionAction.count({ where: { decisionId: decision.id } })).toBe(0);

      const reviewed = await decide(client, { id: decision.id, user, to: 'OVERRIDDEN', body: {
        reason: 'Inspection disagrees with policy', replacementAction: { ...joint, actions: [{ machine_id: 'm1', action: 'REPLACE' }] },
      } });
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      const audit = await tx.auditLog.findFirst({ where: { entityId: decision.id } });
      expect(audit.actorUserId).toBe(user.id);
      expect(audit.createdAt).toEqual(reviewed.action.createdAt);
      await tx.policyRecommendation.update({ where: { id: recommendation.id }, data: { payloadJson: { changed: true } } });
      const history = await tx.maintenanceDecisionAction.findUnique({ where: { decisionId: decision.id } });
      expect(history.recommendationSnapshot.payload.estimated_cvar_cost).toBe(42);
      expect(history.riskSnapshot.observation.machines[0].risk).toBe(0.8);
      await expect(decide(client, { id: decision.id, user, to: 'APPROVED', body: {} })).rejects.toMatchObject({ statusCode: 409 });
      for (const operation of [
        () => tx.maintenanceDecisionAction.update({ where: { id: history.id }, data: { reason: 'tampered' } }),
        () => tx.maintenanceDecisionAction.delete({ where: { id: history.id } }),
        () => tx.maintenanceDecision.update({ where: { id: decision.id }, data: { status: 'PENDING_REVIEW' } }),
      ]) {
        await tx.$executeRawUnsafe('SAVEPOINT mutation_guard');
        await expect(operation()).rejects.toThrow();
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT mutation_guard');
      }
      throw rollback;
    }, { isolationLevel: 'RepeatableRead', timeout: 20000 })).rejects.toBe(rollback);
  });
});
