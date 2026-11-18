const crypto = require('node:crypto');
const { z } = require('zod');
const { bridge } = require('./bridge');
const { ApiError } = require('../lib/api-error');
const writes = require('./demo-write');
const state = require('./demo-technician-state');
const protocol = 'jcst-technicians/1';
const uint = z.number().int().min(0).max(2147483647);
const reason = z.string().trim().min(1).max(1000);
const absenceSchema = z.object({ revision: uint, durationTicks: uint.min(1).max(100000), reason }).strict();
const returnSchema = z.object({ revision: uint, reason }).strict();
const indexSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(uint);
const invalid = () => new ApiError(502, 'TECHNICIAN_RUNTIME_INVALID_OUTPUT', 'Availability runtime returned inconsistent output');
async function invoke(operation, input) {
  let result;
  try { result = await bridge({ operation, protocol, ...input }); }
  catch (e) {
    if (['JCST_UNAVAILABLE', 'JCST_VALIDATION_FAILED'].includes(e.code)) throw new ApiError(503, 'TECHNICIAN_RUNTIME_UNAVAILABLE', 'Availability-aware Flex bridge is not installed');
    if (e.code === 'JCST_INVALID_OUTPUT') throw invalid();
    throw e;
  }
  if (result?.protocol !== protocol) throw invalid();
  if (result.error) {
    if (!['TECHNICIAN_BUSY', 'TECHNICIAN_ALREADY_ABSENT', 'TECHNICIAN_NOT_ABSENT', 'DEMO_REVIEW_REQUIRED', 'DEMO_RELEASE_UNAVAILABLE', 'DEMO_SNAPSHOT_INCOMPATIBLE', 'DEMO_INTERVENTION_REPLAY_UNSUPPORTED'].includes(result.error.code)) throw invalid();
    throw new ApiError(409, result.error.code, 'Runtime rejected this technician operation');
  }
  try {
    require('./demo-situation-runtime').validate(result.session);
    state.metadata(result.session);
  } catch { throw invalid(); }
  return result;
}
function check(row, index, input, type) {
  writes.revision(row, input.revision);
  const p = row.payloadJson, n = state.count(p);
  if (index >= n) throw new ApiError(404, 'TECHNICIAN_NOT_FOUND', 'Technician was not found in this session');
  if (p.status === 'COMPLETE') throw new ApiError(409, 'DEMO_COMPLETE', 'Simulation has completed');
  const active = state.active(p, index);
  if (type === 'absence') {
    if (p.primary.state.jobs[index]) throw new ApiError(409, 'TECHNICIAN_BUSY', 'Complete the active repair before starting absence');
    if (active) throw new ApiError(409, 'TECHNICIAN_ALREADY_ABSENT', 'Technician is already absent');
    if (p.primary.state.tick + input.durationTicks > 2147483647) throw new ApiError(400, 'VALIDATION_ERROR', 'Return tick exceeds the supported clock');
    if (state.metadata(p).absences.length >= 1024) throw new ApiError(409, 'TECHNICIAN_AVAILABILITY_LIMIT', 'Session absence history limit reached');
  } else if (!active) throw new ApiError(409, 'TECHNICIAN_NOT_ABSENT', 'Technician is not currently absent');
}
function plan(p, index, input, actor, type) {
  const metadata = structuredClone(state.metadata(p)), tick = p.primary.state.tick, eventId = crypto.randomUUID();
  if (type === 'absence') metadata.absences.push({ eventId, automaticEndEventId: crypto.randomUUID(), technicianIndex: index,
    startTick: tick, returnTick: tick + input.durationTicks, endedTick: null, endedByEventId: null });
  else Object.assign(metadata.absences.find(a => a.eventId === state.active(p, index).eventId), { endedTick: tick, endedByEventId: eventId });
  metadata.version++;
  metadata.origin = { eventId, tick, workforceVersion: metadata.version };
  metadata.events.push({ eventId, technicianIndex: index, type: type === 'absence' ? 'ABSENCE_STARTED' : 'ABSENCE_RETURNED_EARLY',
    tick, actor: { type: 'USER', userId: actor.id }, reason: input.reason });
  return metadata;
}
async function change(user, id, index, input, key, type) {
  return writes.write(user, key, `technician.${type}:${id}:${index}`, input, (tx, actor) => writes.session(tx, actor, id),
    async (row, actor) => {
      check(row, index, input, type);
      const metadata = plan(row.payloadJson, index, input, actor, type);
      const output = await invoke('demo_technician_change', { session: row.payloadJson, metadata });
      const expected = structuredClone(row.payloadJson);
      Object.assign(expected, { technicianAvailability: metadata, pending: null, status: 'RUNNING', playbackPaused: true });
      for (const field of ['review_deferral', 'reviewDeferral', 'deferred_review']) if (field in expected) expected[field] = null;
      if (!state.same(output.session, expected)) throw invalid();
      return output.session;
    }, async (tx, actor, row, payloadJson) => {
      check(row, index, input, type);
      const updated = await tx.demoSession.update({ where: { id }, data: { payloadJson, revision: { increment: 1 }, lastCommandKey: null, lastCommandHash: null } });
      const event = payloadJson.technicianAvailability.events.at(-1);
      await writes.audit(tx, actor, id, `DEMO_${event.type}`, { ...event, revision: updated.revision,
        absence: payloadJson.technicianAvailability.absences.find(a => a.eventId === event.eventId || a.endedByEventId === event.eventId),
        workforceVersion: payloadJson.technicianAvailability.version });
      return { ...state.present(updated), session: require('./demo-service').present(updated) };
    });
}
module.exports = { protocol, invoke, absenceSchema, returnSchema, indexSchema, change, present: state.present };
