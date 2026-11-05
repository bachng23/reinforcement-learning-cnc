const { randomUUID } = require('node:crypto');
const { project } = require('../src/research/demo-observation');
const { contextSnapshot } = require('../src/research/demo-context');
const component = () => ({ age: 0, failed: false });
function row() { return { id: randomUUID(), revision: 0, contextJson: contextSnapshot(),
  payloadJson: { status: 'RUNNING', decisions: [], primary: { state: { tick: 0,
    components: Array.from({ length: 3 }, () => [component(), component()]), jobs: [null, null] }, records: [] } } }; }
function append(r, events, action = []) {
  const before = structuredClone(r.payloadJson.primary.state), after = structuredClone(before);
  after.tick++;
  for (const e of events) {
    if (e.type === 'failure') after.components[e.machine][e.component].failed = true;
    if (e.type === 'start') after.jobs[e.technician] = { ...e, remaining: e.duration };
    if (e.type === 'completion') { after.jobs[e.technician] = null; after.components[e.machine][e.component].failed = false; }
  }
  for (const j of after.jobs) if (j) j.remaining--;
  r.payloadJson.primary.records.push({ tick: before.tick, before, after, action, events });
  r.payloadJson.primary.state = after; r.revision++;
}
const failure = (tick, component = 0) => ({ type: 'failure', tick, machine: 0, component });
test('failure identity survives reload and append, with separate simultaneous component incidents', () => {
  const r = row(); append(r, [failure(1), failure(1, 1)]);
  const before = JSON.stringify(r), p = project(r);
  expect(p.incidents.map(i => i.status)).toEqual(['OPEN', 'OPEN']);
  expect(p.incidents.map(i => i.componentId)).toEqual(['C2', 'C1']);
  expect(project(JSON.parse(before))).toEqual(p); expect(JSON.stringify(r)).toBe(before);
  append(r, []); expect(project(r).incidents.map(i => i.incidentId)).toEqual(p.incidents.map(i => i.incidentId));
});
test('CM resolves only its component; PM completion does not close another CM incident; recurrence is new', () => {
  const r = row(); append(r, [failure(1)]);
  append(r, [{ type: 'start', tick: 1, machine: 0, component: 0, technician: 0, kind: 'CM', duration: 2 }], [[0, 0, 0]]);
  expect(project(r).incidents[0].status).toBe('IN_SERVICE');
  append(r, [{ type: 'completion', tick: 3, machine: 0, component: 0, technician: 0, kind: 'CM' }, failure(3, 1)]);
  expect(project(r).incidents.map(i => i.status)).toEqual(['OPEN', 'RESOLVED']);
  expect(project(r).machines[0].machineState).toBe('BREAKDOWN');
  append(r, [{ type: 'start', tick: 3, machine: 1, component: 0, technician: 0, kind: 'PM', duration: 2 }], [[1, 0, 0]]);
  append(r, [{ type: 'completion', tick: 5, machine: 1, component: 0, technician: 0, kind: 'PM' }, failure(5)]);
  const p = project(r); expect(p.incidents.map(i => i.status)).toEqual(['OPEN', 'OPEN', 'RESOLVED']);
  expect(new Set(p.incidents.map(i => i.incidentId)).size).toBe(3);
  expect(p.services.map(s => s.kind)).toEqual(['CM', 'PM']);
});
test('trace inconsistencies fail closed and legacy context remains explicitly missing', () => {
  const r = row(); r.contextJson = null; expect(project(r).context.contextStatus).toBe('MISSING_LEGACY');
  append(r, [failure(1)]); r.payloadJson.primary.records[0].events[0].tick = 0;
  expect(() => project(r)).toThrow(expect.objectContaining({ code: 'DEMO_TRACE_INVALID' }));
});
test('context is cloned independently of physical session input', () => {
  const a = contextSnapshot(), b = contextSnapshot(); a.machines[0].name = 'Changed';
  expect(b.machines[0].name).toBe('CNC turning center'); expect(b.machines[0].assignedBatch.quantity).toBeNull();
});
