import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';
import type { DemoObservationRead } from '@/types/generated/demo-read';

export const machineStateLabel = {WORKING: 'Working', BREAKDOWN: 'Breakdown', IN_SERVICE: 'In service'} as const;
export function FactoryMap({observation, onInspect}: {observation: DemoObservationRead; onInspect: (id: string) => void}) {
  const context = observation.context;
  const layout = context?.layout;
  const placed = !!layout && layout.columns > 0 && layout.rows > 0 && observation.machines.every(machine => {
    const location = context?.machines.find(profile => profile.machineId === machine.machineId)?.location;
    return !!location && location.x >= 0 && location.y >= 0 && location.x < layout.columns && location.y < layout.rows;
  });
  return <>
    <p className="sim-inline-note">{context ? `Illustrative factory context · ${context.contextVersion}. Line, batch and positions are presentation metadata, not MES production or simulated travel.` : 'Factory context not available for this session. Machine list shown without invented positions.'}</p>
    {context && <div className="live-production-lines" aria-label="Production sequence">{context.lines.map(line => <p key={line.lineId}><strong>{line.lineId} · {line.name}</strong><span>{line.machineIds.join(' → ')}</span></p>)}</div>}
    {!placed && context && <p role="status" className="sim-footnote">Layout unavailable. Positions have not been assigned by the frontend.</p>}
    <div className={placed ? 'live-factory-map' : 'live-machine-list'} aria-label={placed ? 'Factory schematic from API coordinates' : 'Machine list'} style={placed ? {gridTemplateColumns: `repeat(${layout.columns}, minmax(160px, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, minmax(105px, auto))`} : undefined}>
      {observation.machines.map(machine => {
        const profile = context?.machines.find(item => item.machineId === machine.machineId);
        const Icon = machine.machineState === 'IN_SERVICE' ? Wrench : machine.machineState === 'BREAKDOWN' ? AlertTriangle : CheckCircle2;
        return <button type="button" className={`live-map-machine state-${machine.machineState}`} key={machine.machineId} aria-label={`Inspect machine ${machine.machineId}`} onClick={() => onInspect(machine.machineId)} style={placed && profile ? {gridColumn: profile.location.x + 1, gridRow: profile.location.y + 1} : undefined}>
          <span className="live-map-title"><strong>{machine.machineId}</strong><Icon size={17} aria-hidden="true" />{machineStateLabel[machine.machineState]}</span>
          <span>{profile?.name ?? 'Machine context not provided'}</span>
          {profile && <small>Zone {profile.location.zone} · Bay {profile.location.bay} · {profile.operation}</small>}
          <span>{machine.components.filter(component => component.failed).length} failed components</span>
          {machine.currentJobs.map(job => <small key={job.technicianId}>{job.technicianId} → {job.componentId} · {job.kind} · {job.remainingTicks} ticks left</small>)}
        </button>;
      })}
    </div>
    {!observation.machines.length && <p role="status">No machines returned for this session revision.</p>}
  </>;
}
