import type { MachineHealth } from '@/types/generated/simulation-machine-health';
import type { Simulation } from '@/lib/simulation/types';
import { serviceEvidence } from '@/lib/simulation/service-records';
import { serviceDuration, simulationTime } from '@/lib/simulation/clock';

export function MachineServices({ health, session }: { health: MachineHealth; session: Simulation }) {
  const records = serviceEvidence(health, session.primary);
  const time = (tick: number | null) => tick === null ? 'Not retained' : `t${tick} · ${simulationTime(session, tick).time}`;
  return <section className="sim-health-section" aria-labelledby="machine-services-title">
    <h3 id="machine-services-title">Maintenance work and history</h3>
    <p className="sim-footnote">Physical service records for this session and machine. Completing one service does not establish that all components are healthy.</p>
    {records.length ? <ul className="sim-service-list">{records.map(record => <li key={record.id} className="sim-service-card" data-testid="service-record" data-evidence-id={record.id}>
      <header><strong>{record.technician === null ? 'Technician not provided' : `T${record.technician + 1}`} · C{record.component + 1} · {record.kind ?? 'Kind not provided'}</strong><span className="sim-twin-status" data-status={record.active ? 'In service' : record.completion !== null ? 'Working' : 'Unknown'}>{record.active ? 'In progress' : record.completion !== null ? 'Completed' : 'Outcome not retained'}</span></header>
      <dl><div><dt>Time remaining</dt><dd>{record.remaining === null ? 'Not applicable' : serviceDuration(record.remaining, health.stepSeconds)}</dd></div><div><dt>Started</dt><dd>{time(record.start)}</dd></div><div><dt>Completed</dt><dd>{record.completion === null ? 'Not recorded' : time(record.completion)}</dd></div><div><dt>Wait before service</dt><dd>{record.wait === null ? 'Not provided' : serviceDuration(record.wait, health.stepSeconds)}</dd></div></dl>
    </li>)}</ul> : <p className="sim-inspection-note">No maintenance work recorded for this machine in the available session history. A deferred decision does not create a service.</p>}
    {health.history.truncated && <p className="sim-footnote">Partial history: older service starts, completions or waiting times may be unavailable.</p>}
  </section>;
}
