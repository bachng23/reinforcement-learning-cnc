const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { execFileSync } = require('node:child_process');
const api = require('../src/research/demo-situations');
const examples = require('../docs/jcst-situations-examples.json');
test('all OpenAPI references resolve, including main research document references', () => {
  const seen = new Set();
  const documents = new Map();
  const load = file => {
    if (!documents.has(file)) documents.set(file, yaml.safeLoad(fs.readFileSync(file, 'utf8')));
    return documents.get(file);
  };
  const visit = (node, file) => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) {
      const [relative, pointer] = node.$ref.split('#');
      // Existing research OpenAPI serves the canonical JSON Schema at ./schema.
      const target = relative === './schema' ? path.resolve(__dirname, '../../contracts/jcst/v1/jcst.schema.json')
        : relative ? path.resolve(path.dirname(file), relative) : file;
      const key = target + '#' + pointer;
      if (!seen.has(key)) {
        seen.add(key); let value = load(target);
        for (const part of pointer.split('/').slice(1)) value = value?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
        expect(value).toBeDefined(); visit(value, target);
      }
    }
    for (const value of Object.values(node)) if (typeof value === 'object') visit(value, file);
  };
  const file = path.resolve(__dirname, '../research-openapi.yaml'); visit(load(file), file);
});
test('exported examples match strict request schemas and remain reproducible', () => {
  expect(api.saveSchema.safeParse(examples.saveRequest).success).toBe(true);
  expect(api.openSchema.safeParse(examples.openRequest).success).toBe(true);
  expect(api.incidentSchema.safeParse(examples.incidentRequest).success).toBe(true);
  for (const name of ['healthySnapshot', 'inServiceSnapshot', 'reviewSnapshot', 'appliedIncidents', 'skippedIncidents']) expect(examples[name].success).toBe(true);
  execFileSync(process.execPath, [path.resolve(__dirname, '../scripts/export-jcst-situations-examples.js'), '--check']);
});
