const { createHash, randomUUID } = require('node:crypto');
const prisma = require('../config/prisma');
const { ApiError, fromZodError } = require('../lib/api-error');
const {
  createExperimentSchema,
  experimentListQuerySchema,
  idempotencyKeySchema,
} = require('../validation/experiment.schemas');
const { experimentAccessWhere, isResearchAdmin } = require('../services/research-access.service');
const {
  experimentSummaryToDto,
  experimentToDto,
  queuedEpisodeToDto,
} = require('../serializers/research.serializer');

const POLICY_INCLUDE = true;

const parseWith = (schema, input, message) => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw fromZodError(parsed.error, message);
  return parsed.data;
};

const findAvailablePolicy = async (policyKey, policyVersion) => {
  const policy = await prisma.policy.findUnique({
    where: {
      policyKey_version: { policyKey, version: policyVersion },
    },
  });

  if (policy?.active) return policy;
  if (policy && !policy.active) {
    throw new ApiError(409, 'POLICY_INACTIVE', 'The selected policy version is not available');
  }

  const policyKeyExists = await prisma.policy.findFirst({
    where: { policyKey, active: true },
    select: { id: true },
  });
  if (policyKeyExists) {
    throw new ApiError(404, 'POLICY_VERSION_NOT_FOUND', 'The selected policy version was not found');
  }
  throw new ApiError(404, 'POLICY_NOT_FOUND', 'The selected policy was not found');
};

const createExperiment = async (req, res) => {
  const input = parseWith(createExperimentSchema, req.body, 'Experiment request is invalid');
  const policy = await findAvailablePolicy(input.policyKey, input.policyVersion);
  const experimentKey = `experiment:${randomUUID()}`;

  const experiment = await prisma.$transaction(async (tx) => {
    const created = await tx.experiment.create({
      data: {
        experimentKey,
        name: input.name,
        description: input.description ?? null,
        schemaVersion: input.environmentConfig.schema_version,
        status: 'READY',
        environmentConfig: input.environmentConfig,
        episodeCount: input.episodeCount,
        policyId: policy.id,
        createdById: req.user.id,
      },
      include: { policy: POLICY_INCLUDE },
    });

    await tx.auditLog.create({
      data: {
        entityType: 'EXPERIMENT',
        entityId: created.id,
        action: 'EXPERIMENT_CREATE',
        actorUserId: req.user.id,
        payloadJson: {
          experimentKey: created.experimentKey,
          policyKey: policy.policyKey,
          policyVersion: policy.version,
          episodeCount: created.episodeCount,
          schemaVersion: created.schemaVersion,
        },
      },
    });

    return created;
  });

  res.status(201).json({ success: true, data: experimentToDto(experiment) });
};

const listExperiments = async (req, res) => {
  const query = parseWith(
    experimentListQuerySchema,
    req.query,
    'Experiment list query is invalid',
  );
  const where = {
    ...(isResearchAdmin(req.user) ? {} : { createdById: req.user.id }),
    ...(query.status ? { status: query.status } : {}),
  };
  const skip = (query.page - 1) * query.limit;

  const [total, experiments] = await Promise.all([
    prisma.experiment.count({ where }),
    prisma.experiment.findMany({
      where,
      include: { policy: POLICY_INCLUDE },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: query.limit,
    }),
  ]);

  res.json({
    success: true,
    data: experiments.map(experimentSummaryToDto),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  });
};

const getExperiment = async (req, res) => {
  const experiment = await prisma.experiment.findFirst({
    where: experimentAccessWhere(req.user, req.params.experimentId),
    include: {
      policy: POLICY_INCLUDE,
      _count: { select: { episodes: true } },
    },
  });
  if (!experiment) {
    throw new ApiError(404, 'EXPERIMENT_NOT_FOUND', 'Experiment was not found');
  }

  res.json({
    success: true,
    data: {
      ...experimentToDto(experiment),
      episodesCreated: experiment._count.episodes,
    },
  });
};

