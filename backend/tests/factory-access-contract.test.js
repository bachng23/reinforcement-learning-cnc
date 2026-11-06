const fs = require('fs'),
  path = require('path'),
  yaml = require('js-yaml');
const { spawnSync } = require('child_process');
const api = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '../openapi.yaml'), 'utf8'));
const examples = require('../examples/factory-access.json');
test('factory registry DTO and example keys are frozen and HTTP export includes every new operation', () => {
  const s = api.components.schemas;
  expect(Object.keys(examples.factory.data).sort()).toEqual(s.FactoryDto.required.slice().sort());
  expect(Object.keys(examples.grant.data.membership).sort()).toEqual(
    s.FactoryMemberDto.required.slice().sort(),
  );
  expect(s.FactoryMemberDto.properties.user.properties).not.toHaveProperty('role');
  for (const p of [
    '/factories',
    '/factories/{factory_id}',
    '/factories/{factory_id}/members',
    '/factories/{factory_id}/members/{user_id}',
  ]) {
    expect(require('../scripts/export-operations-http-contract').PATHS).toContain(p);
    for (const op of Object.values(api.paths[p]))
      expect(op.responses[503].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/FactoryApiError',
      );
  }
  expect(s.FactoryRenameRequest.required).toEqual(['name']);
  expect(s.FactoryCreateRequest.additionalProperties).toBe(false);
});
test.each([
  { FACTORY_ACCESS_SOURCE: 'invalid' },
  { FACTORY_ACCESS_SOURCE: 'environment', OPERATIONS_FACTORY_ACCESS: '[]' },
  { FACTORY_ACCESS_SOURCE: 'environment', OPERATIONS_FACTORY_ACCESS: '' },
  { FACTORY_ACCESS_SOURCE: 'environment', OPERATIONS_FACTORY_ACCESS: '{"f":["not-uuid"]}' },
])('startup configuration fails closed %j', (env) => {
  const r = spawnSync(
    process.execPath,
    ['-e', "require('./src/services/factory-access.service').validateAccessConfiguration()"],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, ...env }, encoding: 'utf8' },
  );
  expect(r.status).not.toBe(0);
});
test('database mode never parses malformed legacy environment', () => {
  const r = spawnSync(
    process.execPath,
    ['-e', "require('./src/services/factory-access.service').validateAccessConfiguration()"],
    {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, FACTORY_ACCESS_SOURCE: 'database', OPERATIONS_FACTORY_ACCESS: 'not-json' },
      encoding: 'utf8',
    },
  );
  expect(r.status).toBe(0);
});
