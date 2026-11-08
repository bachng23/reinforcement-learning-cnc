const fs = require('node:fs');
const yaml = require('js-yaml');
const { projectHealth, eventId, hazard, querySchema, machineIndexSchema } = require('../src/research/demo-health');
const source = require('./fixtures/machine-health/source.json');
const clone = value => JSON.parse(JSON.stringify(value));

test('risk matches pinned JCST hazard at age zero and two older ages for every component', () => {
  for (const { spec, age, risk } of source.hazardOracle) expect(Math.abs(hazard(spec, age) - risk)).toBeLessThan(1e-14);
});

test.each([5, 6, 7])('frozen t%i frontend fixture is reproducible from physical trace', tick => {
  const data = projectHealth(source.rows[tick], 2);
  expect({ success: true, data }).toEqual(require(`./fixtures/machine-health/t${tick}.json`));
  expect(data.history.samples).toEqual([...data.history.samples].sort((a, b) => a.tick - b.tick || a.componentIndex - b.componentIndex));
  expect(data.history.events.every(e => e.machineIndex === 2)).toBe(true);
});

test('failure, CM dispatch and completion retain event ticks 5,5,7 and distinct stable identities', () => {
  const data = projectHealth(source.rows[7], 2);
  expect(data.history.events.map(e => [e.type, e.tick, e.recordTick, e.kind])).toEqual([
    ['failure', 5, 4, null], ['start', 5, 5, 'CM'], ['completion', 7, 6, 'CM'],
  ]);
  expect(data.history.events[1].technicianIndex).toBe(1);
  expect(new Set(data.history.events.map(e => e.eventId)).size).toBe(3);
  const cropped = clone(source.rows[7]); cropped.payloadJson.primary.records.splice(0, 5);
  expect(projectHealth(cropped, 2).history.events).toEqual(projectHealth(source.rows[7], 2, { limit: 2 }).history.events);
  const e = data.history.events[2];
  expect(e.eventId).toBe(eventId(data.sessionId, 6, e.eventIndex));
  expect(JSON.parse(Buffer.from(e.eventId.slice(4), 'base64url').toString())).toEqual([data.sessionId, 'primary', 6, e.eventIndex]);
  const revision = clone(source.rows[7]); revision.revision++;
  expect(projectHealth(revision, 2).history.events).toEqual(data.history.events);
});

test('current mode and per-component condition stay distinct before, during and after CM', () => {
  const failed = projectHealth(source.rows[5], 2);
  expect(failed.machineStatus).toBe('BREAKDOWN');
  expect(failed.components[0]).toMatchObject({ failed: false, failureRisk: null, riskUnavailableReason: 'BREAKDOWN' });
  expect(failed.components[1].failed).toBe(true);
  expect(projectHealth(source.rows[6], 2).machineStatus).toBe('IN_SERVICE');
  const repaired = projectHealth(source.rows[7], 2);
  expect(repaired.machineStatus).toBe('WORKING');
  expect(repaired.components[1]).toMatchObject({ ageTicks: 0, failed: false, riskUnavailableReason: null });
  expect(repaired.components[1].failureRisk).toBeGreaterThan(0);
  for (const s of repaired.history.samples.filter(s => [5, 6].includes(s.tick))) {
    expect(s).toMatchObject({ failureRisk: null, riskUnavailableReason: 'IN_SERVICE' });
  }
});

test('PM occupancy suppresses interval risk even though the before state is healthy; completion is PM', () => {
  const data = projectHealth(source.pm, 2);
  expect(data.history.samples.filter(s => s.sampleKind === 'INTERVAL').every(s =>
    s.failed === false && s.failureRisk === null && s.riskUnavailableReason === 'IN_SERVICE')).toBe(true);
  expect(data.history.events.map(e => [e.type, e.kind])).toEqual([['start', 'PM'], ['completion', 'PM']]);
  expect(data.components[1]).toMatchObject({ ageTicks: 0, failed: false });
  expect(data.machineStatus).toBe('WORKING');
});

test('new and legacy-empty sessions return current samples without invented history', () => {
  const fresh = clone(source.rows[0]); delete fresh.payloadJson.step_seconds;
  const data = projectHealth(fresh, 2);
  expect(data.stepSeconds).toBe(900);
  expect(data.history).toMatchObject({ fromTick: 0, toTick: 0, availableFromTick: null, truncated: false, returnedIntervals: 0, events: [] });
  expect(data.history.samples.map(s => s.sampleKind)).toEqual(['CURRENT', 'CURRENT']);
  const legacy = clone(source.rows[7]); legacy.payloadJson.primary.records = [];
  expect(projectHealth(legacy, 2).history).toMatchObject({ truncated: true, fromTick: 7, toTick: 7, gaps: [], returnedIntervals: 0 });
});

