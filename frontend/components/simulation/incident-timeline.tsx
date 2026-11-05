import type { DemoIncident } from '@/types/generated/demo-read';
import type { Simulation } from '@/lib/simulation/types';
import { matchingLabel } from '@/lib/simulation/types';

export function IncidentTimeline({incident, session}: {incident: DemoIncident; session: Simulation}) {
  const related = session.pending?.action.some(([machine, component]) => machine === incident.simulatorMachineIndex && component === incident.simulatorComponentIndex);
  const confirmation = incident.decisions.find(decision => session.decisions[decision.decisionIndex]?.proposed_action.some(([machine, component]) => machine === incident.simulatorMachineIndex && component === incident.simulatorComponentIndex));
  const linkedTick = related ? session.pending?.tick : confirmation?.tick;
  const proposal = linkedTick === undefined ? undefined : session.workflow.findLast(entry => entry.tick === linkedTick && entry.stage === 'POLICY');
  const started = incident.timeline.find(event => event.type === 'start' && event.kind === 'CM');
  const completed = incident.timeline.find(event => event.type === 'completion' && event.kind === 'CM');
  return <section aria-label="Incident timeline"><h3>Incident timeline · {incident.machineId}/{incident.componentId}</h3>
    <p className="sim-footnote">Failure timestamps belong to this incident. The machine profile shows the current session boundary; another component may still be failed.</p>
    <ol className="live-timeline">
      <li><strong>Failure · tick {incident.failure.tick}</strong><p>Record {incident.failure.recordIndex}, event {incident.failure.eventIndex}</p></li>
      <li className={!proposal ? 'is-pending' : ''}><strong>Policy proposal / review{proposal ? ` · tick ${proposal.tick}` : ' · Not linked'}</strong><p>{proposal?.message ?? 'No linked proposal evidence is supplied for this incident.'}</p></li>
      <li className={!incident.decisions.length ? 'is-pending' : ''}><strong>Confirmation{!incident.decisions.length && ' · Pending / no linked evidence'}</strong>{incident.decisions.map(decision => <p key={decision.decisionIndex}>Tick {decision.tick} · {decision.actor} · {decision.override ? 'Human override' : 'Policy accepted'} · {matchingLabel(decision.action)}<br/>{decision.reason}</p>)}</li>
      <li className={!started ? 'is-pending' : ''}><strong>Start CM{started ? ` · tick ${started.tick}` : ' · Pending'}</strong>{started && <p>{started.technicianId} · {started.durationTicks} ticks service</p>}</li>
      <li className={!completed ? 'is-pending' : ''}><strong>Completion{completed ? ` · tick ${completed.tick}` : ' · Pending'}</strong>{completed && <p>{completed.technicianId} · record {completed.recordIndex}, event {completed.eventIndex}</p>}</li>
    </ol>
  </section>;
}
