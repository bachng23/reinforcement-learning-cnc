const { z } = require('zod');
const { ApiError } = require('../lib/api-error');
const { canonical } = require('./artifact-store');

const uint = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const component = z.object({ age: uint, failed: z.boolean() });
const job = z.object({ machine: uint, component: uint, technician: uint,
  kind: z.enum(['PM', 'CM']), remaining: uint.positive() });
const state = z.object({ tick: uint, components: z.array(z.array(component).min(1)).min(1),
  jobs: z.array(job.nullable()).min(1) });
const position = { tick: uint, machine: uint, component: uint };
const service = { ...position, technician: uint, kind: z.enum(['PM', 'CM']) };
const event = z.discriminatedUnion('type', [
  z.object({ ...position, type: z.literal('failure') }),
  z.object({ ...service, type: z.literal('start'), duration: uint.positive() }),
  z.object({ ...service, type: z.literal('completion') }),
  z.object({ ...position, type: z.literal('occupancy'), technician: uint, remaining: uint.positive() }),
]);
const record = z.object({ tick: uint, before: state, after: state, events: z.array(event) });
const payload = z.object({
  step_seconds: z.number().finite().positive().optional(),
  config: z.object({ version: z.literal('JCST/1.1'), components: z.array(z.array(z.object({
    scale: z.number().finite().positive(), shape: z.number().finite().positive(),
  })).min(1)).min(1) }),
  primary: z.object({ state, records: z.array(record).max(256) }),
});
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(uint);
const querySchema = z.object({
  limit: decimal.pipe(z.number().min(1).max(256)).default(64),
  expectedRevision: decimal.optional(),
}).strict();
const machineIndexSchema = decimal;
const invalid = () => new ApiError(500, 'DEMO_TRACE_INVALID', 'Stored simulation evidence is inconsistent');

// Share this identity with maintenance/incident projections. Array position is
// deliberately excluded: retention and limit must not change physical identity.
function eventId(sessionId, recordTick, eventIndex) {
  return 'je1_' + Buffer.from(JSON.stringify([sessionId, 'primary', recordTick, eventIndex])).toString('base64url');
}

function hazard(spec, age) {
  const delta = ((age + 1) / spec.scale) ** spec.shape - (age / spec.scale) ** spec.shape;
  const value = -Math.expm1(-delta);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw invalid();
  return value;
}

function validate(p) {
  const specs = p.config.components;
  const validState = s => {
    if (s.components.length !== specs.length || s.jobs.length !== p.primary.state.jobs.length) throw invalid();
    s.components.forEach((cs, m) => { if (cs.length !== specs[m].length) throw invalid(); });
    const busy = new Set();
    s.jobs.forEach((j, index) => {
      if (!j) return;
      if (!s.components[j.machine]?.[j.component] || j.technician !== index || busy.has(j.machine)
        || s.components[j.machine][j.component].failed !== (j.kind === 'CM')) throw invalid();
      busy.add(j.machine);
    });
  };
  validState(p.primary.state);
  let previous;
  for (const r of p.primary.records) {
    validState(r.before); validState(r.after);
    if (r.before.tick !== r.tick || r.after.tick !== r.tick + 1 || r.after.tick > p.primary.state.tick
      || (previous && r.tick <= previous.tick)) throw invalid();
    if (previous?.after.tick === r.tick && canonical(previous.after) !== canonical(r.before)) throw invalid();
    for (const e of r.events) {
      if (!r.before.components[e.machine]?.[e.component]
        || e.tick !== r.tick + (['failure', 'completion'].includes(e.type) ? 1 : 0)
        || (e.technician != null && e.technician >= r.before.jobs.length)) throw invalid();
      // A failure is physical evidence of a healthy -> failed transition, not
      // merely a well-formed annotation. Reject it before assigning an eventId.
      if (e.type === 'failure' && (r.before.components[e.machine][e.component].failed
        || !r.after.components[e.machine][e.component].failed)) throw invalid();
    }
    previous = r;
  }
  if (previous?.after.tick === p.primary.state.tick && canonical(previous.after) !== canonical(p.primary.state)) throw invalid();
}

function machineStatus(s, machine, events = []) {
  // An action can start service on a machine that was healthy at interval start.
  if (s.jobs.some(j => j?.machine === machine)
    || events.some(e => e.machine === machine && ['occupancy', 'start'].includes(e.type))) return 'IN_SERVICE';
  return s.components[machine].some(c => c.failed) ? 'BREAKDOWN' : 'WORKING';
}

function projectHealth(row, machineIndex, { limit = 64, expectedRevision } = {}) {
  if (expectedRevision != null && expectedRevision !== row.revision) {
    throw new ApiError(409, 'DEMO_STALE', 'Session changed; reload before reading');
  }
  const parsed = payload.safeParse(row.payloadJson);
  if (!parsed.success) throw invalid();
  const p = parsed.data;
  validate(p);
  const current = p.primary.state;
  if (!Number.isSafeInteger(machineIndex) || machineIndex < 0 || machineIndex >= current.components.length) {
    throw new ApiError(404, 'DEMO_MACHINE_NOT_FOUND', 'Machine was not found in this simulation session');
  }
  const status = machineStatus(current, machineIndex);
  const componentsAt = (s, mode) => s.components[machineIndex].map((c, componentIndex) => ({
    componentIndex, ageTicks: c.age, failed: c.failed,
    failureRisk: mode === 'WORKING' ? hazard(p.config.components[machineIndex][componentIndex], c.age) : null,
    riskUnavailableReason: mode === 'WORKING' ? null : mode,
  }));
  const records = p.primary.records.slice(-limit);
  const samples = [], events = [], gaps = [];
  let nextTick = records[0]?.tick ?? current.tick;
  for (const r of records) {
    if (r.tick > nextTick) gaps.push({ fromTick: nextTick, toTick: r.tick });
    nextTick = r.after.tick;
    const mode = machineStatus(r.before, machineIndex, r.events);
    samples.push(...componentsAt(r.before, mode).map(c => ({ ...c, tick: r.tick, sampleKind: 'INTERVAL', machineStatus: mode })));
    r.events.forEach((e, eventIndex) => {
      if (e.machine !== machineIndex || e.type === 'occupancy') return;
      events.push({ eventId: eventId(row.id, r.tick, eventIndex), type: e.type, tick: e.tick,
        recordTick: r.tick, eventIndex, machineIndex, componentIndex: e.component,
        technicianIndex: e.technician ?? null, kind: e.kind ?? null });
    });
  }
  if (nextTick < current.tick) gaps.push({ fromTick: nextTick, toTick: current.tick });
  const components = componentsAt(current, status);
  samples.push(...components.map(c => ({ ...c, tick: current.tick, sampleKind: 'CURRENT', machineStatus: status })));
  events.sort((a, b) => a.tick - b.tick || a.recordTick - b.recordTick || a.eventIndex - b.eventIndex);
  return {
    sessionId: row.id, revision: row.revision, tick: current.tick,
    stepSeconds: p.step_seconds ?? 900, lane: 'primary', source: 'JCST_SIMULATION',
    machineIndex, machineStatus: status, components,
    history: { fromTick: records[0]?.tick ?? current.tick, toTick: current.tick,
      availableFromTick: p.primary.records[0]?.tick ?? null, limit, returnedIntervals: records.length,
      truncated: records.length !== current.tick, gaps, samples, events },
  };
}

module.exports = { projectHealth, eventId, hazard, querySchema, machineIndexSchema };