const replayOrRejectRun = async (tx, experiment, idempotencyKey) => {
  if (!experiment.runIdempotencyKey) return null;
  if (experiment.runIdempotencyKey !== idempotencyKey) {
    throw new ApiError(
      409,
      'EXPERIMENT_ALREADY_RUN',
      'The experiment has already been run with a different idempotency key',
    );
  }

  const episodes = await tx.episode.findMany({
    where: { experimentId: experiment.id },
    orderBy: [{ episodeIndex: 'asc' }, { id: 'asc' }],
  });
  return { experiment, episodes, replayed: true };
};

const runExperiment = async (req, res) => {
  const idempotencyHeader = req.get('Idempotency-Key');
  if (!idempotencyHeader) {
    throw new ApiError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key header is required',
    );
  }
  const idempotencyKey = parseWith(
    idempotencyKeySchema,
    idempotencyHeader,
    'Idempotency-Key header is invalid',
  );
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    let experiment = await tx.experiment.findFirst({
      where: experimentAccessWhere(req.user, req.params.experimentId),
      include: { policy: POLICY_INCLUDE },
    });
    if (!experiment) {
      throw new ApiError(404, 'EXPERIMENT_NOT_FOUND', 'Experiment was not found');
    }

    const priorRun = await replayOrRejectRun(tx, experiment, idempotencyKey);
    if (priorRun) return priorRun;

    if (experiment.status !== 'READY') {
      throw new ApiError(
        409,
        'INVALID_EXPERIMENT_STATE',
        `Experiment is ${experiment.status}; expected READY`,
      );
    }

    const claimed = await tx.experiment.updateMany({
      where: {
        id: experiment.id,
        status: 'READY',
        runIdempotencyKey: null,
      },
      data: {
        status: 'RUNNING',
        runIdempotencyKey: idempotencyKey,
        runRequestedAt: now,
      },
    });

    if (claimed.count !== 1) {
      experiment = await tx.experiment.findUnique({
        where: { id: experiment.id },
        include: { policy: POLICY_INCLUDE },
      });
      const concurrentRun = await replayOrRejectRun(tx, experiment, idempotencyKey);
      if (concurrentRun) return concurrentRun;
      throw new ApiError(409, 'EXPERIMENT_ALREADY_RUN', 'The experiment has already been run');
    }

    const baseSeed = experiment.environmentConfig.seed;
    const episodeRows = Array.from({ length: experiment.episodeCount }, (_, episodeIndex) => ({
      episodeKey: `${experiment.experimentKey}:episode:${episodeIndex}`,
      experimentId: experiment.id,
      policyId: experiment.policyId,
      episodeIndex,
      seed: baseSeed + episodeIndex,
      status: 'PENDING',
      attempt: 1,
      queuedAt: now,
    }));
    await tx.episode.createMany({ data: episodeRows });

    await tx.auditLog.create({
      data: {
        entityType: 'EXPERIMENT',
        entityId: experiment.id,
        action: 'EXPERIMENT_RUN',
        actorUserId: req.user.id,
        payloadJson: {
          episodeCount: experiment.episodeCount,
          firstSeed: baseSeed,
          lastSeed: baseSeed + experiment.episodeCount - 1,
          idempotencyKeySha256: createHash('sha256').update(idempotencyKey).digest('hex'),
        },
      },
    });

    const episodes = await tx.episode.findMany({
      where: { experimentId: experiment.id },
      orderBy: [{ episodeIndex: 'asc' }, { id: 'asc' }],
    });
    return {
      experiment: { ...experiment, status: 'RUNNING', runRequestedAt: now },
      episodes,
      replayed: false,
    };
  });

  if (result.replayed) res.set('Idempotency-Replayed', 'true');
  res.status(202).json({
    success: true,
    data: {
      experimentId: result.experiment.id,
      status: result.experiment.status,
      episodeCount: result.episodes.length,
      episodes: result.episodes.map(queuedEpisodeToDto),
    },
  });
};

module.exports = {
  createExperiment,
  getExperiment,
  listExperiments,
  runExperiment,
};
