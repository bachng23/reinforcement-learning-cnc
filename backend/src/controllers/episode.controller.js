const { z } = require('zod');
const prisma = require('../config/prisma');
const { ApiError, fromZodError } = require('../lib/api-error');
const { episodeListQuerySchema, paginationSchema } = require('../validation/experiment.schemas');
const { episodeAccessWhere, experimentAccessWhere } = require('../services/research-access.service');
const { transitionEpisode } = require('../services/episode-lifecycle.service');
const { episodeToDto, eventToDto } = require('../serializers/research.serializer');

const eventListQuerySchema = paginationSchema.extend({
  attempt: z.coerce.number().finite().int().min(1).optional(),
});

const parseWith = (schema, input, message) => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw fromZodError(parsed.error, message);
  return parsed.data;
};

const findAccessibleEpisode = async (client, req, include = {}) => {
  const episode = await client.episode.findFirst({
    where: episodeAccessWhere(req.user, req.params.episodeId),
    include,
  });
  if (!episode) {
    throw new ApiError(404, 'EPISODE_NOT_FOUND', 'Episode was not found');
  }
  return episode;
};

const listEpisodes = async (req, res) => {
  const query = parseWith(episodeListQuerySchema, req.query, 'Episode list query is invalid');
  const experiment = await prisma.experiment.findFirst({
    where: experimentAccessWhere(req.user, req.params.experimentId),
    select: { id: true },
  });
  if (!experiment) {
    throw new ApiError(404, 'EXPERIMENT_NOT_FOUND', 'Experiment was not found');
  }

  const where = {
    experimentId: experiment.id,
    ...(query.status ? { status: query.status } : {}),
  };
  const skip = (query.page - 1) * query.limit;
  const [total, episodes] = await Promise.all([
    prisma.episode.count({ where }),
    prisma.episode.findMany({
      where,
      include: { policy: true },
      orderBy: [{ episodeIndex: 'asc' }, { id: 'asc' }],
      skip,
      take: query.limit,
    }),
  ]);

  res.json({
    success: true,
    data: episodes.map(episodeToDto),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
};

const getEpisode = async (req, res) => {
  const episode = await findAccessibleEpisode(prisma, req, { policy: true });
  res.json({ success: true, data: episodeToDto(episode) });
};

const listEpisodeEvents = async ({ req, res, model, whereForAttempt, include, orderBy }) => {
  const query = parseWith(eventListQuerySchema, req.query, 'Episode event list query is invalid');
  const episode = await findAccessibleEpisode(prisma, req);
  const attempt = query.attempt ?? episode.attempt;
  if (attempt > episode.attempt) {
    throw new ApiError(404, 'EPISODE_ATTEMPT_NOT_FOUND', 'Episode attempt was not found');
  }

  const where = whereForAttempt(episode.id, attempt);
  const skip = (query.page - 1) * query.limit;
  const [total, events] = await Promise.all([
    model.count({ where }),
    model.findMany({ where, include, orderBy, skip, take: query.limit }),
  ]);

  res.json({
    success: true,
    data: events.map(eventToDto),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
      attempt,
    },
  });
};

const listObservations = (req, res) => listEpisodeEvents({
  req,
  res,
  model: prisma.fleetObservation,
  whereForAttempt: (episodeId, attempt) => ({ episodeId, attempt }),
  orderBy: [{ step: 'asc' }, { id: 'asc' }],
});

const listRecommendations = (req, res) => listEpisodeEvents({
  req,
  res,
  model: prisma.policyRecommendation,
  whereForAttempt: (episodeId, attempt) => ({ observation: { episodeId, attempt } }),
  include: { observation: { select: { attempt: true, step: true } } },
  orderBy: [{ observation: { step: 'asc' } }, { id: 'asc' }],
});

const listResults = (req, res) => listEpisodeEvents({
  req,
  res,
  model: prisma.stepResult,
  whereForAttempt: (episodeId, attempt) => ({ observation: { episodeId, attempt } }),
  include: { observation: { select: { attempt: true, step: true } } },
  orderBy: [{ observation: { step: 'asc' } }, { id: 'asc' }],
});

const getSummary = async (req, res) => {
  const query = parseWith(
    z.object({ attempt: z.coerce.number().finite().int().min(1).optional() }).strict(),
    req.query,
    'Episode summary query is invalid',
  );
  const episode = await findAccessibleEpisode(prisma, req);
  const attempt = query.attempt ?? episode.attempt;
  if (attempt > episode.attempt) {
    throw new ApiError(404, 'EPISODE_ATTEMPT_NOT_FOUND', 'Episode attempt was not found');
  }

  const summary = await prisma.episodeSummary.findUnique({
    where: { episodeId_attempt: { episodeId: episode.id, attempt } },
  });
  if (!summary) {
    throw new ApiError(
      409,
      'SUMMARY_NOT_AVAILABLE',
      'The worker has not persisted a summary for this episode attempt',
    );
  }

  res.json({
    success: true,
    data: {
      id: summary.id,
      attempt: summary.attempt,
      payload: summary.payloadJson,
      createdAt: summary.createdAt,
    },
  });
};

const retryEpisode = async (req, res) => {
  const episode = await prisma.$transaction(async (tx) => {
    const current = await findAccessibleEpisode(tx, req);
    if (current.status !== 'FAILED') {
      throw new ApiError(
        409,
        'INVALID_EPISODE_TRANSITION',
        `Episode is ${current.status}; expected FAILED`,
      );
    }

    const updated = await transitionEpisode({
      client: tx,
      episodeId: current.id,
      from: 'FAILED',
      to: 'PENDING',
    });
    await tx.auditLog.create({
      data: {
        entityType: 'EPISODE',
        entityId: current.id,
        action: 'EPISODE_RETRY',
        actorUserId: req.user.id,
        payloadJson: { previousAttempt: current.attempt, attempt: updated.attempt },
      },
    });
    return updated;
  });

  res.status(202).json({ success: true, data: episodeToDto(episode) });
};

const cancelEpisode = async (req, res) => {
  const episode = await prisma.$transaction(async (tx) => {
    const current = await findAccessibleEpisode(tx, req);
    if (current.status === 'RUNNING') {
      // Keep this explicit until the worker exposes cooperative cancellation.
      await transitionEpisode({
        client: tx,
        episodeId: current.id,
        from: 'RUNNING',
        to: 'CANCELLED',
      });
    }
    if (current.status !== 'PENDING') {
      throw new ApiError(
        409,
        'INVALID_EPISODE_TRANSITION',
        `Episode is ${current.status}; expected PENDING`,
      );
    }

    const updated = await transitionEpisode({
      client: tx,
      episodeId: current.id,
      from: 'PENDING',
      to: 'CANCELLED',
    });
    await tx.auditLog.create({
      data: {
        entityType: 'EPISODE',
        entityId: current.id,
        action: 'EPISODE_CANCEL',
        actorUserId: req.user.id,
        payloadJson: { attempt: current.attempt, previousStatus: current.status },
      },
    });
    return updated;
  });

  res.json({ success: true, data: episodeToDto(episode) });
};

module.exports = {
  cancelEpisode,
  getEpisode,
  getSummary,
  listEpisodes,
  listObservations,
  listRecommendations,
  listResults,
  retryEpisode,
};