test('retained history, response limits and internal/tail gaps never synthesize samples', () => {
  const row = clone(source.rows[7]); row.payloadJson.primary.records = row.payloadJson.primary.records.filter(r => [3, 5].includes(r.tick));
  const data = projectHealth(row, 2);
  expect(data.history).toMatchObject({ truncated: true, availableFromTick: 3, fromTick: 3, toTick: 7,
    gaps: [{ fromTick: 4, toTick: 5 }, { fromTick: 6, toTick: 7 }] });
  expect([...new Set(data.history.samples.map(s => s.tick))]).toEqual([3, 5, 7]);
  const limited = projectHealth(source.rows[7], 2, { limit: 1 });
  expect(limited.history).toMatchObject({ limit: 1, returnedIntervals: 1, fromTick: 6, availableFromTick: 0, truncated: true });
  expect(limited.history.samples).toHaveLength(4);
  expect(projectHealth(source.rows[7], 2, { limit: 256 }).history.truncated).toBe(false);
});

test('pure read preserves the complete stored object', () => {
  const row = clone(source.rows[7]), before = JSON.stringify(row);
  projectHealth(row, 2); projectHealth(row, 0, { limit: 1 });
  expect(JSON.stringify(row)).toBe(before);
});

test.each(['healthy after transition', 'already failed before transition'])(
  'failure event contradicting physical state is rejected: %s', contradiction => {
    const row = clone(source.rows[5]);
    if (contradiction === 'healthy after transition') {
      // PR #64 report: valid event shape, indices and tick; after is healthy.
      row.payloadJson.primary.records[0].events.push({ type: 'failure', tick: 1, machine: 2, component: 1 });
      expect(row.payloadJson.primary.records[0].after.components[2][1].failed).toBe(false);
    } else {
      // Isolate this record so cross-record continuity cannot mask the check.
      row.payloadJson.primary.records = [row.payloadJson.primary.records[4]];
      row.payloadJson.primary.records[0].before.components[2][1].failed = true;
    }
    const before = JSON.stringify(row);
    expect(() => projectHealth(row, 2)).toThrow(expect.objectContaining({ code: 'DEMO_TRACE_INVALID', statusCode: 500 }));
    expect(JSON.stringify(row)).toBe(before);
  },
);

test('stale revision and machine range are explicit domain errors', () => {
  expect(() => projectHealth(source.rows[7], 2, { expectedRevision: 0 })).toThrow(expect.objectContaining({ code: 'DEMO_STALE', statusCode: 409 }));
  expect(() => projectHealth(source.rows[7], 3)).toThrow(expect.objectContaining({ code: 'DEMO_MACHINE_NOT_FOUND', statusCode: 404 }));
  expect(() => projectHealth(source.rows[7], -1)).toThrow(expect.objectContaining({ code: 'DEMO_MACHINE_NOT_FOUND' }));
});

test.each([
  r => { r.payloadJson.config.components[2][1].scale = 0; },
  r => { r.payloadJson.primary.records[1].tick = 0; },
  r => { r.payloadJson.primary.records[0].events.push({ type: 'failure', machine: 9, component: 0, tick: 1 }); },
  r => { r.payloadJson.primary.records[6].after.components[2][1].age = 20; },
  r => { r.payloadJson.primary.state.components[2][1].failed = 'false'; },
])('malformed physical data fails closed', mutate => {
  const row = clone(source.rows[7]); mutate(row);
  expect(() => projectHealth(row, 2)).toThrow(expect.objectContaining({ code: 'DEMO_TRACE_INVALID' }));
});

test('strict query and index validation rejects coercion, repeats and unsafe numbers', () => {
  expect(querySchema.parse({})).toEqual({ limit: 64 });
  expect(querySchema.parse({ limit: '256', expectedRevision: '14' })).toEqual({ limit: 256, expectedRevision: 14 });
  for (const query of [{ limit: '0' }, { limit: '257' }, { limit: ['1', '2'] }, { limit: '01' }, { limit: '1.0' },
    { limit: '' }, { unknown: 'x' }, { expectedRevision: ['0', '0'] }, { expectedRevision: '9007199254740992' }]) {
    expect(querySchema.safeParse(query).success).toBe(false);
  }
  for (const index of ['-1', '01', '1e0', '1.0', 'NaN', '9007199254740992']) expect(machineIndexSchema.safeParse(index).success).toBe(false);
});

test('OpenAPI exposes typed read contract and three milestone examples', () => {
  const doc = yaml.safeLoad(fs.readFileSync(require.resolve('../research-openapi.yaml'), 'utf8'));
  const route = doc.paths['/demo/sessions/{id}/machines/{machineIndex}/health'].get;
  expect(route.operationId).toBe('getDemoMachineHealth');
  expect(Object.keys(route.responses['200'].content['application/json'].examples)).toEqual(['t5', 't6', 't7']);
  expect(doc.components.schemas.MachineHealth.required).toContain('history');
});
