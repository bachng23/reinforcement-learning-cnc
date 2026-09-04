class EpisodeRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async recoverStale(staleBefore) {
    return this.prisma.episode.updateMany({
      where: { status: 'RUNNING', updatedAt: { lt: staleBefore } },
      data: { status: 'PENDING', startedAt: null },
    });
  }

  async claimNext(now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.episode.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!candidate) return null;
      const claimed = await tx.episode.updateMany({
        where: { id: candidate.id, status: 'PENDING' },
        data: { status: 'RUNNING', startedAt: now, completedAt: null },
      });
      if (claimed.count !== 1) return null;
      return tx.episode.findUnique({
        where: { id: candidate.id },
        include: { experiment: true, policy: true },
      });
    });
  }

  async prepareRetry(episodeId) {
    await this.prisma.fleetObservation.deleteMany({ where: { episodeId } });
  }

  async persistCompleted(episode, events) {
    const summary = events.at(-1);
    await this.prisma.$transaction(async (tx) => {
      for (const observationEvent of events.filter((event) => event.type === 'FleetObservation')) {
        const observation = await tx.fleetObservation.upsert({
          where: { episodeId_step: { episodeId: episode.id, step: observationEvent.step } },
          create: {
            observationKey: `${episode.episodeKey}:step:${observationEvent.step}`,
            episodeId: episode.id, step: observationEvent.step,
            schemaVersion: observationEvent.schemaVersion, payloadJson: observationEvent,
          },
          update: { schemaVersion: observationEvent.schemaVersion, payloadJson: observationEvent },
        });
        const recommendation = events.find((event) => event.type === 'PolicyRecommendation' && event.step === observationEvent.step);
        const result = events.find((event) => event.type === 'StepResult' && event.step === observationEvent.step);
        await tx.policyRecommendation.upsert({
          where: { observationId: observation.id },
          create: { observationId: observation.id, policyId: episode.policyId, schemaVersion: recommendation.schemaVersion, payloadJson: recommendation },
          update: { schemaVersion: recommendation.schemaVersion, payloadJson: recommendation },
        });
        await tx.stepResult.upsert({
          where: { observationId: observation.id },
          create: { observationId: observation.id, schemaVersion: result.schemaVersion, payloadJson: result, totalCost: result.stepCost, episodeTerminated: result.episodeTerminated },
          update: { schemaVersion: result.schemaVersion, payloadJson: result, totalCost: result.stepCost, episodeTerminated: result.episodeTerminated },
        });
      }
      await tx.episode.update({
        where: { id: episode.id },
        data: {
          status: 'COMPLETED', completedAt: new Date(), stepsCompleted: summary.stepsCompleted,
          totalCost: summary.totalCost, failureCount: summary.failureCount,
          replacementCount: summary.replacementCount, waitingSteps: summary.waitingSteps,
        },
      });
    });
  }

  async markFailed(episode, error) {
    const message = String(error.message || 'Unknown worker failure').slice(0, 1000);
    await this.prisma.$transaction([
      this.prisma.episode.update({ where: { id: episode.id }, data: { status: 'FAILED', completedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: {
          entityType: 'EPISODE', entityId: episode.id, action: 'WORKER_FAILED',
          payloadJson: { code: error.code || 'ENGINE_EXECUTION_FAILED', message },
        },
      }),
    ]);
  }
}

module.exports = { EpisodeRepository };
