import Link from 'next/link';
import { X } from 'lucide-react';
import { ReviewDialog } from '@/components/research/review-dialog';
import { liveApi } from '@/lib/simulation/live-api';
import { useLiveRead } from '@/lib/simulation/use-live-read';
import type { Simulation } from '@/lib/simulation/types';
import type { DemoIncident } from '@/types/generated/demo-read';
import { machineStateLabel } from './factory-map';
import { IncidentTimeline } from './incident-timeline';
import { incidentStatusLabel } from './incident-center';

export function MachineDetail({session, machine, incident, incidents, onInspectIncident, onClose, onPrepare, canPrepare}: {
  session: Simulation; machine?: string; incident?: string; incidents: DemoIncident[];
  onInspectIncident: (incident: DemoIncident) => void; onClose: () => void; onPrepare: () => void; canPrepare: boolean;
}) {
  const prefix = `${session.id}:${session.revision}`;
  const selected = useLiveRead(incident ? `${prefix}:incident:${incident}` : undefined, signal => liveApi.incident(session.id, session.revision, incident!, signal));
  const id = machine ?? selected.data?.incident.machineId;
  const detail = useLiveRead(id ? `${prefix}:machine:${id}` : undefined, signal => liveApi.machine(session.id, session.revision, id!, signal));
  const data = detail.data;
  const mismatch = !!selected.data && !!id && selected.data.incident.machineId !== id;
  const query = new URLSearchParams({session: session.id}); if (id) query.set('machine', id); if (incident) query.set('incident', incident);
  return <ReviewDialog labelledBy="live-machine-title" busy={false} onClose={onClose}><div className="sim-machine-detail">
    <header><div><p className="research-eyebrow">Session revision {session.revision} · current tick {session.primary.state.tick}</p><h2 id="live-machine-title">{data?.profile?.name ?? (id ? `Machine ${id}` : 'Incident details')}</h2></div><button className="sim-button" aria-label="Close machine details" onClick={onClose}><X size={17} aria-hidden="true" /></button></header>
    {mismatch ? <p role="alert" className="sim-error">Selected incident does not belong to this machine. Close and select the incident again.</p> : <>
      {incident && selected.loading && <p role="status">Loading incident evidence…</p>}
      {selected.error !== undefined && <div role="alert" className="sim-error">{selected.message}<button onClick={selected.retry}>Retry incident</button></div>}
      {detail.loading && <p role="status">Loading machine profile…</p>}
      {detail.error !== undefined && <div role="alert" className="sim-error">{detail.message}<button onClick={detail.retry}>Retry machine</button></div>}
      {data && <>
        <p className="sim-inline-note">{data.contextOrigin === 'ILLUSTRATIVE_DEMO' ? `Illustrative factory context · ${data.contextVersion}. Batch/line metadata is not actual production simulation or MES. State and service history below come from this simulator revision.` : 'Machine context not available. Simulator state remains available; no sample profile is substituted.'}</p>
        <dl className="sim-machine-facts"><div><dt>Machine / current state</dt><dd>{data.machineId} · {machineStateLabel[data.machineState]}</dd></div><div><dt>Machine type</dt><dd>{data.profile?.type ?? 'Not provided'}</dd></div><div><dt>Production line</dt><dd>{data.profile ? `${data.profile.lineId} · ${data.context?.lines.find(line => line.lineId === data.profile?.lineId)?.name ?? ''}` : 'Not provided'}</dd></div><div><dt>Operation</dt><dd>{data.profile?.operation ?? 'Not provided'}</dd></div><div><dt>Assigned illustrative batch / product</dt><dd>{data.assignedBatch ? `${data.assignedBatch.batchId} · ${data.assignedBatch.productName}` : 'Not provided'}</dd></div><div><dt>Location</dt><dd>{data.profile ? `Zone ${data.profile.location.zone} · Bay ${data.profile.location.bay}` : 'Not provided'}</dd></div>
          {data.assignedBatch?.quantity != null && <div><dt>Quantity</dt><dd>{data.assignedBatch.quantity}</dd></div>}{data.assignedBatch?.dueAt && <div><dt>Deadline</dt><dd>{data.assignedBatch.dueAt}</dd></div>}
        </dl>
        <h3>Current technician commitments</h3>{data.currentJobs.length ? data.currentJobs.map(job => <p key={job.technicianId}>{job.technicianId} → {data.machineId}/{job.componentId} · {job.kind} · {job.remainingTicks} ticks remaining</p>) : <p className="sim-footnote">No technician assigned at this boundary.</p>}
        <h3>Live simulator components</h3><div className="sim-table-scroll"><table className="sim-metrics-table"><thead><tr><th>Component</th><th>Condition</th><th>Age</th><th>Qualified service durations</th></tr></thead><tbody>{!data.components.length && <tr><td colSpan={4}>No component state provided for this machine.</td></tr>}{data.components.map((component, index) => <tr key={component.componentId}><th>{component.componentId}</th><td>{component.failed ? 'FAILED' : 'Healthy'}</td><td>{component.ageTicks} ticks</td><td>{session.config.duration[data.simulatorMachineIndex][index].map((duration, technician) => `T${technician + 1}: ${duration ? `${duration} ticks` : 'not qualified'}`).join(' · ')}</td></tr>)}</tbody></table></div>
        <h3>Incidents on this machine</h3><ul className="live-machine-incidents">{incidents.filter(item => item.machineId === id).map(item => <li key={item.incidentId}><button className="sim-button" aria-current={item.incidentId === incident ? 'true' : undefined} onClick={() => onInspectIncident(item)}>{item.componentId} · failure tick {item.openedAtTick} · {incidentStatusLabel[item.status]}</button></li>)}</ul>
        {!data.incidentIds.length && <p className="sim-footnote">No recorded incidents for this machine.</p>}
        <h3>Service history</h3>{!data.maintenanceHistory.length ? <p className="sim-footnote">No recorded services yet.</p> : <div className="sim-table-scroll"><table className="sim-metrics-table"><thead><tr><th>Service</th><th>Technician</th><th>Start</th><th>Duration</th><th>Completion</th></tr></thead><tbody>{data.maintenanceHistory.map(service => <tr key={service.serviceId}><th>{service.componentId} · {service.kind}</th><td>{service.technicianId}</td><td>Tick {service.startedAtTick}</td><td>{service.durationTicks} ticks</td><td>{service.completedAtTick === null ? 'Pending' : `Tick ${service.completedAtTick}`}</td></tr>)}</tbody></table></div>}
      </>}
      {selected.data && <IncidentTimeline incident={selected.data.incident} session={session} />}
      <div className="live-detail-actions">{session.status === 'RUNNING' && <button className="sim-button" disabled={!canPrepare} onClick={onPrepare}>Request policy proposal / step</button>}{session.status === 'REVIEW' && <Link className="research-primary" href={`/decisions?${query}`}>Review full matching</Link>}</div>
      <p className="sim-footnote">A policy step may advance one interval if only WAIT is legal. Reading this dialog never sends a command.</p>
    </>}
  </div></ReviewDialog>;
}
