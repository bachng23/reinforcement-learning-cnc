const { z } = require('zod');
const { bridge } = require('./bridge');
const { ApiError } = require('../lib/api-error');
const { canonical } = require('./artifact-store');
const protocol = 'jcst-situations/1';
const uint = z.number().int().min(0).max(2147483647);
const job = z.object({ machine: uint, component: uint, technician: uint,
  kind: z.enum(['PM', 'CM']), remaining: uint.positive() }).passthrough();
const state = z.object({ tick: uint,
  components: z.array(z.array(z.object({ age: uint, failed: z.boolean() }).passthrough()).min(1)).min(1),
  jobs: z.array(job.nullable()).min(1) }).passthrough();
const record = z.object({ tick: uint, before: state, after: state, events: z.array(z.unknown()) }).passthrough();
const lane = z.object({ state, records: z.array(record).max(256), controller: z.enum(['S', 'A', 'F', 'risk', 'corrective', 'threshold5', 'wait']) }).passthrough();
const payload = z.object({ primary: lane, baseline: lane, config: z.object({ components: z.array(z.array(z.unknown()).min(1)).min(1) }).passthrough(),
  physical_seed: z.string(), source_commit: z.string(), releases: z.record(z.string(), z.unknown()),
  status: z.enum(['RUNNING', 'REVIEW', 'COMPLETE']) }).passthrough();
const incidentSchema = z.object({ eventId: z.string().uuid(), machineIndex: uint, componentIndex: uint,
  scheduledTick: uint, status: z.enum(['SCHEDULED', 'APPLIED', 'SKIPPED']), appliedTick: uint.nullable(),
  reason: z.enum(['COMPONENT_ALREADY_FAILED', 'MACHINE_IN_SERVICE']).nullable(), requestedReason: z.string(),
  createdBy: z.string().uuid(), createdAt: z.string().datetime() }).strict();
