'use client';
import {useEffect,useRef,useState} from 'react';
import {useWorkspaceUser} from '@/lib/workspace-user';
import type {Simulation} from '@/lib/simulation/types';
import {simulationTime} from '@/lib/simulation/clock';
import {situationError,type SituationExecutor} from '@/lib/simulation/situations';
import {useSituationWrite} from '@/lib/simulation/use-situation-write';
import type {PrepareSituation} from './situation-panels';

export function CreateIncidentPanel({session,machine,prepare,execute,onReview,onBusy}:{session:Simulation;machine:number;prepare:PrepareSituation;execute:SituationExecutor;onReview:()=>void;onBusy:(busy:boolean)=>void}){
  const user=useWorkspaceUser();const allowed=!user||['ADMIN','ENGINEER'].includes(user.role);
  const [expanded,setExpanded]=useState(false);const [context,setContext]=useState<Simulation>();
  const [loading,setLoading]=useState(false);const [error,setError]=useState('');
  const [component,setComponent]=useState(0);const [when,setWhen]=useState<'now'|'after'>('now');const [steps,setSteps]=useState('2');const [reason,setReason]=useState('');const [reviewRequired,setReviewRequired]=useState(false);
  const abort=useRef<AbortController|null>(null);const toggle=useRef<HTMLButtonElement>(null);
  const write=useSituationWrite(`${user?.id??'authenticated'}:${session.id}:${machine}:incident`,execute);
  useEffect(()=>()=>abort.current?.abort(),[]);
  useEffect(()=>{onBusy(write.pending);return()=>onBusy(false);},[write.pending,onBusy]);
  async function load(review=false){
    setExpanded(true);abort.current?.abort();const request=new AbortController();abort.current=request;setLoading(true);setError('');if(review)setReviewRequired(true);
    try{const fresh=await prepare(request.signal);if(!request.signal.aborted)setContext(fresh);}
    catch(e){if(!request.signal.aborted)setError(situationError(e));}
    finally{if(!request.signal.aborted)setLoading(false);}
  }
  const baseTick=context?.primary.state.tick;
  const offset=Number(steps);const validOffset=when==='now'||(/^\d+$/.test(steps)&&Number.isInteger(offset)&&offset>=1&&offset<=100000);
  const target=baseTick===undefined?undefined:when==='now'?baseTick:baseTick+offset;
  const validTick=target!==undefined&&Number.isSafeInteger(target)&&target<=2147483647;
  const reviewPending=context?.status==='REVIEW'&&when==='now';const blocked=write.status===409||reviewRequired;
  const result=write.result?.kind==='incident'?write.result.event:undefined;
  return <section className="sim-health-section sim-create-incident" aria-label="Create controlled incident">
    <button ref={toggle} className="sim-button" type="button" disabled={!allowed||!session.branch||session.status==='COMPLETE'||write.pending} aria-expanded={expanded} onClick={()=>{if(expanded){setExpanded(false);abort.current?.abort();toggle.current?.focus();}else void load();}}>Create incident</button>
    {!session.branch&&<p className="sim-footnote">Open a saved situation as a new session to create incidents on its primary lane.</p>}
    {!allowed&&<p className="sim-footnote">Your role cannot create incidents.</p>}
    {expanded&&<div className="sim-incident-form">
      <p className="sim-footnote">Controlled training incident · primary lane only. This does not affect the source situation or production equipment.</p>
      {loading&&<p role="status">Pausing playback and reading the latest tick…</p>}
      {error&&<div role="alert" className="sim-error">{error}<button onClick={()=>void load()}>Retry incident context</button></div>}
      {write.recovery?.kind==='incident'&&<div className="sim-inspection-note"><p>Previous request: M{write.recovery.body.machineIndex+1}/C{write.recovery.body.componentIndex+1} at t{write.recovery.body.scheduledTick}, revision {write.recovery.body.revision}. Recover using its original timing and key.</p><button className="sim-button" disabled={write.pending||loading||!allowed} onClick={()=>{if(write.recovery)void write.run(write.recovery);}}>Recover previous incident</button><button className="sim-button" disabled={write.pending} onClick={()=>{write.reset();void load(true);}}>Start a different incident</button></div>}
      <form onSubmit={event=>{event.preventDefault();if(context?.branch&&session.branch&&context.status!=='COMPLETE'&&validOffset&&validTick&&!blocked&&!reviewPending&&!write.pending&&reason.trim()&&!result)void write.run({kind:'incident',sessionId:context.id,basisTick:context.primary.state.tick,body:{revision:context.revision,machineIndex:machine,componentIndex:component,scheduledTick:target!,reason:reason.trim()}});}}>
        <label className="sim-field">Incident component<select value={component} disabled={write.pending||Boolean(result)} onChange={event=>setComponent(Number(event.target.value))}>{session.primary.state.components[machine]?.map((_,index)=><option key={index} value={index}>C{index+1}</option>)}</select></label>
        <label className="sim-field">Execution<select value={when} disabled={write.pending||Boolean(result)} onChange={event=>setWhen(event.target.value as 'now'|'after')}><option value="now">Now — current tick, no advance</option><option value="after">After a number of steps</option></select></label>
        {when==='after'&&<label className="sim-field">Steps from current tick<input type="number" min={1} max={100000} step={1} value={steps} disabled={write.pending||Boolean(result)} onChange={event=>setSteps(event.target.value)}/></label>}
        <label className="sim-field">Incident note<textarea required maxLength={1000} value={reason} disabled={write.pending||Boolean(result)} onChange={event=>setReason(event.target.value)}/></label>
        {context&&<section className="sim-situation-context" aria-label="Incident execution review"><strong>M{machine+1} / C{component+1} · Injected incident</strong><p>Current t{baseTick} · revision {context.revision}</p><p>{validOffset&&validTick?`Apply at t${target} · ${simulationTime(context,target!).time}${when==='now'?' · tick will not advance':''}`:'Enter 1–100000 whole steps within the simulator tick limit.'}</p></section>}
        {reviewPending&&<div className="sim-inspection-note"><p>Resolve the pending assignments before creating an incident now.</p><button className="sim-button" type="button" onClick={onReview}>Review pending assignments</button></div>}
        {context?.status==='COMPLETE'&&<p role="status" className="sim-inspection-note">Completed sessions cannot create incidents. Review the simulator controls before continuing this session.</p>}
        {write.error&&<div role="alert" className="sim-error"><p>{write.error}</p>{write.code==='DEMO_REVIEW_REQUIRED'&&<button type="button" onClick={onReview}>Review pending assignments</button>}{write.status===409&&<button type="button" onClick={()=>void load(true)}>Refresh incident context</button>}</div>}
        {reviewRequired&&context&&!loading&&<div className="sim-inspection-note"><p>Review the refreshed absolute tick before creating the incident.</p><button type="button" className="sim-button" onClick={()=>{write.reset();setReviewRequired(false);}}>Confirm updated execution time</button></div>}
        {!result&&<button className="research-primary" disabled={!allowed||loading||!context?.branch||!session.branch||context.status==='COMPLETE'||!validOffset||!validTick||blocked||reviewPending||write.pending||Boolean(write.recovery)||!reason.trim()}>{write.pending?'Creating…':'Create injected incident'}</button>}
      </form>
      {result&&<div role="status" className="sim-situation-success"><strong>Injected incident · {result.status}</strong><p>M{result.machineIndex+1}/C{result.componentIndex+1} · scheduled t{result.scheduledTick}{result.appliedTick===null?'':` · processed t${result.appliedTick}`}</p>{result.reason&&<p>{result.reason==='MACHINE_IN_SERVICE'?'Skipped: machine is in maintenance.':'Skipped: the machine already has a failed component.'}</p>}<button className="sim-button" onClick={()=>{write.reset();setReason('');void load();}}>Create another incident</button></div>}
    </div>}
  </section>;
}
