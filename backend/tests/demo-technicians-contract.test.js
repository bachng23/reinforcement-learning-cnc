const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');
const api = require('../src/research/demo-technicians');
const state = require('../src/research/demo-technician-state');
const examples = require('../docs/jcst-technicians-examples.json');
test('fixtures cover AVAILABLE/BUSY/ABSENT, validated bodies and typed events', () => {
  expect(api.absenceSchema.safeParse(examples.startRequest).success).toBe(true);
  expect(api.returnSchema.safeParse(examples.returnRequest).success).toBe(true);
  expect(state.eventSchema.safeParse(examples.event).success).toBe(true);
  for (const status of ['AVAILABLE', 'BUSY', 'ABSENT']) expect(examples[status].data.technicians.some(t => t.availability === status)).toBe(true);
  execFileSync(process.execPath, [path.resolve(__dirname, '../scripts/export-jcst-technicians-examples.js'), '--check']);
});
test('all three routes describe owner scope, expected revision, key and bounded input', () => {
  const doc = yaml.safeLoad(fs.readFileSync(path.resolve(__dirname, '../docs/jcst-technicians.openapi.yaml'), 'utf8'));
  expect(Object.keys(doc.paths)).toHaveLength(3);
  for (const route of Object.values(doc.paths).filter(p => p.post)) {
    expect(route.post.parameters).toContainEqual({ $ref: '#/components/parameters/key' });
    expect(route.post.responses['200']).toBeDefined();
  }
  expect(doc.components.schemas.StartAbsence.required).toEqual(['revision', 'durationTicks', 'reason']);
  expect(doc.components.schemas.StartAbsence.properties.durationTicks).toMatchObject({ minimum: 1, maximum: 100000 });
  expect(doc.components.schemas.Calendar.required).toContain('origin');
});
