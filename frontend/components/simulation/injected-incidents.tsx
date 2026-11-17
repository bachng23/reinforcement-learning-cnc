import type {Simulation} from '@/lib/simulation/types';
import {simulationTime} from '@/lib/simulation/clock';
import type {IncidentRead} from '@/lib/simulation/use-session-incidents';

export function InjectedIncidents({session,read,onInspect,machine}:{session:Simulation;read:IncidentRead;onInspect:(machine:number)=>void;machine?:number}){
  if(!session.branch)return null;
  const events=read.data?.events.filter(event=>machine===undefined||event.machineIndex===machine)??[];
  return <section className="sim-injected-incidents" aria-label="Injected incidents"><h3>Injected incidents</h3>
    {read.loading&&<p role="status" className="sim-footnote">Updating the incident queue…</p>}
    {read.error&&<div role="alert" className="sim-error">{read.error}<button onClick={read.retry}>Retry incident queue</button></div>}
    {!read.loading&&!read.error&&!events.length&&<p className="sim-footnote">No injected incidents in this session{machine===undefined?'':` for M${machine+1}`}.</p>}
    <ul>{events.map(event=><li key={event.eventId} data-status={event.status}><button className="sim-incident-target" onClick={()=>onInspect(event.machineIndex)}><strong>M{event.machineIndex+1}/C{event.componentIndex+1}</strong><span>Injected incident · {event.status}</span></button><p>Scheduled t{event.scheduledTick} · {simulationTime(session,event.scheduledTick).time}{event.appliedTick===null?'':` · processed t${event.appliedTick}`}</p><p>{event.requestedReason}</p>{event.reason&&<p>{event.reason==='MACHINE_IN_SERVICE'?'Skipped: machine is in maintenance.':'Skipped: a component is already failed on this machine.'}</p>}<p className="sim-footnote">Created by {event.createdBy}</p></li>)}</ul>
  </section>;
}
