const { claimNextPendingEpisode } = require('../services/episode-lifecycle.service');

class EpisodeRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async recoverStale(staleBefore, now = new Date()) {
    return this.prisma.episode.updateMany({
      where: { status: 'RUNNING', updatedAt: { lt: staleBefore } },
      data: {
        status: 'FAILED',
        failedAt: now,
        completedAt: null,
        errorCode: 'WORKER_STALE',
        errorMessage: 'Worker stopped before the episode completed',
      },
    });
  }

  async claimNext() {
    const claimed = await claimNextPendingEpisode({ client: this.prisma });
    if (!claimed) return null;
    return this.prisma.episode.findUnique({
      where: { id: claimed.id },
      include: { experiment: true, policy: true },
    });
  }

  async persistCompleted(episode, events) {
    const summary = events.at(-1).payload;
    const attempt = episode.attempt;
    await this.prisma.$transaction(async (tx) => {
      for (const observationEvent of events.filter((event) => event.type === 'FleetObservation')) {
        const observationPayload = observationEvent.payload;
        const recommendationPayload = events.find((event) => (
          event.type === 'PolicyRecommendation'
          && event.payload.observation_id === observationPayload.observation_id
        )).payload;
        const resultPayload = events.find((event) => (
          event.type === 'StepResult'
          && event.payload.observation_id === observationPayload.observation_id
        )).payload;
        const observation = await tx.fleetObservation.upsert({
          where: {
            episodeId_attempt_step: {
              episodeId: episode.id,
              attempt,
              step: observationPayload.step,
            },
          },
          create: {
            observationKey: observationPayload.observation_id,
            episodeId: episode.id,
            attempt,
            step: observationPayload.step,
            schemaVersion: observationPayload.schema_version,
            payloadJson: observationPayload,
          },
          update: {},
        });
        await tx.policyRecommendation.upsert({
          where: { observationId: observation.id },
          create: {
            observationId: observation.id,
            policyId: episode.policyId,
            schemaVersion: recommendationPayload.schema_version,
            payloadJson: recommendationPayload,
          },
          update: {},
        });
        await tx.stepResult.upsert({
          where: { observationId: observation.id },
          create: {
            observationId: observation.id,
            schemaVersion: resultPayload.schema_version,
            payloadJson: resultPayload,
            totalCost: resultPayload.total_cost,
            episodeTerminated: resultPayload.episode_terminated,
          },
          update: {},
        });
      }

      await tx.episodeSummary.upsert({
        where: { episodeId_attempt: { episodeId: episode.id, attempt } },
        create: {
          episodeId: episode.id,
          attempt,
          schemaVersion: summary.schema_version,
          payloadJson: summary,
        },
        update: {},
      });

      const completed = await tx.episode.updateMany({
        where: { id: episode.id, status: 'RUNNING', attempt },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          failedAt: null,
          errorCode: null,
          errorMessage: null,
          stepsCompleted: summary.steps_completed,
          totalCost: summary.total_cost,
          failureCount: summary.failure_count,
          replacementCount: summary.replacement_count,
          waitingSteps: summary.waiting_steps,
        },
      });
      if (completed.count !== 1) {
        const error = new Error('Episode was no longer owned by this worker');
        error.code = 'EPISODE_OWNERSHIP_LOST';
        throw error;
      }
    });
  }

  async markFailed(episode, error) {
    const code = typeof error.code === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(error.code)
      ? error.code
      : 'ENGINE_ERROR';
    const message = typeof error.message === 'string' && error.message.trim()
      ? error.message.trim().slice(0, 500)
      : 'Episode execution failed';
    await this.prisma.$transaction(async (tx) => {
      const failed = await tx.episode.updateMany({
        where: { id: episode.id, status: 'RUNNING', attempt: episode.attempt },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          completedAt: null,
          errorCode: code,
          errorMessage: message,
        },
      });
      if (failed.count !== 1) return;
      await tx.auditLog.create({
        data: {
          entityType: 'EPISODE',
          entityId: episode.id,
          action: 'WORKER_FAILED',
          payloadJson: { code, message },
        },
      });
    });
  }
}

module.exports = { EpisodeRepository };
