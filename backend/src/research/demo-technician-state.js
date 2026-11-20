const { z } = require('zod');
const { canonical, sha } = require('./artifact-store');
const { ApiError } = require('../lib/api-error');
const version = 'jcst-technician-availability/1';
const uint = z.number().int().min(0).max(2147483647);
const actor = z.discriminatedUnion('type', [z.object({ type: z.literal('USER'), userId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('SYSTEM'), userId: z.null() }).strict()]);
const eventSchema = z.object({ eventId: z.string().uuid(), technicianIndex: uint,
  type: z.enum(['ABSENCE_STARTED', 'ABSENCE_ENDED', 'ABSENCE_RETURNED_EARLY']), tick: uint,
  actor, reason: z.string().trim().min(1).max(1000) }).strict();
const intervalSchema = z.object({ eventId: z.string().uuid(), automaticEndEventId: z.string().uuid(), technicianIndex: uint,
  startTick: uint, returnTick: uint, endedTick: uint.nullable(), endedByEventId: z.string().uuid().nullable() }).strict();
const originSchema = z.object({ eventId: z.string().uuid(), tick: uint, workforceVersion: uint }).strict();
const schema = z.object({ schemaVersion: z.literal(version), version: uint,
  absences: z.array(intervalSchema).max(1024), events: z.array(eventSchema).max(2048), origin: originSchema.nullable() }).strict();
