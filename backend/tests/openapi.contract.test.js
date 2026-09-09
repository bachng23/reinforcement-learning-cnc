const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const {
  episodeToDto,
  eventToDto,
  experimentSummaryToDto,
  experimentToDto,
  policyToDto,
  queuedEpisodeToDto,
} = require('../src/serializers/research.serializer');

const document = yaml.safeLoad(fs.readFileSync(
  path.resolve(__dirname, '../openapi.yaml'),
  'utf8',
));
const schemas = document.components.schemas;

const dereference = (reference) => schemas[reference.split('/').at(-1)];
const requiredProperties = (schema) => {
  const required = new Set(schema.required || []);
  for (const branch of schema.allOf || []) {
    const resolved = branch.$ref ? dereference(branch.$ref) : branch;
    for (const property of requiredProperties(resolved)) required.add(property);
  }
  return [...required].sort();
};
const serializedKeys = (value) => Object.keys(JSON.parse(JSON.stringify(value))).sort();

const now = new Date('2026-09-09T00:00:00.000Z');
const policy = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  policyKey: 'integration-policy',
  version: '1.0.0',
  name: 'Integration policy',
  description: null,
  configJson: { strategy: 'INTEGRATION_TEST' },
};
const experiment = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  experimentKey: 'experiment:contract-test',
  name: 'Contract test',
  description: null,
  schemaVersion: '2.0',
  status: 'READY',
  episodeCount: 1,
  policy,
  environmentConfig: { schema_version: '2.0' },
  createdById: null,
  runRequestedAt: null,
  createdAt: now,
  updatedAt: now,
};
const episode = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  episodeKey: 'experiment:contract-test:episode:0',
  experimentId: experiment.id,
  episodeIndex: 0,
  policyId: policy.id,
  seed: 42,
  status: 'PENDING',
  attempt: 1,
  stepsCompleted: 0,
  totalCost: null,
  failureCount: null,
  replacementCount: null,
  waitingSteps: null,
  queuedAt: now,
  startedAt: null,
  completedAt: null,
  failedAt: null,
  cancelledAt: null,
  errorCode: null,
  errorMessage: null,
  createdAt: now,
  updatedAt: now,
};

describe('OpenAPI and Product API serializers', () => {
  test('uses the backend local port', () => {
    expect(document.servers[0].url).toBe('http://localhost:5000/api/v1');
  });

  test.each([
    ['Policy', policyToDto(policy)],
    ['ExperimentSummary', experimentSummaryToDto(experiment)],
    ['Experiment', experimentToDto(experiment)],
    ['Episode', episodeToDto(episode)],
    ['QueuedEpisode', queuedEpisodeToDto(episode)],
  ])('%s requires every field emitted by its serializer', (schemaName, dto) => {
    expect(serializedKeys(dto)).toEqual(requiredProperties(schemas[schemaName]));
  });

  test.each([
    ['ObservationRecord', {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      observationKey: 'observation:1',
      attempt: 1,
      step: 0,
      schemaVersion: '2.0',
      payloadJson: { schema_version: '2.0' },
      createdAt: now,
    }],
    ['RecommendationRecord', {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      observationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      policyId: policy.id,
      schemaVersion: '2.0',
      payloadJson: { schema_version: '2.0' },
      createdAt: now,
      observation: { attempt: 1, step: 0 },
    }],
    ['StepResultRecord', {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      observationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      schemaVersion: '2.0',
      totalCost: 0,
      episodeTerminated: false,
      payloadJson: { schema_version: '2.0' },
      createdAt: now,
      observation: { attempt: 1, step: 0 },
    }],
  ])('%s matches the shared event serializer exactly', (schemaName, event) => {
    expect(serializedKeys(eventToDto(event))).toEqual(requiredProperties(schemas[schemaName]));
  });

  test('documents attempt only on event pagination metadata', () => {
    expect(requiredProperties(schemas.PaginationMeta)).not.toContain('attempt');
    expect(requiredProperties(schemas.EventPaginationMeta)).toContain('attempt');
  });
});
