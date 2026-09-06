const IDS = {
  owner: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  admin: '33333333-3333-4333-8333-333333333333',
  viewer: '44444444-4444-4444-8444-444444444444',
  policy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

const state = {};
let sequence = 1;

const nextId = () => {
  const suffix = String(sequence).padStart(12, '0');
  sequence += 1;
  return `00000000-0000-4000-8000-${suffix}`;
};

const reset = () => {
  sequence = 1;
  state.users = [
    { id: IDS.owner, username: 'owner', role: 'ENGINEER', active: true },
    { id: IDS.other, username: 'other', role: 'OPERATOR', active: true },
    { id: IDS.admin, username: 'admin', role: 'ADMIN', active: true },
    { id: IDS.viewer, username: 'viewer', role: 'VIEWER', active: true },
  ];
  state.policies = [{
    id: IDS.policy,
    policyKey: 'fixed-schedule',
    version: '1.0.0',
    name: 'Fixed Schedule Baseline',
    description: 'Test policy',
    active: true,
    configJson: { strategy: 'FIXED_SCHEDULE' },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }];
  state.experiments = [];
  state.episodes = [];
  state.auditLogs = [];
  state.observations = [];
  state.recommendations = [];
  state.results = [];
  state.summaries = [];
};

const matchExperiment = (experiment, where = {}) => {
  if (where.id !== undefined && experiment.id !== where.id) return false;
  if (where.createdById !== undefined && experiment.createdById !== where.createdById) return false;
  if (where.status !== undefined && experiment.status !== where.status) return false;
  if (where.runIdempotencyKey !== undefined
    && experiment.runIdempotencyKey !== where.runIdempotencyKey) return false;
  return true;
};

const experimentWithIncludes = (experiment, include = {}) => {
  if (!experiment) return null;
  const result = { ...experiment };
  if (include.policy) {
    result.policy = state.policies.find((policy) => policy.id === experiment.policyId) || null;
  }
  if (include._count) {
    result._count = {
      episodes: state.episodes.filter((episode) => episode.experimentId === experiment.id).length,
    };
  }
  return result;
};

const matchEpisode = (episode, where = {}) => {
  if (where.id !== undefined && episode.id !== where.id) return false;
  if (where.experimentId !== undefined && episode.experimentId !== where.experimentId) return false;
  if (where.status !== undefined && episode.status !== where.status) return false;
  if (where.experiment) {
    const experiment = state.experiments.find((item) => item.id === episode.experimentId);
    if (!experiment || !matchExperiment(experiment, where.experiment)) return false;
  }
  return true;
};

const episodeWithIncludes = (episode, include = {}) => {
  if (!episode) return null;
  const result = { ...episode };
  if (include.policy) {
    result.policy = state.policies.find((policy) => policy.id === episode.policyId) || null;
  }
  return result;
};

const applyEpisodeData = (episode, data) => {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && Object.hasOwn(value, 'increment')) {
      episode[key] += value.increment;
    } else {
      episode[key] = value;
    }
  }
  episode.updatedAt = new Date();
};

const observationFor = (observationId) => (
  state.observations.find((observation) => observation.id === observationId)
);

const matchObservationAttempt = (observation, where) => (
  (!where.episodeId || observation.episodeId === where.episodeId)
  && (!where.attempt || observation.attempt === where.attempt)
);

const matchDerivedEvent = (event, where) => {
  const observation = observationFor(event.observationId);
  return Boolean(observation && matchObservationAttempt(observation, where.observation || {}));
};

const page = (items, args = {}) => items.slice(args.skip || 0, (args.skip || 0) + (args.take ?? items.length));

