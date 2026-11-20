// Consumer fixtures only. No claim about runtime inference/physical semantics.
import examples from './fixtures/technicians/producer-examples.json';
import {sourceSession} from './situation-fixtures';
import type {Simulation} from '@/lib/simulation/types';
import type {TechnicianCalendar,TechniciansResponse} from '@/types/generated/simulation-technicians';
export const eventId='10000000-0000-4000-8000-000000000001';
export function workforce(state:'AVAILABLE'|'BUSY'|'ABSENT'='AVAILABLE'):TechniciansResponse{return structuredClone(examples[state].data) as TechniciansResponse;}
export function technicianSession(state:'AVAILABLE'|'BUSY'|'ABSENT'='AVAILABLE'):Simulation{
  const data=workforce(state),base=sourceSession(6);
  const calendar:TechnicianCalendar={schemaVersion:'jcst-technician-availability/1',version:state==='ABSENT'?1:0,origin:data.comparisonContext.origin,
    absences:state==='ABSENT'?[{eventId,automaticEndEventId:'10000000-0000-4000-8000-000000000099',technicianIndex:0,startTick:5,returnTick:8,endedTick:null,endedByEventId:null}]:[],
    events:state==='ABSENT'?[structuredClone(examples.event) as TechnicianCalendar['events'][number]]:[]};
  return {...base,id:data.sessionId,sessionId:data.sessionId,revision:data.revision,tick:data.tick,stepSeconds:data.stepSeconds,step_seconds:data.stepSeconds,
    primary:{...base.primary,state:{...base.primary.state,tick:data.tick,jobs:data.technicians.map(t=>t.currentJob)}},
    baseline:{...base.baseline,state:{...base.baseline.state,tick:data.tick,jobs:[null,null]}},
    technicianAvailability:calendar,technicians:data.technicians,comparisonContext:data.comparisonContext,status:'RUNNING',pending:null};
}
export function commandResponse(session:Simulation){return {session,sessionId:session.id,revision:session.revision,tick:session.primary.state.tick,stepSeconds:session.stepSeconds!,lane:'primary' as const,technicians:session.technicians!,comparisonContext:session.comparisonContext!};}
export function returnedSession():Simulation{
  const session=technicianSession('ABSENT');session.revision++;session.playbackPaused=true;
  session.technicians=workforce().technicians;
  const event={eventId:'10000000-0000-4000-8000-000000000088',technicianIndex:0,type:'ABSENCE_RETURNED_EARLY' as const,tick:5,actor:{type:'USER' as const,userId:'10000000-0000-4000-8000-000000000002'},reason:'Returned early'};
  session.technicianAvailability!.version++;session.technicianAvailability!.events.push(event);
  Object.assign(session.technicianAvailability!.absences[0],{endedTick:5,endedByEventId:event.eventId});
  session.comparisonContext={...session.comparisonContext!,workforceVersion:2,origin:{eventId:event.eventId,tick:5,workforceVersion:2},cacheIdentity:'f'.repeat(64)};
  session.technicianAvailability!.origin=session.comparisonContext.origin;
  return session;
}
