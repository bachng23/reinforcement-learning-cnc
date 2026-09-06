const { randomUUID } = require('node:crypto');
class LeaseLostError extends Error {
  constructor() { super('Episode lease is no longer owned by this worker'); this.code = 'WORKER_LEASE_LOST'; }
}
class EpisodeRepository {
  constructor(prisma) { this.prisma = prisma; }
  async recoverStale(now = new Date()) {
    return this.prisma.episode.updateMany({
      where: { status: 'RUNNING', OR: [{ leaseExpiresAt: { lte: now } }, { leaseExpiresAt: null }] },
      data: { status: 'FAILED', completedAt: now, leaseToken: null, leaseExpiresAt: null,
        failureCode: 'WORKER_LEASE_EXPIRED', failureMessage: 'Worker lease expired; partial steps retained' },
    });
  }
  async claimNext(leaseMs = 120000) {
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.episode.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (!candidate) return null;
      const now = new Date();
      const claimed = await tx.episode.updateMany({
        where: { id: candidate.id, status: 'PENDING' },
        data: { status: 'RUNNING', startedAt: now, completedAt: null, leaseToken: randomUUID(),
          leaseExpiresAt: new Date(now.getTime() + leaseMs), failureCode: null, failureMessage: null },
      });
      if (claimed.count !== 1) return null;
      return tx.episode.findUnique({ where: { id: candidate.id }, include: { experiment: true, policy: true } });
    });
  }
  owned(episode) {
    if (!episode.leaseToken) throw new LeaseLostError();
    return { id: episode.id, status: 'RUNNING', leaseToken: episode.leaseToken, leaseExpiresAt: { gt: new Date() } };
  }
  async guard(tx, episode, data = {}, extra = {}) {
    // Locks the episode row until the surrounding transaction commits.
    const result = await tx.episode.updateMany({ where: { ...this.owned(episode), ...extra }, data: { updatedAt: new Date(), ...data } });
    if (result.count !== 1) throw new LeaseLostError();
  }
  async heartbeat(episode, leaseMs) {
    await this.guard(this.prisma, episode, { leaseExpiresAt: new Date(Date.now() + leaseMs) });
  }
  async persistStep(episode, [observationEvent, recommendation, result]) {
    await this.prisma.$transaction(async (tx) => {
      await this.guard(tx, episode, { stepsCompleted: observationEvent.step + 1 }, { stepsCompleted: observationEvent.step });
      const observation = await tx.fleetObservation.create({ data: {
        observationKey: `${episode.episodeKey}:step:${observationEvent.step}`, episodeId: episode.id,
        step: observationEvent.step, schemaVersion: observationEvent.schemaVersion, payloadJson: observationEvent,
      } });
      await tx.policyRecommendation.create({ data: { observationId: observation.id, policyId: episode.policyId,
        schemaVersion: recommendation.schemaVersion, payloadJson: recommendation } });
      await tx.stepResult.create({ data: { observationId: observation.id, schemaVersion: result.schemaVersion,
        payloadJson: result, totalCost: result.stepCost, episodeTerminated: result.episodeTerminated } });
    });
  }
  async persistSummary(episode, summary) {
    await this.prisma.$transaction(async (tx) => {
      await this.guard(tx, episode, {}, { stepsCompleted: summary.stepsCompleted });
      await tx.episodeSummary.create({ data: { episodeId: episode.id, schemaVersion: summary.schemaVersion, payloadJson: summary } });
      await tx.episode.update({ where: { id: episode.id }, data: {
        status: 'COMPLETED', completedAt: new Date(), leaseToken: null, leaseExpiresAt: null,
        totalCost: summary.totalCost, failureCount: summary.failureCount,
        replacementCount: summary.replacementCount, waitingSteps: summary.waitingSteps,
      } });
    });
  }
  async markFailed(episode, error) {
    const code = error.code || 'ENGINE_EXECUTION_FAILED';
    const message = String(error.message || 'Unknown worker failure').slice(0, 1000);
    await this.prisma.$transaction(async (tx) => {
      await this.guard(tx, episode, { status: 'FAILED', completedAt: new Date(), leaseToken: null,
        leaseExpiresAt: null, failureCode: code, failureMessage: message });
      await tx.auditLog.create({ data: { entityType: 'EPISODE', entityId: episode.id, action: 'WORKER_FAILED', payloadJson: { code, message } } });
    });
  }
}
module.exports = { EpisodeRepository, LeaseLostError };
