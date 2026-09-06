const policyToDto = (policy) => ({
  id: policy.id,
  policyKey: policy.policyKey,
  version: policy.version,
  name: policy.name,
  description: policy.description ?? null,
  config: policy.configJson ?? null,
});

const policySummaryToDto = (policy) => ({
  id: policy.id,
  policyKey: policy.policyKey,
  version: policy.version,
  name: policy.name,
  description: policy.description ?? null,
});

const experimentToDto = (experiment) => ({
  id: experiment.id,
  experimentKey: experiment.experimentKey,
  name: experiment.name,
  description: experiment.description ?? null,
  schemaVersion: experiment.schemaVersion,
  status: experiment.status,
  episodeCount: experiment.episodeCount,
  policy: experiment.policy ? policySummaryToDto(experiment.policy) : undefined,
  environmentConfig: experiment.environmentConfig,
  createdById: experiment.createdById,
  runRequestedAt: experiment.runRequestedAt ?? null,
  createdAt: experiment.createdAt,
  updatedAt: experiment.updatedAt,
});

const experimentSummaryToDto = (experiment) => ({
  id: experiment.id,
  experimentKey: experiment.experimentKey,
  name: experiment.name,
  description: experiment.description ?? null,
  schemaVersion: experiment.schemaVersion,
  status: experiment.status,
  episodeCount: experiment.episodeCount,
  policy: experiment.policy ? policySummaryToDto(experiment.policy) : undefined,
  createdById: experiment.createdById,
  createdAt: experiment.createdAt,
  updatedAt: experiment.updatedAt,
});

const episodeToDto = (episode) => ({
  id: episode.id,
  episodeKey: episode.episodeKey,
  experimentId: episode.experimentId,
  episodeIndex: episode.episodeIndex,
  policy: episode.policy ? policySummaryToDto(episode.policy) : undefined,
  policyId: episode.policyId,
  seed: episode.seed,
  status: episode.status,
  attempt: episode.attempt,
  stepsCompleted: episode.stepsCompleted,
  totalCost: episode.totalCost,
  failureCount: episode.failureCount,
  replacementCount: episode.replacementCount,
  waitingSteps: episode.waitingSteps,
  queuedAt: episode.queuedAt,
  startedAt: episode.startedAt,
  completedAt: episode.completedAt,
  failedAt: episode.failedAt,
  cancelledAt: episode.cancelledAt,
  error: episode.errorCode
    ? { code: episode.errorCode, message: episode.errorMessage || 'Episode execution failed' }
    : null,
  createdAt: episode.createdAt,
  updatedAt: episode.updatedAt,
});

const queuedEpisodeToDto = (episode) => ({
  id: episode.id,
  episodeKey: episode.episodeKey,
  seed: episode.seed,
  status: episode.status,
  queuedAt: episode.queuedAt,
});

const eventToDto = (event) => ({
  id: event.id,
  observationKey: event.observationKey,
  observationId: event.observationId,
  policyId: event.policyId,
  attempt: event.attempt ?? event.observation?.attempt,
  step: event.step ?? event.observation?.step,
  schemaVersion: event.schemaVersion,
  totalCost: event.totalCost,
  episodeTerminated: event.episodeTerminated,
  payload: event.payloadJson,
  createdAt: event.createdAt,
});

module.exports = {
  episodeToDto,
  eventToDto,
  experimentSummaryToDto,
  experimentToDto,
  policyToDto,
  policySummaryToDto,
  queuedEpisodeToDto,
};
