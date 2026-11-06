const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { extract, PATHS } = require('../scripts/export-operations-http-contract');
const api = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '../openapi.yaml'), 'utf8'));
const domain = require('../../contracts/v3/operations-domain.schema.json').$defs;
const examples = require('../examples/operations-overview.json');
const schemas = api.components.schemas;
function validate(value, schema) {
  if (schema.$ref) return validate(value, schemas[schema.$ref.split('/').at(-1)]);
  if (schema.anyOf) { expect(schema.anyOf.some(s => { try { validate(value, s); return true; } catch { return false; } })).toBe(true); return; }
  if (schema.const !== undefined) expect(value).toEqual(schema.const);
  if (schema.enum) expect(schema.enum).toContain(value);
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null) { expect(types).toContain('null'); return; }
  if (types.includes('object')) {
    expect(typeof value).toBe('object');
    for (const k of schema.required || []) expect(value).toHaveProperty(k);
    if (schema.additionalProperties === false) expect(Object.keys(value).every(k => Object.hasOwn(schema.properties, k))).toBe(true);
    for (const [k, v] of Object.entries(value)) if (schema.properties[k]) validate(v, schema.properties[k]);
  } else if (types.includes('array')) {
    expect(Array.isArray(value)).toBe(true); if (schema.maxItems !== undefined) expect(value.length).toBeLessThanOrEqual(schema.maxItems);
    for (const v of value) validate(v, schema.items);
  } else if (types.includes('integer')) { expect(Number.isInteger(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(schema.minimum ?? -Infinity); }
  else if (schema.type) expect(types).toContain(typeof value);
}
test('overview examples satisfy strict DTO including reused sanitized preview item', () => {
  validate(examples.populated, schemas.OperationsOverviewResponse);
  validate(examples.unpublished_missing_health, schemas.OperationsOverviewResponse);
  validate(examples.unavailable, schemas.OperationsErrorResponse);
  expect(api.paths['/operations/overview'].get.responses[200].content['application/json'].examples.populated.value).toEqual(examples.populated);
});
test('overview buckets reuse canonical vocabularies and exporter includes additive path', () => {
  const props = schemas.OperationsOverview.properties;
  expect(Object.keys(props.machines.properties.by_status.properties)).toEqual(domain.MachineStatus.enum);
  expect(Object.keys(props.cases.properties.LIVE.properties.by_status.properties)).toEqual(domain.DecisionCaseStatus.enum);
  expect(props.review_preview.properties.items.items.$ref).toBe('#/components/schemas/DecisionCaseListItem');
  expect(PATHS).toContain('/operations/overview');
  expect(extract(api).paths['/operations/overview']).toEqual(api.paths['/operations/overview']);
  expect(api.paths['/operations/overview'].get.parameters.map(p => p.name)).toEqual(['factory_id']);
  for (const status of [400, 401, 403, 404, 500, 503]) expect(api.paths['/operations/overview'].get.responses[status].content['application/json'].schema.$ref).toBe('#/components/schemas/OperationsErrorResponse');
});
