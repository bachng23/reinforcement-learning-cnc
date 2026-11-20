import {researchRequest} from '@/lib/research-api/client';
import type {ReturnEarly, StartAbsence, TechnicianCommandResponse, TechnicianSummary, TechniciansResponse} from '@/types/generated/simulation-technicians';
import type {Simulation} from './types';

export class TechnicianContextError extends Error {
  readonly code='TECHNICIAN_CONTEXT_MISMATCH';
  constructor(){super('Technician data does not match this session snapshot. Refresh before continuing.');}
}
/** POST was acknowledged but the authoritative follow-up read failed. Keep its receipt key. */
export class TechnicianRecoveryError extends Error {
  readonly outcomeUnknown=true;
  readonly status?:number;readonly code?:string;
  constructor(error:unknown){super('The availability change needs authoritative outcome recovery.');const cause=(error??{}) as {status?:number;code?:string;name?:string};this.status=cause.status;this.code=cause.code;this.name=cause.name??'TechnicianRecoveryError';}
}
const integer=(n:number)=>Number.isInteger(n)&&n>=0&&n<=2147483647;
const hash=(s:string)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export function validateTechnicians(data:TechniciansResponse, session:Simulation){
  const jobs=session.primary.state.jobs;
  if(!data||data.sessionId!==session.id||data.revision!==session.revision||data.tick!==session.primary.state.tick||!integer(data.revision)||!integer(data.tick)||
    (session.sessionId!==undefined&&session.sessionId!==session.id)||(session.tick!==undefined&&session.tick!==data.tick)||session.baseline.state.tick!==data.tick||
    data.lane!=='primary'||!Number.isFinite(data.stepSeconds)||data.stepSeconds<=0||data.stepSeconds!==session.step_seconds||
    !Array.isArray(data.technicians)||data.technicians.length!==jobs.length||
    session.config.duration.some(machine=>machine.some(row=>row.length!==jobs.length)))throw new TechnicianContextError();
  for(const [index,row] of data.technicians.entries()){
    const job=jobs[index], a=row?.activeAbsence;
    if(!row||row.technicianIndex!==index||!['AVAILABLE','BUSY','ABSENT'].includes(row.availability)||
      (a!==null&&(!a||!a.eventId||!integer(a.startTick)||!integer(a.returnTick)||a.startTick>data.tick||a.returnTick<=data.tick))||
      row.returnTick!==(a?.returnTick??null)||row.availability!==(job?'BUSY':a?'ABSENT':'AVAILABLE')||
      (job ? !row.currentJob||job.technician!==index||!session.primary.state.components[job.machine]?.[job.component]||!integer(job.remaining)||!['PM','CM'].includes(job.kind)||(['machine','component','technician','kind','remaining'] as const).some(key=>row.currentJob?.[key]!==job[key]) : row.currentJob!==null))throw new TechnicianContextError();
  }
  const c=data.comparisonContext;
  if(!c||!integer(c.workforceVersion)||!hash(c.workforceHash)||!hash(c.cacheIdentity)||
    c.requiresCommonSnapshot!==(c.workforceVersion>0)||
    (c.workforceVersion>0? !c.origin||!c.origin.eventId||!integer(c.origin.tick)||c.origin.tick>data.tick||c.origin.workforceVersion!==c.workforceVersion : c.origin!==null))throw new TechnicianContextError();
  const calendar=session.technicianAvailability;
  if(calendar){
    if(calendar.schemaVersion!=='jcst-technician-availability/1'||calendar.version!==c.workforceVersion||!Array.isArray(calendar.events)||!Array.isArray(calendar.absences)||
      (calendar.origin?.eventId??null)!==(c.origin?.eventId??null)||(calendar.origin?.tick??null)!==(c.origin?.tick??null)||(calendar.origin?.workforceVersion??null)!==(c.origin?.workforceVersion??null)||new Set(calendar.events.map(e=>e.eventId)).size!==calendar.events.length||calendar.events.some(e=>!e.eventId||!integer(e.tick)||e.tick>data.tick||!integer(e.technicianIndex)||e.technicianIndex>=jobs.length||
        !['ABSENCE_STARTED','ABSENCE_ENDED','ABSENCE_RETURNED_EARLY'].includes(e.type)||!e.reason||!e.actor||!['USER','SYSTEM'].includes(e.actor.type)))throw new TechnicianContextError();
    for(const row of data.technicians){
      const active=calendar.absences.filter(a=>a.technicianIndex===row.technicianIndex&&a.startTick<=data.tick&&data.tick<(a.endedTick??a.returnTick));
      if(active.length>1||Boolean(active.length)!==Boolean(row.activeAbsence)||active.some(a=>a.eventId!==row.activeAbsence?.eventId||a.startTick!==row.activeAbsence.startTick||a.returnTick!==row.returnTick))throw new TechnicianContextError();
    }
    if(calendar.absences.some(a=>!integer(a.technicianIndex)||a.technicianIndex>=jobs.length||!integer(a.startTick)||!integer(a.returnTick)||a.returnTick<=a.startTick||!calendar.events.some(e=>e.eventId===a.eventId&&e.technicianIndex===a.technicianIndex&&e.type==='ABSENCE_STARTED'&&e.tick===a.startTick)))throw new TechnicianContextError();
  }else if(c.workforceVersion!==0||data.technicians.some(row=>row.activeAbsence))throw new TechnicianContextError();
  return data;
}
export function embeddedTechnicians(session:Simulation):TechniciansResponse|undefined{
  if(session.technicians===undefined&&session.comparisonContext===undefined)return;
  return validateTechnicians({sessionId:session.id,revision:session.revision,tick:session.primary.state.tick,stepSeconds:session.stepSeconds!,lane:'primary',technicians:session.technicians!,comparisonContext:session.comparisonContext!},session);
}
// Compatibility for a legacy session without any absence metadata; jobs remain authoritative.
export function legacyTechnicians(session:Simulation):TechnicianSummary[]{
  if(session.technicianAvailability!==undefined)throw new TechnicianContextError();
  return session.primary.state.jobs.map((job,technicianIndex)=>({technicianIndex,availability:job?'BUSY':'AVAILABLE',currentJob:job,activeAbsence:null,returnTick:null}));
}
export async function getTechnicians(session:Simulation,signal:AbortSignal){
  return validateTechnicians(await researchRequest<TechniciansResponse>(`/demo/sessions/${encodeURIComponent(session.id)}/technicians`,{signal}),session);
}
export type TechnicianCommand={kind:'absence';sessionId:string;technicianIndex:number;basisTick:number;body:StartAbsence}|
  {kind:'return';sessionId:string;technicianIndex:number;basisTick:number;body:ReturnEarly};
