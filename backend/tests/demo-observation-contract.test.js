const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const doc = yaml.safeLoad(fs.readFileSync(path.resolve(__dirname, '../research-openapi.yaml'), 'utf8'));
const examples = require('../docs/jcst-context-examples.json');
test('generated observation OpenAPI is current and all example envelopes conform independently', () => {
  execFileSync(process.execPath, [path.resolve(__dirname, '../scripts/export-jcst-observation-contract.js'), '--check']);
  const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv);
  for (const [key, schema] of [['factory', 'DemoFactoryRead'], ['missingContext', 'DemoFactoryRead'],
    ['failure', 'DemoIncidentRead'], ['inService', 'DemoIncidentRead'], ['completedAndNewFailure', 'DemoIncidentListRead']]) {
    const validate = ajv.compile({ components: doc.components, type: 'object', additionalProperties: false,
      required: ['success', 'data'], properties: { success: { const: true }, data: { $ref: '#/components/schemas/' + schema } } });
    expect({ key, valid: validate(examples[key]), errors: validate.errors }).toEqual({ key, valid: true, errors: null });
    const invalid = structuredClone(examples[key]); invalid.data.revision = '7';
    expect(validate(invalid)).toBe(false);
  }
});
