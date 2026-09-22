const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const api = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '../openapi.yaml'), 'utf8'));
const canonical = require('../../contracts/v3/operations-domain.schema.json');

test('Operations OpenAPI uses canonical schemas without changing Schedule wire shape', () => {
  for (const [name, schema] of Object.entries(api.components.schemas)) {
    if (!name.startsWith('Operations') || name === 'OperationsReadMeta') continue;
    const local = JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/Operations', '#/$defs/'));
    expect(local).toEqual(canonical.$defs[name.slice('Operations'.length)]);
  }
  expect(api.components.schemas.OperationsSchedule.properties).not.toHaveProperty('schema_version');
  for (const route of ['/operations/snapshot', '/schedules/current']) {
    expect(api.paths[route].get.parameters[0]).toMatchObject({ name: 'factory_id', required: true });
    expect(api.paths[route].get.responses['404'].content['application/json'].schema.$ref).toBe('#/components/schemas/OperationsErrorResponse');
  }
});
