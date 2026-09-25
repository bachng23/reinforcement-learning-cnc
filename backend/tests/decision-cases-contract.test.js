const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const api = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '../openapi.yaml'), 'utf8'));
const defs = require('../../contracts/v3/operations-domain.schema.json').$defs;
test('decision status is exactly the generated contract; all referenced schemas resolve', () => {
  for (const [name, value] of Object.entries(api.components.schemas)) {
    if (name.startsWith('CaseContract')) {
      const original = JSON.parse(JSON.stringify(value).replaceAll('#/components/schemas/CaseContract', '#/$defs/'));
      expect(original).toEqual(defs[name.slice('CaseContract'.length)]);
    }
  }
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref?.startsWith('#/')) {
      expect(value.$ref.slice(2).split('/').reduce((parent, key) => parent?.[key], api)).toBeDefined();
    }
    Object.values(value).forEach(visit);
  };
  visit(api);
});
test('recommendation read uses canonical package and snapshot without changing status DTO', () => {
  const get = api.paths['/decision-cases/{id}/recommendation'].get;
  const properties = get.responses[200].content['application/json'].schema.properties.data.properties;
  expect(properties.recommendation.$ref).toBe('#/components/schemas/CaseContractRecommendationPackage');
  expect(properties.snapshot.$ref).toBe('#/components/schemas/OperationsFactorySnapshot');
  expect(get.responses[404].description).toContain('RECOMMENDATION_NOT_READY');
  expect(api.components.schemas.DecisionCaseResponse.properties.data.$ref).toBe('#/components/schemas/CaseContractDecisionCaseStatusResponse');
  expect(api.components.schemas.DecisionCaseResponse.properties.meta.properties.processing.properties).not.toHaveProperty('lease_token');
});
test('creation is strict, requires idempotency and documents 202/409; event cursor is bounded', () => {
  const post = api.paths['/decision-cases'].post;
  expect(post.parameters[0]).toMatchObject({ name: 'Idempotency-Key', required: true });
  expect(post.responses[202].headers).toHaveProperty('Location');
  expect(post.responses[202].headers).toHaveProperty('Idempotency-Replayed');
  expect(post.responses).toHaveProperty('409');
  const body = api.components.schemas.DecisionCaseCreateRequest;
  expect(body.additionalProperties).toBe(false);
  expect(body.properties.request.additionalProperties).toBe(false);
  for (const trigger of body.properties.request.properties.trigger.oneOf) {
    for (const key of ['event_id', 'occurred_at', 'requested_by_user_id']) expect(trigger.properties).not.toHaveProperty(key);
  }
  const params = api.paths['/decision-cases/{id}/events'].get.parameters;
  expect(params.find(p => p.name === 'limit').schema).toMatchObject({ default: 100, maximum: 200 });
  expect(params.find(p => p.name === 'after_sequence').schema).toMatchObject({ default: 0, minimum: 0 });
});