const invalid = () => new ApiError(500, 'DEMO_AVAILABILITY_INVALID', 'Stored technician availability is inconsistent');
const same = (a, b) => canonical(a) === canonical(b);
function count(p) {
  const jobs = p.primary?.state?.jobs;
  if (!Array.isArray(jobs) || !jobs.length) throw invalid();
  if (p.baseline && p.baseline.state?.jobs?.length !== jobs.length) throw invalid();
  if (p.config?.duration && (!Array.isArray(p.config.duration) || p.config.duration.some(m => !Array.isArray(m) || m.some(row => !Array.isArray(row) || row.length !== jobs.length)))) throw invalid();
  return jobs.length;
}
function metadata(p) {
  if (p.technicianAvailability === undefined) return { schemaVersion: version, version: 0, absences: [], events: [], origin: null };
  const m = p.technicianAvailability, n = count(p), tick = p.primary.state.tick;
  if (!schema.safeParse(m).success) throw invalid();
  const events = new Map(), ids = new Set(), windows = new Map(); let last = -1, userEvents = 0;
  for (const e of m.events) {
    if (events.has(e.eventId) || e.technicianIndex >= n || e.tick > tick || e.tick < last) throw invalid();
    if (e.type === 'ABSENCE_ENDED' ? e.actor.type !== 'SYSTEM' || e.reason !== 'Absence interval elapsed' : e.actor.type !== 'USER') throw invalid();
    last = e.tick; events.set(e.eventId, e); userEvents += e.actor.type === 'USER' ? 1 : 0;
  }
  let consumed = 0;
  for (const a of m.absences) {
    if (a.technicianIndex >= n || a.startTick > tick || a.returnTick <= a.startTick
      || ids.has(a.eventId) || ids.has(a.automaticEndEventId) || a.eventId === a.automaticEndEventId) throw invalid();
    ids.add(a.eventId); ids.add(a.automaticEndEventId);
    const started = events.get(a.eventId);
    if (!started || started.type !== 'ABSENCE_STARTED' || started.tick !== a.startTick || started.technicianIndex !== a.technicianIndex) throw invalid();
    consumed++;
    if (a.endedTick === null) {
      if (a.endedByEventId !== null || tick >= a.returnTick) throw invalid();
    } else {
      if (a.endedTick < a.startTick || a.endedTick > a.returnTick || a.endedTick > tick) throw invalid();
      const end = events.get(a.endedByEventId);
      if (!end || end.tick !== a.endedTick || end.technicianIndex !== a.technicianIndex || (end.type === 'ABSENCE_ENDED'
        ? a.endedTick !== a.returnTick || end.eventId !== a.automaticEndEventId
        : end.type !== 'ABSENCE_RETURNED_EARLY' || a.endedTick >= a.returnTick)) throw invalid();
      consumed++;
    }
    const end = a.endedTick ?? a.returnTick, previous = windows.get(a.technicianIndex) ?? -1;
    if (a.startTick < previous) throw invalid(); windows.set(a.technicianIndex, end);
  }
  if (consumed !== m.events.length || m.version !== userEvents) throw invalid();
  const latest = m.events.filter(e => e.actor.type === 'USER').at(-1);
  if (latest ? !m.origin || m.origin.eventId !== latest.eventId || m.origin.tick !== latest.tick || m.origin.workforceVersion !== m.version : m.origin !== null) throw invalid();
  return m;
}
function active(p, index) {
  const tick = p.primary.state.tick;
  return metadata(p).absences.find(a => a.technicianIndex === index && a.startTick <= tick && tick < (a.endedTick ?? a.returnTick)) ?? null;
}
function technicians(p) {
  const n = count(p), m = metadata(p), tick = p.primary.state.tick;
  return Array.from({ length: n }, (_, technicianIndex) => {
    const a = m.absences.find(a => a.technicianIndex === technicianIndex && a.startTick <= tick && tick < (a.endedTick ?? a.returnTick));
    const currentJob = p.primary.state.jobs[technicianIndex] ?? null;
    return { technicianIndex, availability: currentJob ? 'BUSY' : a ? 'ABSENT' : 'AVAILABLE', currentJob,
      activeAbsence: a ? { eventId: a.eventId, startTick: a.startTick, returnTick: a.returnTick } : null, returnTick: a?.returnTick ?? null };
  });
}
function comparison(row) {
  const p = row.payloadJson, m = metadata(p), workforceHash = sha(canonical(m));
  return { workforceVersion: m.version, workforceHash, origin: m.origin, requiresCommonSnapshot: m.version > 0,
    cacheIdentity: sha(canonical({ sessionId: row.id, revision: row.revision, tick: p.primary.state.tick,
      workforceHash, branch: p.branch ?? null, source: p.source_commit ?? null, releases: p.releases ?? {},
      policies: [p.primary.controller ?? null, p.baseline?.controller ?? null] })) };
}
function present(row) {
  return { sessionId: row.id, revision: row.revision, tick: row.payloadJson.primary.state.tick,
    stepSeconds: row.payloadJson.step_seconds ?? 900, lane: 'primary', technicians: technicians(row.payloadJson), comparisonContext: comparison(row) };
}
// Check that all prior records are immutable and only preallocated, timed
// automatic closures have been appended while a command advanced physical time.
function assertAdvance(before, after) {
  if (after.technicianAvailability === undefined) throw invalid();
  const a = metadata(before), b = metadata(after), oldTick = before.primary.state.tick, tick = after.primary.state.tick;
  if (a.version !== b.version || !same(a.origin, b.origin) || a.absences.length !== b.absences.length
    || !same(b.events.slice(0, a.events.length), a.events)) throw invalid();
  const additions = b.events.slice(a.events.length), expected = [];
  for (const old of a.absences) {
    const next = b.absences.find(x => x.eventId === old.eventId);
    if (!next) throw invalid();
    if (old.endedTick !== null || old.returnTick > tick) { if (!same(old, next)) throw invalid(); continue; }
    if (old.returnTick <= oldTick || !same(next, { ...old, endedTick: old.returnTick, endedByEventId: old.automaticEndEventId })) throw invalid();
    expected.push(old.automaticEndEventId);
  }
  if (expected.length !== additions.length || additions.some(e => !expected.includes(e.eventId) || e.type !== 'ABSENCE_ENDED')) throw invalid();
  for (const laneName of ['primary', 'baseline']) {
    for (const r of after[laneName].records) {
      if (r.tick < oldTick) continue;
      const absent = i => b.absences.some(x => x.technicianIndex === i && x.startTick <= r.tick && r.tick < (x.endedTick ?? x.returnTick));
      if ((r.action ?? []).some(edge => absent(edge[2])) || r.events.some(e => e.type === 'start' && absent(e.technician))) throw invalid();
    }
  }
  if (after.status === 'REVIEW' && (!after.pending?.catalogue?.some(action => Array.isArray(action) && action.length === 0)
    || after.pending?.action?.some(edge => Boolean(active(after, edge[2]))) || after.pending?.catalogue?.some(action => action.some(edge => {
    const absence = active(after, edge[2]); return Boolean(absence);
  })) || after.pending?.baseline_action?.some(edge => Boolean(active(after, edge[2]))))) throw invalid();
}
module.exports = { version, eventSchema, schema, metadata, count, active, technicians, present, comparison, assertAdvance, same };
