const { z } = require('zod');
const { ApiError, fromZodError } = require('../lib/api-error');
const { canonical } = require('./artifact-store');
const n = z.number().int().nonnegative();
const m = n.max(2), c = n.max(1), t = n.max(2);
const job = z.object({ machine: m, component: c, technician: t, kind: z.enum(['PM', 'CM']), remaining: n.positive() });
const state = z.object({ tick: n.max(64), components: z.array(z.array(z.object({ age: n, failed: z.boolean() })).length(2)).length(3),
  jobs: z.array(job.nullable()).min(2).max(3) }).refine(value => value.jobs.every((j, index) => !j || j.technician === index));
const action = z.array(z.tuple([m, c, t])).max(3);
const event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('failure'), tick: n.max(64), machine: m, component: c }),
  ...['start', 'completion'].map(type => z.object({ type: z.literal(type), tick: n.max(64), machine: m, component: c,
    technician: t, kind: z.enum(['PM', 'CM']), ...(type === 'start' ? { duration: n.positive() } : {}) })),
  z.object({ type: z.literal('occupancy'), tick: n.max(64), machine: m, component: c, technician: t, remaining: n.positive() }),
]);
const record = z.object({ tick: n.max(63), before: state, after: state, action, events: z.array(event).max(30) });
const payload = z.object({ primary: z.object({ state, records: z.array(record).max(64) }),
  decisions: z.array(z.object({ tick: n.max(63), actor: z.string(), reason: z.string(), action,
    proposed_action: action, override: z.boolean() })).max(64), status: z.enum(['RUNNING', 'REVIEW', 'COMPLETE']) });
