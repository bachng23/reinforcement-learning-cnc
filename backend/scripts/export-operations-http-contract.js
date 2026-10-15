const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../..');
const PATHS = [
  '/operations/snapshot', '/schedules/current', '/decision-cases',
  '/decision-cases/{id}', '/decision-cases/{id}/recommendation',
  '/decision-cases/{id}/events', '/decision-cases/{id}/decision',
];

function extract(api) {
  const components = {};
  function includeRefs(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string') {
      const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(value.$ref);
      if (!match) throw new Error(`Unsupported contract reference: ${value.$ref}`);
      const [, group, name] = match;
      if (!Object.hasOwn(api.components?.[group] ?? {}, name)) throw new Error(`Unresolved contract reference: ${value.$ref}`);
      components[group] ??= {};
      if (!Object.hasOwn(components[group], name)) {
        components[group][name] = api.components[group][name];
        includeRefs(components[group][name]);
      }
    }
    for (const child of Object.values(value)) includeRefs(child);
  }
  const paths = {};
  for (const endpoint of PATHS) {
    if (!api.paths[endpoint]) throw new Error(`Missing P0 endpoint: ${endpoint}`);
    paths[endpoint] = api.paths[endpoint];
    includeRefs(paths[endpoint]);
  }
  for (const option of api.security ?? []) {
    for (const name of Object.keys(option)) includeRefs({ $ref: `#/components/securitySchemes/${name}` });
  }
  return {
    openapi: api.openapi,
    info: { title: 'CNC Operations P0 HTTP contract', version: '1.0.0',
      description: 'Generated from backend/openapi.yaml. Domain schema 3.0. See p0-contract.md for semantics and acceptance.' },
    servers: api.servers, security: api.security, paths, components,
  };
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function generate() {
  const api = yaml.safeLoad(fs.readFileSync(path.join(ROOT, 'backend/openapi.yaml'), 'utf8'));
  const output = `${JSON.stringify(stable(extract(api)), null, 2)}\n`;
  const target = path.join(ROOT, 'contracts/v3/operations-http.openapi.json');
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) {
      throw new Error('Operations HTTP contract drift. Review the API change, then run node backend/scripts/export-operations-http-contract.js');
    }
    console.log('Operations HTTP contract matches backend OpenAPI.');
  } else {
    fs.writeFileSync(target, output);
    console.log('Generated contracts/v3/operations-http.openapi.json');
  }
}
if (require.main === module) generate();
module.exports = { extract, stable, PATHS };