const mockPrisma = {
  __ids: IDS,
  __state: state,
  __reset: reset,
  user: {
    findUnique: jest.fn(async ({ where }) => (
      state.users.find((user) => (
        (where.id && user.id === where.id) || (where.username && user.username === where.username)
      )) || null
    )),
  },
  policy: {
    findMany: jest.fn(async ({ where = {} } = {}) => state.policies
      .filter((policy) => where.active === undefined || policy.active === where.active)
      .sort((left, right) => (
        left.policyKey.localeCompare(right.policyKey)
        || left.version.localeCompare(right.version)
        || left.id.localeCompare(right.id)
      ))),
    findUnique: jest.fn(async ({ where }) => {
      const compound = where.policyKey_version;
      return state.policies.find((policy) => (
        policy.policyKey === compound.policyKey && policy.version === compound.version
      )) || null;
    }),
    findFirst: jest.fn(async ({ where }) => state.policies.find((policy) => (
      (!where.policyKey || policy.policyKey === where.policyKey)
      && (where.active === undefined || policy.active === where.active)
    )) || null),
  },
  experiment: {
    create: jest.fn(async ({ data, include = {} }) => {
      const now = new Date();
      const experiment = {
        id: nextId(),
        schemaVersion: '2.0',
        runIdempotencyKey: null,
        runRequestedAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      state.experiments.push(experiment);
      return experimentWithIncludes(experiment, include);
    }),
    count: jest.fn(async ({ where = {} } = {}) => state.experiments.filter((item) => (
      matchExperiment(item, where)
    )).length),
    findMany: jest.fn(async (args = {}) => {
      const items = state.experiments
        .filter((item) => matchExperiment(item, args.where || {}))
        .sort((left, right) => (
          right.createdAt - left.createdAt || right.id.localeCompare(left.id)
        ))
        .map((item) => experimentWithIncludes(item, args.include));
      return page(items, args);
    }),
    findFirst: jest.fn(async ({ where = {}, include = {}, select } = {}) => {
      const item = state.experiments.find((experiment) => matchExperiment(experiment, where));
      if (!item) return null;
      if (select) return Object.fromEntries(Object.keys(select).map((key) => [key, item[key]]));
      return experimentWithIncludes(item, include);
    }),
    findUnique: jest.fn(async ({ where, include = {} }) => experimentWithIncludes(
      state.experiments.find((item) => item.id === where.id),
      include,
    )),
    updateMany: jest.fn(async ({ where, data }) => {
      const matches = state.experiments.filter((item) => matchExperiment(item, where));
      for (const item of matches) Object.assign(item, data, { updatedAt: new Date() });
      return { count: matches.length };
    }),
  },
  episode: {
    createMany: jest.fn(async ({ data }) => {
      const now = new Date();
      for (const row of data) {
        state.episodes.push({
          id: nextId(),
          stepsCompleted: 0,
          totalCost: null,
          failureCount: null,
          replacementCount: null,
          waitingSteps: null,
          startedAt: null,
          completedAt: null,
          failedAt: null,
          cancelledAt: null,
          errorCode: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
          ...row,
        });
      }
      return { count: data.length };
    }),
    count: jest.fn(async ({ where = {} } = {}) => state.episodes.filter((item) => (
      matchEpisode(item, where)
    )).length),
    findMany: jest.fn(async (args = {}) => {
      const items = state.episodes
        .filter((item) => matchEpisode(item, args.where || {}))
        .sort((left, right) => (
          left.episodeIndex - right.episodeIndex || left.id.localeCompare(right.id)
        ))
        .map((item) => episodeWithIncludes(item, args.include));
      return page(items, args);
    }),
    findFirst: jest.fn(async ({ where = {}, include = {} }) => episodeWithIncludes(
      state.episodes.find((item) => matchEpisode(item, where)),
      include,
    )),
    findUnique: jest.fn(async ({ where, include = {}, select }) => {
      const item = state.episodes.find((episode) => episode.id === where.id);
      if (!item) return null;
      if (select) return Object.fromEntries(Object.keys(select).map((key) => [key, item[key]]));
      return episodeWithIncludes(item, include);
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const matches = state.episodes.filter((item) => matchEpisode(item, where));
      for (const item of matches) applyEpisodeData(item, data);
      return { count: matches.length };
    }),
  },
  auditLog: {
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId(), createdAt: new Date(), ...data };
      state.auditLogs.push(row);
      return row;
    }),
  },
  fleetObservation: {
    count: jest.fn(async ({ where }) => state.observations.filter((item) => (
      matchObservationAttempt(item, where)
    )).length),
    findMany: jest.fn(async (args) => page(state.observations
      .filter((item) => matchObservationAttempt(item, args.where))
      .sort((left, right) => left.step - right.step || left.id.localeCompare(right.id)), args)),
  },
  policyRecommendation: {
    count: jest.fn(async ({ where }) => state.recommendations.filter((item) => (
      matchDerivedEvent(item, where)
    )).length),
    findMany: jest.fn(async (args) => page(state.recommendations
      .filter((item) => matchDerivedEvent(item, args.where))
      .map((item) => ({ ...item, observation: observationFor(item.observationId) }))
      .sort((left, right) => left.observation.step - right.observation.step), args)),
  },
  stepResult: {
    count: jest.fn(async ({ where }) => state.results.filter((item) => (
      matchDerivedEvent(item, where)
    )).length),
    findMany: jest.fn(async (args) => page(state.results
      .filter((item) => matchDerivedEvent(item, args.where))
      .map((item) => ({ ...item, observation: observationFor(item.observationId) }))
      .sort((left, right) => left.observation.step - right.observation.step), args)),
  },
  episodeSummary: {
    findUnique: jest.fn(async ({ where }) => {
      const key = where.episodeId_attempt;
      return state.summaries.find((summary) => (
        summary.episodeId === key.episodeId && summary.attempt === key.attempt
      )) || null;
    }),
  },
};

mockPrisma.$transaction = jest.fn(async (operation) => {
  if (typeof operation === 'function') return operation(mockPrisma);
  return Promise.all(operation);
});

reset();

module.exports = mockPrisma;
