const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { extract, PATHS } = require('../scripts/export-operations-http-contract');
const api = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '../openapi.yaml'), 'utf8'));
const baseline = require('../../contracts/v3/operations-http.openapi.json');

test('frozen HTTP contract contains all Operations routes and their complete reference closure', () => {
  expect(extract(api)).toEqual(baseline);
  expect(Object.keys(baseline.paths).sort()).toEqual(PATHS.slice().sort());
  expect(Object.values(baseline.paths).reduce((count, item) => count + Object.keys(item).length, 0)).toBe(44);
  expect(baseline.components.securitySchemes).toHaveProperty('cookieAuth');
  expect(baseline.components.securitySchemes).toHaveProperty('bearerAuth');
});
test('fails closed if an endpoint or referenced schema is removed', () => {
  const missingPath = structuredClone(api);
  delete missingPath.paths['/decision-cases/{id}/decision'];
  expect(() => extract(missingPath)).toThrow('Missing P0 endpoint');
  const missingSchema = structuredClone(api);
  delete missingSchema.components.schemas.DecisionCommandRequest;
  expect(() => extract(missingSchema)).toThrow('Unresolved contract reference');
});
test('research API changes do not alter the Operations baseline', () => {
  const changed = structuredClone(api);
  changed.paths['/experiments'] = { get: { description: 'Unrelated research change' } };
  expect(extract(changed)).toEqual(baseline);
});
