import type {Simulation} from '@/lib/simulation/types';
import {simulationTime} from '@/lib/simulation/clock';
import {embeddedTechnicians} from '@/lib/simulation/technicians';
const labels={ABSENCE_STARTED:'Absence started',ABSENCE_ENDED:'Absence ended',ABSENCE_RETURNED_EARLY:'Returned early'};
export function TechnicianActivity({session,onInspect}:{session:Simulation;onInspect:(index:number)=>void}){
  if(session.technicianAvailability){try{if(!embeddedTechnicians(session))return <p role="status" className="sim-footnote">Workforce history is waiting for a synchronized technician snapshot.</p>;}catch{return <p role="alert" className="sim-error">Workforce history does not match the current snapshot. Refresh the session.</p>;}}
  const events=session.technicianAvailability?.events;
  return <section className="sim-technician-activity" aria-label="Workforce activity"><h3>Workforce activity</h3>
    {events?.length?<ol className="sim-decision-history">{events.slice().reverse().map(event=><li key={event.eventId}><strong>T{event.technicianIndex+1} · {labels[event.type]}</strong><p>{simulationTime(session,event.tick).date} · {simulationTime(session,event.tick).time} · t{event.tick}</p><p>{event.reason}</p><p>Actor: {event.actor.type==='SYSTEM'?'System':event.actor.userId}</p><button className="sim-button" onClick={()=>onInspect(event.technicianIndex)}>Inspect T{event.technicianIndex+1}</button></li>)}</ol>:<p className="sim-footnote">{events?'No availability changes recorded.':'No absence history was provided for this session.'}</p>}
  </section>;
}
