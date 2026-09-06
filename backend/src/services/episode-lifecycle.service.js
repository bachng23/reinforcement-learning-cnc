const prisma = require('../config/prisma');
const { ApiError } = require('../lib/api-error');

const TRANSITIONS = new Set([
  'PENDING:RUNNING',
  'RUNNING:COMPLETED',
  'RUNNING:FAILED',
  'PENDING:CANCELLED',
  'FAILED:PENDING',
]);

const safeFailure = (errorCode, errorMessage) => ({
  errorCode: typeof errorCode === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(errorCode)
    ? errorCode
    : 'ENGINE_ERROR',
  // This field is public. Worker integrations must never pass stack traces or secrets.
  errorMessage: typeof errorMessage === 'string' && errorMessage.trim()
    ? errorMessage.trim().slice(0, 500)
    : 'Episode execution failed',
});

const transitionData = ({ from, to, now, errorCode, errorMessage }) => {
  if (from === 'PENDING' && to === 'RUNNING') {
    return {
      status: to,
      startedAt: now,
      completedAt: null,
      failedAt: null,
      cancelledAt: null,
      errorCode: null,
      errorMessage: null,
    };
  }

  if (from === 'RUNNING' && to === 'COMPLETED') {
    return {
      status: to,
      completedAt: now,
      failedAt: null,
      errorCode: null,
      errorMessage: null,
    };
  }

  if (from === 'RUNNING' && to === 'FAILED') {
    const failure = safeFailure(errorCode, errorMessage);
    return {
      status: to,
      failedAt: now,
      completedAt: null,
      ...failure,
    };
  }

  if (to === 'CANCELLED') {
    return {
      status: to,
      cancelledAt: now,
      completedAt: null,
    };
  }

  // A retry starts a new attempt while preserving prior attempt event rows.
  return {
    status: 'PENDING',
    leaseToken: null,
    leaseExpiresAt: null,
    attempt: { increment: 1 },
    queuedAt: now,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    errorCode: null,
    errorMessage: null,
    stepsCompleted: 0,
    totalCost: null,
    failureCount: null,
    replacementCount: null,
    waitingSteps: null,
  };
};

/**
 * Atomically changes an episode from an expected status. The worker and API
 * should use this helper instead of a read-then-write status update.
 */
const transitionEpisode = async ({
  client = prisma,
  episodeId,
  from,
  to,
  allowRunningCancellation = false,
  errorCode,
  errorMessage,
  now = new Date(),
}) => {
  const transitionKey = `${from}:${to}`;
  const runningCancellation = transitionKey === 'RUNNING:CANCELLED';

  if (!TRANSITIONS.has(transitionKey) && !(runningCancellation && allowRunningCancellation)) {
    if (runningCancellation) {
      throw new ApiError(
        409,
        'RUNNING_CANCELLATION_UNSUPPORTED',
        'Running episode cancellation is not supported by the worker',
      );
    }
    throw new ApiError(
      409,
      'INVALID_EPISODE_TRANSITION',
      `Episode transition ${from} -> ${to} is not allowed`,
    );
  }

  const result = await client.episode.updateMany({
    where: { id: episodeId, status: from },
    data: transitionData({ from, to, now, errorCode, errorMessage }),
  });

  if (result.count !== 1) {
    const current = await client.episode.findUnique({
      where: { id: episodeId },
      select: { status: true },
    });
    if (!current) {
      throw new ApiError(404, 'EPISODE_NOT_FOUND', 'Episode was not found');
    }
    throw new ApiError(
      409,
      'INVALID_EPISODE_TRANSITION',
      `Episode is ${current.status}; expected ${from}`,
    );
  }

  return client.episode.findUnique({ where: { id: episodeId } });
};

/**
 * Claims one queued job without allowing two workers to win the same row.
 * Conditional updates provide the concurrency guard; a small candidate batch
 * avoids lock contention without requiring a broker or another service.
 */
const claimNextPendingEpisode = async ({ client = prisma, candidateLimit = 10 } = {}) => {
  const candidates = await client.episode.findMany({
    where: { status: 'PENDING' },
    select: { id: true },
    orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
    take: candidateLimit,
  });

  for (const candidate of candidates) {
    const claimed = await client.episode.updateMany({
      where: { id: candidate.id, status: 'PENDING' },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    if (claimed.count === 1) {
      return client.episode.findUnique({ where: { id: candidate.id } });
    }
  }

  return null;
};

module.exports = {
  transitionData,
  TRANSITIONS,
  claimNextPendingEpisode,
  transitionEpisode,
};