export type TechnicianExecutor=(command:TechnicianCommand,key:string,signal:AbortSignal)=>Promise<Simulation>;
export async function sendTechnicianCommand(command:TechnicianCommand,key:string,signal:AbortSignal){
  const result=await researchRequest<TechnicianCommandResponse>(`/demo/sessions/${encodeURIComponent(command.sessionId)}/technicians/${command.technicianIndex}/${command.kind}`,{body:command.body,key,signal});
  const session=result?.session as unknown as Simulation;
  if(!session?.primary?.state||!session.baseline?.state||session.id!==command.sessionId||session.sessionId!==command.sessionId||session.revision!==command.body.revision+1||
    session.tick!==command.basisTick||session.primary.state.tick!==command.basisTick||session.baseline.state.tick!==command.basisTick||
    session.status!=='RUNNING'||session.pending!==null||session.playbackPaused!==true||!session.technicianAvailability)throw new TechnicianContextError();
  validateTechnicians(result,session);const embedded=embeddedTechnicians(session);
  if(!embedded||embedded.comparisonContext.cacheIdentity!==result.comparisonContext.cacheIdentity||embedded.comparisonContext.workforceHash!==result.comparisonContext.workforceHash)throw new TechnicianContextError();
  const last=session.technicianAvailability.events.at(-1),row=result.technicians[command.technicianIndex];
  if(!row||!last||last.technicianIndex!==command.technicianIndex||last.tick!==command.basisTick||last.reason!==command.body.reason||last.actor.type!=='USER'||
    last.type!==(command.kind==='absence'?'ABSENCE_STARTED':'ABSENCE_RETURNED_EARLY')||
    (command.kind==='absence'?row.availability!=='ABSENT'||row.returnTick!==command.basisTick+command.body.durationTicks : row.availability!=='AVAILABLE'))throw new TechnicianContextError();
  return session;
}
export function technicianError(error:unknown){
  const {status,code,name}=(error??{}) as {status?:number;code?:string;name?:string};
  if(status===401||name==='AuthRedirectError')return 'Sign in to read or change technician availability.';
  if(status===403)return 'Your role or session scope does not allow this technician operation.';
  if(code==='TECHNICIAN_BUSY')return 'This technician is repairing a machine. Wait for the job to finish, then refresh.';
  if(code==='TECHNICIAN_ALREADY_ABSENT')return 'This technician is already absent. Refresh to review the return time.';
  if(code==='TECHNICIAN_NOT_ABSENT')return 'This technician has already returned. Refresh to review the current state.';
  if(code==='TECHNICIAN_AVAILABILITY_LIMIT')return 'This session has reached its absence history limit. Start a new session.';
  if(code==='DEMO_COMPLETE')return 'Completed sessions cannot change technician availability.';
  if(code==='TECHNICIAN_RUNTIME_UNAVAILABLE')return 'The availability runtime is not installed. No change has been confirmed. Retry keeps the same request.';
  if(code==='TECHNICIAN_CONTEXT_MISMATCH'||code==='TECHNICIAN_RUNTIME_INVALID_OUTPUT')return 'Technician data does not match this session snapshot. Refresh before continuing.';
  if(status===409)return 'The session changed. Refresh and confirm the new tick and return time before submitting again.';
  if(status===404)return 'Technician availability is not available for this session or API version.';
  if(status===503||status===504)return 'The availability service is unavailable or timed out. Retry keeps the same request.';
  if(status===400||status===422)return 'Review the duration, target and reason within the supported limits.';
  return 'The response was not received. Retry unchanged details to recover the same operation.';
}