const invalid = () => new ApiError(502, 'DEMO_SCENARIO_INVALID_OUTPUT', 'Scenario runtime returned inconsistent output');
const same = (a, b) => canonical(a) === canonical(b);
function validate(session) {
  if (!payload.safeParse(session).success) throw invalid();
  const { primary, baseline, config } = session;
  if (primary.state.tick !== baseline.state.tick) throw invalid();
  for (const lane of [primary, baseline]) {
    if (lane.state.components.length !== config.components.length || lane.state.components.some((cs, i) => cs.length !== config.components[i].length)) throw invalid();
    const machines = new Set();
    for (const [index, j] of lane.state.jobs.entries()) {
      if (!j) continue;
      if (j.technician !== index || !lane.state.components[j.machine]?.[j.component] || machines.has(j.machine)) throw invalid();
      machines.add(j.machine);
    }
    let previous = -1;
    for (const r of lane.records) {
      if (r.tick <= previous || r.before.tick !== r.tick || r.after.tick !== r.tick + 1 || r.after.tick > lane.state.tick) throw invalid();
      previous = r.tick;
    }
  }
  const ids = new Set(), points = new Set();
  for (const event of session.incidents ?? []) {
    if (!incidentSchema.safeParse(event).success) throw invalid();
    const point = `${event.machineIndex}:${event.componentIndex}:${event.scheduledTick}`;
    if (ids.has(event.eventId) || points.has(point) || !config.components[event.machineIndex]?.[event.componentIndex]
      || (event.status === 'SCHEDULED' ? event.appliedTick !== null || event.reason !== null || event.scheduledTick < primary.state.tick
        : event.appliedTick !== event.scheduledTick || event.appliedTick > primary.state.tick || (event.status === 'SKIPPED' ? event.reason === null : event.reason !== null))) throw invalid();
    ids.add(event.eventId); points.add(point);
  }
  return session;
}
async function invoke(operation, input) {
  let output;
  try { output = await bridge({ operation, protocol, ...input }); }
  catch (e) {
    if (e.code === 'JCST_VALIDATION_FAILED' || e.code === 'JCST_UNAVAILABLE')
      throw new ApiError(503, 'DEMO_SCENARIO_RUNTIME_UNAVAILABLE', 'Compatible Flex situation bridge is not installed');
    throw e;
  }
  if (output?.protocol !== protocol) throw invalid();
  if (output.error) {
    const codes = ['DEMO_RELEASE_UNAVAILABLE', 'DEMO_SNAPSHOT_INCOMPATIBLE', 'DEMO_INTERVENTION_REPLAY_UNSUPPORTED', 'DEMO_REVIEW_REQUIRED'];
    if (!codes.includes(output.error.code)) throw invalid();
    throw new ApiError(409, output.error.code, 'Runtime rejected this situation; reload or install the pinned release');
  }
  validate(output.session);
  return output;
}
async function restore(snapshot) {
  const output = await invoke('demo_snapshot_restore', { snapshot });
  if (!same(output.session, snapshot.runtime)) throw invalid();
  return output.session;
}
async function incident(session, event) {
  const output = await invoke('demo_incident', { session, event });
  const next = output.session, result = output.event;
  if (!incidentSchema.safeParse(result).success) throw invalid();
  for (const key of ['eventId', 'machineIndex', 'componentIndex', 'scheduledTick', 'requestedReason', 'createdBy', 'createdAt'])
    if (result[key] !== event[key]) throw invalid();
  for (const key of ['baseline', 'config', 'physical_seed', 'source_commit', 'releases', 'branch', 'simulation_start', 'step_seconds'])
    if (!same(next[key], session[key])) throw invalid();
  const tick = session.primary.state.tick;
  if (next.primary.state.tick !== tick || !same(next.incidents, [...(session.incidents ?? []), result])) throw invalid();
  const machine = session.primary.state.components[event.machineIndex];
  const busy = session.primary.state.jobs.some(j => j?.machine === event.machineIndex);
  const failed = machine.some(c => c.failed);
  const immediate = event.scheduledTick === tick;
  const expected = !immediate ? 'SCHEDULED' : busy || failed ? 'SKIPPED' : 'APPLIED';
  if (result.status !== expected || (expected === 'SKIPPED' && result.reason !== (busy ? 'MACHINE_IN_SERVICE' : 'COMPONENT_ALREADY_FAILED'))) throw invalid();
  const expectedState = structuredClone(session.primary.state);
  if (expected === 'APPLIED') expectedState.components[event.machineIndex][event.componentIndex].failed = true;
  if (!same(next.primary.state, expectedState)) throw invalid();
  const { state: oldState, ...oldLane } = session.primary;
  const { state: newState, ...newLane } = next.primary;
  if (!same(oldLane, newLane)) throw invalid();
  const allowed = new Set(['incidents', 'primary', 'activated', 'first_incident_tick', 'workflow']);
  for (const key of new Set([...Object.keys(session), ...Object.keys(next)])) {
    if (!allowed.has(key) && !same(next[key], session[key])) throw invalid();
  }
  if (expected !== 'APPLIED') {
    for (const key of ['activated', 'first_incident_tick', 'workflow']) if (!same(next[key], session[key])) throw invalid();
  }
  // No synthetic normal transition is allowed for a zero-time intervention.
  if (!same(next.primary.records, session.primary.records)) throw invalid();
  return { session: next, event: result };
}
async function command(session, command, actor) {
  const output = await invoke('demo_situation_command', { session, command, actor });
  const next = output.session;
  for (const key of ['config', 'physical_seed', 'source_commit', 'branch', 'simulation_start', 'step_seconds'])
    if (!same(next[key], session[key])) throw invalid();
  if (next.primary.state.tick < session.primary.state.tick || next.primary.state.tick > session.primary.state.tick + (command.command === 'autoplay' ? command.maxTicks : 1)) throw invalid();
  if ((next.incidents ?? []).length !== (session.incidents ?? []).length) throw invalid();
  for (const old of session.incidents ?? []) {
    const event = next.incidents.find(e => e.eventId === old.eventId);
    if (!event) throw invalid();
    for (const key of ['eventId', 'machineIndex', 'componentIndex', 'scheduledTick', 'requestedReason', 'createdBy', 'createdAt']) if (!same(event[key], old[key])) throw invalid();
    if (old.status !== 'SCHEDULED' && !same(event, old)) throw invalid();
    if (event.status === 'SCHEDULED' && event.scheduledTick < next.primary.state.tick) throw invalid();
  }
  return next;
}
module.exports = { protocol, incidentSchema, validate, restore, incident, command };
