// M1 contract double. This is deliberately NOT a physical simulator or an M2
// acceptance fixture. Production has no fallback to this module.
const { protocol } = { protocol: 'jcst-situations/1' };
function apply(session, event) {
  const tick = session.primary.state.tick;
  if (event.status !== 'SCHEDULED' || event.scheduledTick !== tick) return;
  const busy = session.primary.state.jobs.some(j => j?.machine === event.machineIndex);
  const failed = session.primary.state.components[event.machineIndex].some(c => c.failed);
  event.appliedTick = tick;
  event.status = busy || failed ? 'SKIPPED' : 'APPLIED';
  event.reason = busy ? 'MACHINE_IN_SERVICE' : failed ? 'COMPONENT_ALREADY_FAILED' : null;
  if (event.status === 'APPLIED') session.primary.state.components[event.machineIndex][event.componentIndex].failed = true;
}
async function bridge(request) {
  if (request.operation === 'demo_snapshot_restore') return { protocol, session: structuredClone(request.snapshot.runtime) };
  const session = structuredClone(request.session);
  if (request.operation === 'demo_incident') {
    const event = structuredClone(request.event);
    (session.incidents ??= []).push(event); apply(session, event);
    return { protocol, session, event };
  }
  if (request.operation !== 'demo_situation_command') throw Error('Only situation protocol is mocked');
  const command = request.command;
  if (command.command === 'configure') {
    session.primary.controller = command.primary; session.baseline.controller = command.baseline;
    session.continuous = true; session.status = 'RUNNING'; session.pending = null;
  } else {
    const count = command.command === 'autoplay' ? command.maxTicks : 1;
    for (let i = 0; i < count; i++) {
      for (const event of session.incidents ?? []) apply(session, event);
      for (const lane of [session.primary, session.baseline]) {
        const before = structuredClone(lane.state); lane.state.tick++;
        lane.state.components.forEach(cs => cs.forEach(c => { if (!c.failed) c.age++; }));
        lane.records.push({ tick: before.tick, before, after: structuredClone(lane.state), events: [] });
        lane.records = lane.records.slice(-256);
      }
      for (const event of session.incidents ?? []) apply(session, event);
    }
    session.pending = null; session.status = 'RUNNING';
  }
  return { protocol, session };
}
module.exports = { bridge };
