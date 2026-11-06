const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { extract } = require('../scripts/export-operations-http-contract');
const api = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '../openapi.yaml'), 'utf8'));
const draft = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '../docs/incidents.openapi.yaml'), 'utf8'));
test('all reviewed Incident paths are in the authoritative exported HTTP contract', () => {
  const exported = extract(api);
  for (const endpoint of Object.keys(draft.paths)) {
    expect(exported.paths).toHaveProperty(endpoint);
    expect(Object.keys(api.paths[endpoint])).toEqual(Object.keys(draft.paths[endpoint]));
  }
});
test('incident components are namespaced without replacing other modules', () => {
  for (const group of ['schemas', 'parameters', 'responses']) {
    for (const name of Object.keys(draft.components[group])) {
      expect(api.components[group]).toHaveProperty(name.startsWith('Incident') ? name : 'Incident' + name);
    }
  }
  expect(api.components.schemas.WorkOrderSummary).toBeDefined();
  expect(api.paths['/decision-cases']).toBeDefined();
  expect(api.paths['/work-orders']).toBeDefined();
});
test('linked Work Orders reference the producer summary, not a competing shape', () => {
  expect(api.components.schemas.IncidentEnvelope.properties.data.properties.work_orders.items)
    .toEqual({ $ref: '#/components/schemas/WorkOrderSummary' });
});