const query = z.object({ expectedRevision: z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(n.max(2147483647)).optional() }).strict();
const filters = query.extend({ status: z.enum(['OPEN', 'IN_SERVICE', 'RESOLVED']).optional(), machineId: z.enum(['M1', 'M2', 'M3']).optional() });
const invalid = () => new ApiError(500, 'DEMO_TRACE_INVALID', 'Stored simulation evidence is inconsistent');
function incidentId(sessionId, recordIndex, eventIndex) {
  return 'ji1_' + Buffer.from(JSON.stringify([sessionId, 'primary', recordIndex, eventIndex])).toString('base64url');
}
function context(row) {
  return row.contextJson == null ? { contextStatus: 'MISSING_LEGACY', contextVersion: null, contextOrigin: null, context: null }
    : { contextStatus: 'AVAILABLE', contextVersion: row.contextJson.contextVersion,
      contextOrigin: row.contextJson.contextOrigin, context: row.contextJson };
}
function project(row) {
  const parsed = payload.safeParse(row.payloadJson);
  if (!parsed.success) throw invalid();
  const { primary, decisions } = parsed.data;
  if (primary.records.length !== primary.state.tick) throw invalid();
  const incidents = [], services = [], active = new Map(), activeService = new Map();
  const key = (machine, component) => `${machine}:${component}`;
  for (const [recordIndex, r] of primary.records.entries()) {
    if (r.tick !== recordIndex || r.before.tick !== r.tick || r.after.tick !== r.tick + 1 ||
      (recordIndex && canonical(r.before) !== canonical(primary.records[recordIndex - 1].after))) throw invalid();
    for (const [eventIndex, e] of r.events.entries()) {
      if (e.tick !== r.tick + (['failure', 'completion'].includes(e.type) ? 1 : 0)) throw invalid();
      const evidence = { recordIndex, eventIndex, tick: e.tick, type: e.type, machineId: `M${e.machine + 1}`,
        componentId: `C${e.component + 1}`, technicianId: e.technician == null ? null : `T${e.technician + 1}`,
        kind: e.kind ?? null, durationTicks: e.duration ?? null };
      const pair = key(e.machine, e.component);
      if (e.type === 'failure') {
        if (active.has(pair) || activeService.has(pair)) throw invalid();
        const incident = { incidentId: incidentId(row.id, recordIndex, eventIndex), machineId: evidence.machineId,
          simulatorMachineIndex: e.machine, componentId: evidence.componentId, simulatorComponentIndex: e.component,
          status: 'OPEN', openedAtTick: e.tick, serviceStartedAtTick: null, resolvedAtTick: null,
          failure: evidence, timeline: [evidence], decisions: [] };
        incidents.push(incident); active.set(pair, incident);
      } else if (e.type === 'start') {
        if (e.technician >= r.before.jobs.length || activeService.has(pair) || activeService.size >= primary.state.jobs.length ||
          [...activeService.values()].some(s => s.technicianId === evidence.technicianId || s.machineId === evidence.machineId) ||
          !r.action.some(a => a[0] === e.machine && a[1] === e.component && a[2] === e.technician)) throw invalid();
        const matches = decisions.map((d, decisionIndex) => ({ ...d, decisionIndex }))
          .filter(d => d.tick === r.tick && canonical(d.action) === canonical(r.action));
        if (matches.length > 1) throw invalid();
        const decision = matches[0] ? { decisionIndex: matches[0].decisionIndex, tick: matches[0].tick,
          actor: matches[0].actor, reason: matches[0].reason, action: matches[0].action, override: matches[0].override } : null;
        const service = { serviceId: `js1:${recordIndex}:${eventIndex}`, machineId: evidence.machineId,
          componentId: evidence.componentId, technicianId: evidence.technicianId, kind: e.kind,
          startedAtTick: e.tick, completedAtTick: null, durationTicks: e.duration, start: evidence, completion: null, decision };
        services.push(service); activeService.set(pair, service);
        if (e.kind === 'CM') {
          const incident = active.get(pair);
          if (!incident || incident.status !== 'OPEN') throw invalid();
          incident.status = 'IN_SERVICE'; incident.serviceStartedAtTick = e.tick; incident.timeline.push(evidence);
          if (decision) incident.decisions.push(decision);
        } else if (active.has(pair)) throw invalid();
      } else if (e.type === 'completion') {
        const service = activeService.get(pair);
        if (!service || service.kind !== e.kind || service.technicianId !== evidence.technicianId ||
          service.startedAtTick + service.durationTicks !== e.tick) throw invalid();
        service.completedAtTick = e.tick; service.completion = evidence; activeService.delete(pair);
        if (e.kind === 'CM') {
          const incident = active.get(pair);
          if (!incident || incident.status !== 'IN_SERVICE') throw invalid();
          incident.status = 'RESOLVED'; incident.resolvedAtTick = e.tick; incident.timeline.push(evidence); active.delete(pair);
        }
      }
    }
  }
  if (primary.records.length && canonical(primary.records.at(-1).after) !== canonical(primary.state)) throw invalid();
  for (const [mi, components] of primary.state.components.entries()) for (const [ci, component] of components.entries())
    if (component.failed !== active.has(key(mi, ci))) throw invalid();
  const jobs = primary.state.jobs.filter(Boolean);
  if (jobs.length !== activeService.size) throw invalid();
  for (const j of jobs) {
    const service = activeService.get(key(j.machine, j.component));
    if (!service || service.technicianId !== `T${j.technician + 1}` || service.kind !== j.kind ||
      service.startedAtTick + service.durationTicks - primary.state.tick !== j.remaining) throw invalid();
  }
  const metadata = { sessionId: row.id, revision: row.revision, tick: primary.state.tick, lane: 'primary' };
  const machines = primary.state.components.map((components, index) => {
    const currentJobs = jobs.filter(j => j.machine === index).map(j => ({ technicianId: `T${j.technician + 1}`,
      componentId: `C${j.component + 1}`, kind: j.kind, remainingTicks: j.remaining }));
    return { machineId: `M${index + 1}`, simulatorMachineIndex: index,
      machineState: currentJobs.length ? 'IN_SERVICE' : components.some(c => c.failed) ? 'BREAKDOWN' : 'WORKING',
      components: components.map((c, i) => ({ componentId: `C${i + 1}`, ageTicks: c.age, failed: c.failed })), currentJobs };
  });
  return { metadata, context: context(row), machines, incidents: incidents.reverse(), services };
}
async function read(user, sessionId, kind, resourceId, rawQuery) {
  const parsed = (kind === 'incidents' ? filters : query).safeParse(rawQuery);
  if (!parsed.success) throw fromZodError(parsed.error);
  const row = await require('./demo-service').read(user, sessionId);
  if (parsed.data.expectedRevision != null && row.revision !== parsed.data.expectedRevision)
    throw new ApiError(409, 'DEMO_STALE', 'Session changed; discard related reads and reload the same revision');
  const p = project(row), shared = { ...p.metadata, ...p.context };
  if (kind === 'observation') return { ...shared, status: row.payloadJson.status, machines: p.machines,
    incidents: p.incidents, maintenanceHistory: p.services };
  if (kind === 'factory') return shared;
  if (kind === 'machine') {
    const machine = p.machines.find(m => m.machineId === resourceId);
    if (!machine) throw new ApiError(404, 'DEMO_MACHINE_NOT_FOUND', 'Machine was not found');
    const profile = p.context.context?.machines.find(m => m.machineId === resourceId) ?? null;
    return { ...shared, profile, assignedBatch: profile?.assignedBatch ?? null, ...machine,
      maintenanceHistory: p.services.filter(s => s.machineId === resourceId),
      incidentIds: p.incidents.filter(i => i.machineId === resourceId).map(i => i.incidentId) };
  }
  if (kind === 'incident') {
    const incident = p.incidents.find(i => i.incidentId === resourceId);
    if (!incident) throw new ApiError(404, 'DEMO_INCIDENT_NOT_FOUND', 'Incident was not found');
    return { ...shared, incident, machine: p.machines.find(m => m.machineId === incident.machineId) };
  }
  return { ...shared, items: p.incidents.filter(i => (!parsed.data.status || i.status === parsed.data.status) &&
    (!parsed.data.machineId || i.machineId === parsed.data.machineId)), limit: 384, truncated: false };
}
module.exports = { project, read, incidentId };
