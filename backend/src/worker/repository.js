const { randomUUID } = require('node:crypto');
const { transitionData } = require('../services/episode-lifecycle.service');
class LeaseLostError extends Error {
  constructor() { super('Episode lease is no longer owned by this worker'); this.code = 'WORKER_LEASE_LOST'; }
}
const publicFailure = (error) => {
  const messages = {
    ENGINE_TIMEOUT: 'Engine did not respond within the configured time.',
    ENGINE_EVENT_INVALID: 'Engine returned an invalid event.',
    ENGINE_PROTOCOL_ERROR: 'Engine returned an invalid event sequence.',
    ENGINE_SUMMARY_MISSING: 'Engine did not provide a final summary.',
    WORKER_SHUTDOWN: 'Worker stopped before the episode completed.',
    WORKER_LEASE_LOST: 'Worker no longer owns this episode.',
    WORKER_LEASE_EXPIRED: 'Worker lease expired before the episode completed.',
  };
  const code = Object.hasOwn(messages, error.code) ? error.code : 'ENGINE_EXECUTION_FAILED';
  return { code, message: messages[code] || 'Episode execution failed. See internal worker logs for diagnostics.' };
};
class EpisodeRepository {
  constructor(prisma) { this.prisma = prisma; }
  async recoverStale(now = new Date()) {
    const failure = publicFailure({ code: 'WORKER_LEASE_EXPIRED' });
    return this.prisma.episode.updateMany({
      where: { status: 'RUNNING', OR: [{ leaseExpiresAt: { lte: now } }, { leaseExpiresAt: null }] },
      data: { ...transitionData({ from: 'RUNNING', to: 'FAILED', now, errorCode: failure.code, errorMessage: failure.message }),
        leaseToken: null, leaseExpiresAt: null },
    });
  }
  async claimNext(leaseMs = 120000) {
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.episode.findFirst({ where: { status: 'PENDING' }, orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }], select: { id: true } });
      if (!candidate) return null;
      const now = new Date();
      const claimed = await tx.episode.updateMany({
        where: { id: candidate.id, status: 'PENDING' },
        data: { ...transitionData({ from: 'PENDING', to: 'RUNNING', now }), leaseToken: randomUUID(),
          leaseExpiresAt: new Date(now.getTime() + leaseMs) },
      });
      if (claimed.count !== 1) return null;
      return tx.episode.findUnique({ where: { id: candidate.id }, include: { experiment: true, policy: true } });
    });
  }
  owned(episode) {
    if (!episode.leaseToken || !Number.isInteger(episode.attempt)) throw new LeaseLostError();
    return { id: episode.id, attempt: episode.attempt, status: 'RUNNING', leaseToken: episode.leaseToken, leaseExpiresAt: { gt: new Date() } };
  }
  async guard(tx, episode, data = {}, extra = {}) {
    // Row lock fences the whole transaction, including concurrent recovery/retry.
    const result = await tx.episode.updateMany({ where: { ...this.owned(episode), ...extra }, data: { updatedAt: new Date(), ...data } });
    if (result.count !== 1) throw new LeaseLostError();
  }
  async heartbeat(episode, leaseMs) {
    await this.guard(this.prisma, episode, { leaseExpiresAt: new Date(Date.now() + leaseMs) });
  }
  async persistStep(episode, events) {
    const [observationPayload, recommendation, result] = events.map((event) => event.payload);
    await this.prisma.$transaction(async (tx) => {
      await this.guard(tx, episode);
      const key = { episodeId: episode.id, attempt: episode.attempt, step: observationPayload.step };
      const existing = await tx.fleetObservation.findUnique({
        where: { episodeId_attempt_step: key }, include: { recommendation: true, stepResult: true },
      });
      if (existing) {
        const { isDeepStrictEqual } = require('node:util');
        if (!isDeepStrictEqual(existing.payloadJson, observationPayload)
          || !isDeepStrictEqual(existing.recommendation?.payloadJson, recommendation)
          || !isDeepStrictEqual(existing.stepResult?.payloadJson, result)) {
          throw Object.assign(new Error('Conflicting replay of an immutable step'), { code: 'ENGINE_PROTOCOL_ERROR' });
        }
        return;
      }
      await this.guard(tx, episode, { stepsCompleted: observationPayload.step + 1 }, { stepsCompleted: observationPayload.step });
      const observation = await tx.fleetObservation.create({ data: {
        ...key, observationKey: observationPayload.observation_id,
        schemaVersion: observationPayload.schema_version, payloadJson: observationPayload,
      } });
      await tx.policyRecommendation.create({ data: { observationId: observation.id, policyId: episode.policyId,
        schemaVersion: recommendation.schema_version, payloadJson: recommendation } });
      await tx.stepResult.create({ data: { observationId: observation.id, schemaVersion: result.schema_version,
        payloadJson: result, totalCost: result.total_cost, episodeTerminated: result.episode_terminated } });
    });
  }
  async persistSummary(episode, event) {
    const summary = event.payload;
    await this.prisma.$transaction(async (tx) => {
      await this.guard(tx, episode, {}, { stepsCompleted: summary.steps_completed });
      await tx.episodeSummary.create({ data: { episodeId: episode.id, attempt: episode.attempt, schemaVersion: summary.schema_version, payloadJson: summary } });
      await tx.episode.update({ where: { id: episode.id }, data: {
        ...transitionData({ from: 'RUNNING', to: 'COMPLETED', now: new Date() }), leaseToken: null, leaseExpiresAt: null,
        totalCost: summary.total_cost, failureCount: summary.failure_count,
        replacementCount: summary.replacement_count, waitingSteps: summary.waiting_steps,
      } });
    });
  }
  async markFailed(episode, error) {
    const { code, message } = publicFailure(error);
    await this.prisma.$transaction(async (tx) => {
      await this.guard(tx, episode, {
        ...transitionData({ from: 'RUNNING', to: 'FAILED', now: new Date(), errorCode: code, errorMessage: message }),
        leaseToken: null, leaseExpiresAt: null,
      });
      await tx.auditLog.create({ data: { entityType: 'EPISODE', entityId: episode.id, action: 'WORKER_FAILED', payloadJson: { code, message, attempt: episode.attempt } } });
    });
  }
}
module.exports = { EpisodeRepository, LeaseLostError };
