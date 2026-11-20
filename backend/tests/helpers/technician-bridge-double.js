// M1 protocol double only: no policy inference, scientific physics or M2 claim.
const { bridge: situation } = require('./situation-bridge-double');
const protocol = 'jcst-technicians/1';
function expire(session) {
  const m = session.technicianAvailability, tick = session.primary.state.tick;
  for (const a of m.absences) {
    if (a.endedTick !== null || a.returnTick !== tick) continue;
    a.endedTick = tick; a.endedByEventId = a.automaticEndEventId;
    m.events.push({ eventId: a.automaticEndEventId, technicianIndex: a.technicianIndex, type: 'ABSENCE_ENDED',
      tick, actor: { type: 'SYSTEM', userId: null }, reason: 'Absence interval elapsed' });
  }
}
async function bridge(input) {
  if (input.operation === 'demo_technician_change') {
    const session = structuredClone(input.session);
    Object.assign(session, { technicianAvailability: structuredClone(input.metadata), pending: null, status: 'RUNNING', playbackPaused: true });
    for (const key of ['review_deferral', 'reviewDeferral', 'deferred_review']) if (key in session) session[key] = null;
    return { protocol, session };
  }
  if (input.operation === 'demo_technician_restore') return { protocol, session: structuredClone(input.snapshot.runtime) };
  if (input.operation === 'demo_technician_incident') return { ...await situation({ ...input, operation: 'demo_incident' }), protocol };
  if (input.operation !== 'demo_technician_command') return situation(input);
  let session = structuredClone(input.session);
  if (input.command.command === 'configure') return { ...await situation({ ...input, operation: 'demo_situation_command' }), protocol };
  const steps = input.command.command === 'autoplay' ? input.command.maxTicks : 1;
  for (let i = 0; i < steps; i++) {
    session = (await situation({ ...input, operation: 'demo_situation_command', session, command: { command: 'advance' } })).session;
    for (const lane of [session.primary, session.baseline]) {
      lane.state.jobs = lane.state.jobs.map(j => !j || j.remaining === 1 ? null : { ...j, remaining: j.remaining - 1 });
      lane.records.at(-1).after.jobs = structuredClone(lane.state.jobs);
    }
    expire(session);
  }
  return { protocol, session };
}
module.exports = { bridge };
