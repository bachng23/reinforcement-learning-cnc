'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { ReviewDialog } from '@/components/research/review-dialog';
import { factoryLayouts, type FactoryLayout } from '@/lib/simulation/factory-layouts';
import type { Config } from '@/types/generated/jcst';
import { serviceDuration, simulationTime } from '@/lib/simulation/clock';
import type { Simulation, Lane, Matching } from '@/lib/simulation/types';
import { useMachineInspection } from '@/lib/simulation/use-machine-inspection';
import { useWorkspaceUser } from '@/lib/workspace-user';
import { ComponentHealth } from './component-health';
import { MachineServices } from './machine-services';

// Presentation labels never enter JCST policy observations.
export const demoMachines = factoryLayouts[0].stations.map((station, index) => ({
  name: station.name, operation: station.operation, product: factoryLayouts[0].product,
  batch: 'Current simulation', position: `${factoryLayouts[0].name} · Station ${index + 1}`,
}));

export function MachineDetail({ machine, lane, config, proposal, onClose, decisionAction, clockSession, layout,
  session, onSelectMachine, onReload }: {
  layout?: FactoryLayout; clockSession?: Pick<Simulation, 'simulation_start' | 'step_seconds'>;
  session?: Simulation; machine: number; lane: Lane; config: Config; proposal: Matching;
  onClose: () => void; decisionAction?: ReactNode; onSelectMachine?: (machine: number) => void; onReload?: () => void;
}) {
  const read = useMachineInspection(session, machine);
  const user = useWorkspaceUser();
  const context = read.context;
  const shownLane = context?.snapshot.primary ?? lane;
  const clock = context?.snapshot ?? clockSession ?? {};
  const info = layout ? { ...layout.stations[machine], product: layout.product, batch: 'Current simulation',
    position: `${layout.name} · Station ${machine + 1}` } : demoMachines[machine];
  const components = shownLane.state.components[machine] ?? [];
  const job = shownLane.state.jobs.find(item => item?.machine === machine);
  const next = proposal.find(item => item[0] === machine);
  const status = job ? 'In service' : components.some(item => item.failed) ? 'Breakdown' : 'Working';
  const title = `machine-detail-${machine}`;
  return <ReviewDialog labelledBy={title} busy={false} onClose={onClose}><div className="sim-machine-detail">
    <header><div><p className="research-eyebrow">Machine M{machine + 1} · {status} · {simulationTime(clock, shownLane.state.tick).time}</p><h2 id={title}>{info?.name ?? `Machine M${machine + 1}`}</h2></div><button className="sim-button" aria-label="Close machine details" onClick={onClose}><X size={17} aria-hidden="true" /></button></header>
    {onSelectMachine && <label className="sim-field sim-inspect-picker">Inspect machine<select value={machine} onChange={event => onSelectMachine(Number(event.target.value))}>{lane.state.components.map((_, index) => <option key={index} value={index}>M{index + 1} · {layout?.stations[index]?.name ?? demoMachines[index]?.name ?? 'Machine'}</option>)}</select></label>}
    <div className="sim-component-chips" aria-label="Current components">{components.map((item, index) => <span key={index} data-failed={item.failed}>C{index + 1} · {item.failed ? 'FAILED' : 'Healthy'}</span>)}</div>
    {session && <p className="sim-footnote">Session {session.id} · revision {context?.snapshot.revision ?? session.revision} · t{shownLane.state.tick}</p>}
    {job && <p className="sim-current-service"><strong>T{job.technician + 1} · C{job.component + 1} · {job.kind}</strong><span>In progress · {serviceDuration(job.remaining, clock.step_seconds)} remaining</span></p>}
    {read.loading && <p role="status" className="sim-inspection-note">{context ? `Updating history to revision ${session?.revision}. Showing the last consistent snapshot.` : 'Loading machine health and maintenance history…'}</p>}
    {read.error && <div role="alert" className="sim-error"><p>{read.error}</p><div className="sim-inspection-retry"><button onClick={read.retry}>Retry machine history</button>{onReload && <button onClick={onReload}>Reload session</button>}</div></div>}
    {decisionAction && user?.role !== 'VIEWER' && <div className="sim-machine-decision">{decisionAction}</div>}
    {context && <><ComponentHealth key={`${context.health.sessionId}:${machine}`} health={context.health} session={context.snapshot} /><MachineServices workOrders={context.workOrders} session={context.snapshot} /></>}
    {!session && <p className="sim-footnote">Open a persisted simulator session to read component risk and maintenance history.</p>}
    <details className="sim-compatibility"><summary>Production context</summary><dl className="sim-machine-facts"><div><dt>Production line</dt><dd>{info ? 'Line P1' : 'Not configured'}</dd></div><div><dt>Operation</dt><dd>{info?.operation ?? 'Not configured'}</dd></div><div><dt>Assigned batch</dt><dd>{info?.batch ?? 'Not configured'}</dd></div><div><dt>Product</dt><dd>{info?.product ?? 'Not configured'}</dd></div><div><dt>Factory location</dt><dd>{info?.position ?? 'Not configured'}</dd></div><div><dt>Current service</dt><dd>{job ? `T${job.technician + 1} · ${job.kind} · ${serviceDuration(job.remaining, clock.step_seconds)} left` : next ? `Proposed T${next[2] + 1} → C${next[1] + 1}` : 'No technician assigned'}</dd></div></dl></details>
    <details className="sim-compatibility"><summary>Component ages and technician qualifications</summary><div className="sim-table-scroll"><table className="sim-metrics-table"><thead><tr><th>Component</th><th>Condition</th><th>Age</th><th>Service time by technician</th></tr></thead><tbody>{components.map((item, index) => <tr key={index}><th>C{index + 1}</th><td>{item.failed ? 'FAILED' : 'Healthy'}</td><td>{serviceDuration(item.age, clockSession?.step_seconds)}</td><td>{config.duration[machine]?.[index]?.map((duration, technician) => `T${technician + 1}: ${duration ? serviceDuration(duration, clockSession?.step_seconds) : 'not qualified'}`).join(' · ')}</td></tr>)}</tbody></table></div></details>
  </div></ReviewDialog>;
}
