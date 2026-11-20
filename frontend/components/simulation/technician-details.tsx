'use client';
import {useEffect,useRef,useState} from 'react';
import {Wrench,X} from 'lucide-react';
import type {Config} from '@/types/generated/jcst';
import type {Lane,Matching,Simulation} from '@/lib/simulation/types';
import {serviceDuration,simulationTime} from '@/lib/simulation/clock';
import type {TechnicianRead} from '@/lib/simulation/use-technician-availability';
import {embeddedTechnicians,getTechnicians,technicianError,type TechnicianExecutor} from '@/lib/simulation/technicians';
import {useTechnicianWrite} from '@/lib/simulation/use-technician-write';
import {useWorkspaceUser} from '@/lib/workspace-user';
import type {PrepareSituation} from './situation-panels';

export function TechnicianDetails({technician,lane,config,proposal,onClose,onSelectMachine,session,read,prepare,execute,onBusy}:{
  technician:number;lane:Lane;config:Config;proposal?:Matching;onClose:()=>void;onSelectMachine:(machine:number)=>void;
  session:Simulation;read:TechnicianRead;prepare:PrepareSituation;execute:TechnicianExecutor;onBusy:(busy:boolean)=>void;
}){
  const job=lane.state.jobs[technician], row=read.rows?.[technician];
  const pending=proposal?.find(([, ,worker])=>worker===technician);
  const history=lane.records.flatMap(record=>record.events).filter(event=>event.type==='completion'&&event.technician===technician);
  const qualifications=config.duration.flatMap((components,machine)=>components.map((durations,component)=>({machine,component,duration:durations[technician]})));
  const [working,setWorking]=useState(false);
  return <aside className="sim-twin-inspector sim-technician-inspector" aria-label={`Technician T${technician+1} details`} onKeyDown={e=>{if(e.key==='Escape'&&!working){e.stopPropagation();onClose();}}}>
    <div className="sim-twin-inspector-header"><p className="sim-twin-kicker"><Wrench size={15} aria-hidden="true"/> Maintenance team</p><button className="sim-button" aria-label="Close technician panel" disabled={working} onClick={onClose}><X size={15} aria-hidden="true"/></button></div>
    <h3>Technician T{technician+1}</h3>
    <span className="sim-availability" data-availability={row?.availability??'UPDATING'}>{row?.availability??'Updating'}</span>
    <dl>
      <div><dt>Availability</dt><dd>{row?.availability==='AVAILABLE'?'Ready for assignment':row?.availability==='BUSY'?'Repair in progress':row?.availability==='ABSENT'?'Temporarily absent':'Reading current snapshot…'}</dd></div>
      <div><dt>Current assignment</dt><dd>{job?`M${job.machine+1} / C${job.component+1}`:'Unassigned'}</dd></div>
      {job&&<><div><dt>Service</dt><dd>{job.kind==='CM'?'Corrective':'Preventive'}</dd></div><div><dt>Time remaining</dt><dd>{serviceDuration(job.remaining,session.step_seconds)}</dd></div></>}
      {row?.availability==='ABSENT'&&row.returnTick!==null&&<><div><dt>Returns at</dt><dd>{simulationTime(session,row.returnTick).date} · {simulationTime(session,row.returnTick).time} · t{row.returnTick}</dd></div><div><dt>Absence remaining</dt><dd>{serviceDuration(row.returnTick-session.primary.state.tick,session.step_seconds)} ({row.returnTick-session.primary.state.tick} steps)</dd></div></>}
      {row?.availability==='AVAILABLE'&&pending&&<div><dt>Proposed assignment</dt><dd>M{pending[0]+1} / C{pending[1]+1}</dd></div>}
      <div><dt>Jobs completed</dt><dd>{lane.completed_jobs?.[technician]??history.length}</dd></div>
    </dl>
    {read.loading&&<p role="status" className="sim-footnote">Updating workforce snapshot…</p>}
    {read.error&&<div role="alert" className="sim-error">{read.error}<button className="sim-button" onClick={read.retry}>Retry technician read</button></div>}
    {read.legacy&&<p className="sim-footnote">Legacy session: availability follows the recorded jobs; no absence history was provided.</p>}
    <TechnicianAvailabilityForm key={`${session.id}:${technician}`} session={session} technician={technician} read={read} prepare={prepare} execute={execute} onBusy={value=>{setWorking(value);onBusy(value);}}/>
    <h4 className="sim-tech-qualification-title">Qualifications <span>{qualifications.filter(q=>q.duration>0).length} / {qualifications.length} components</span></h4>
    <table className="sim-tech-qualifications"><thead><tr><th scope="col">Component</th><th scope="col">Service time</th></tr></thead><tbody>{qualifications.map(({machine,component,duration})=><tr key={`${machine}:${component}`}><th scope="row">M{machine+1} / C{component+1}</th><td>{duration>0?serviceDuration(duration,session.step_seconds):'Not qualified'}</td></tr>)}</tbody></table>
    {job&&<button className="sim-button" disabled={working} onClick={()=>onSelectMachine(job.machine)}>View assigned machine</button>}
  </aside>;
}

export function TechnicianAvailabilityForm({session,technician,read,prepare,execute,onBusy}:{session:Simulation;technician:number;read:TechnicianRead;prepare:PrepareSituation;execute:TechnicianExecutor;onBusy:(busy:boolean)=>void}){
  const user=useWorkspaceUser();const allowed=Boolean(user&&['ADMIN','ENGINEER'].includes(user.role));
  const finite = session.continuous === false;
  const write=useTechnicianWrite(`${user?.id??'unknown'}:${session.id}:${technician}`,execute);
  const [expanded,setExpanded]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [context,setContext]=useState<{session:Simulation;availability:string;returnTick:number|null}>();
  const [duration,setDuration]=useState('3'),[unit,setUnit]=useState<'steps'|'minutes'>('steps'),[reason,setReason]=useState('');
  const [confirmFresh,setConfirmFresh]=useState(false);
  const controller=useRef<AbortController|null>(null),button=useRef<HTMLButtonElement>(null),fields=useRef<HTMLDivElement>(null),onBusyRef=useRef(onBusy);onBusyRef.current=onBusy;
  useEffect(()=>{onBusyRef.current(write.pending||loading);return()=>onBusyRef.current(false);},[write.pending,loading]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function load(stale=false){
    controller.current?.abort();const abort=new AbortController();controller.current=abort;setExpanded(true);setLoading(true);setError('');setContext(undefined);if(stale)setConfirmFresh(true);
    try{const fresh=await prepare(abort.signal);const data=embeddedTechnicians(fresh)??await getTechnicians(fresh,abort.signal);
      if(abort.signal.aborted||fresh.id!==session.id)return;
      const row=data.technicians[technician];if(!row)throw Error('Unknown technician');
      setContext({session:fresh,availability:row.availability,returnTick:row.returnTick});
      requestAnimationFrame(()=>{if(!abort.signal.aborted)fields.current?.querySelector<HTMLElement>('input,textarea,button')?.focus();});
    }catch(e){if(!abort.signal.aborted)setError(technicianError(e));}finally{if(!abort.signal.aborted)setLoading(false);}
  }
  const row=read.rows?.[technician];const operation=context?.availability==='ABSENT'?'return':'absence';
  const n=Number(duration),seconds=context?.session.step_seconds;
  const ticks=unit==='steps'?n:seconds?n*60/seconds:NaN;
  const valid=/^\d+(\.\d+)?$/.test(duration)&&Number.isInteger(ticks)&&ticks>=1&&ticks<=100000;
  const base=context?.session.primary.state.tick;
  const returnTick=base!==undefined&&valid?base+ticks:undefined;
  const contextChanged=Boolean(context&&context.session.revision!==session.revision);
  const disabled=!allowed||finite||context?.session.continuous===false||loading||write.pending||!context||contextChanged||confirmFresh||write.status===409||Boolean(write.recovery)||Boolean(write.result)||context.session.status==='COMPLETE'||context.availability==='BUSY'||(operation==='absence'&&(!valid||returnTick!>2147483647));
  async function submit(){
    if(disabled||!context)return;
    const body={revision:context.session.revision,reason:reason.trim()||(operation==='absence'?'Temporary absence':'Returned early')};
    await write.run(operation==='absence'?{kind:'absence',sessionId:session.id,technicianIndex:technician,basisTick:base!,body:{...body,durationTicks:ticks}}:{kind:'return',sessionId:session.id,technicianIndex:technician,basisTick:base!,body});
  }
  return <section className="sim-health-section sim-availability-controls" aria-label={`T${technician+1} availability controls`}>
    <button ref={button} className="sim-button" aria-expanded={expanded} disabled={!allowed||finite||session.status==='COMPLETE'||write.pending||loading||row?.availability==='BUSY'} onClick={()=>{if(expanded){setExpanded(false);controller.current?.abort();button.current?.focus();}else void load();}}>{row?.availability==='ABSENT'?'Return now':'Mark temporarily absent'}</button>
    {row?.availability==='BUSY'&&<p className="sim-footnote">Finish the active repair before starting an absence.</p>}
    {!allowed&&<p className="sim-footnote">ADMIN or ENGINEER permission is required to change availability.</p>}
    {session.status==='COMPLETE'&&<p className="sim-footnote">Completed sessions cannot change availability.</p>}
    {finite&&session.status!=='COMPLETE'&&<p className="sim-footnote">Availability changes require a continuous simulation.</p>}
    {write.recovery&&<div className="sim-inspection-note"><p>An earlier {write.recovery.kind} request for T{technician+1} at t{write.recovery.basisTick} needs recovery. Its original revision, body and key are retained.</p><button className="sim-button" disabled={!allowed||finite||write.pending||loading} onClick={()=>{if(write.recovery)void write.run(write.recovery);}}>Recover previous availability change</button><button className="sim-button" disabled={finite||write.pending||loading} onClick={()=>{write.reset();void load(true);}}>Review a new availability change</button></div>}
    {expanded&&<div ref={fields} className="sim-incident-form">
      {loading&&<p role="status">Pausing playback and reading the latest workforce…</p>}
      {error&&<div role="alert" className="sim-error"><p>{error}</p><button className="sim-button" onClick={()=>void load(confirmFresh)}>Retry availability context</button></div>}
      {context&&<form onSubmit={e=>{e.preventDefault();void submit();}}>
        {operation==='absence'&&<><label className="sim-field">Duration unit<select value={unit} disabled={write.pending} onChange={e=>setUnit(e.target.value as 'steps'|'minutes')}><option value="steps">Simulation steps</option><option value="minutes">Simulation minutes</option></select></label><label className="sim-field">Absence duration<input type="number" min={unit==='steps'?1:(seconds??900)/60} max={unit==='steps'?100000:100000*(seconds??900)/60} step={unit==='steps'?1:(seconds??900)/60} value={duration} disabled={write.pending} onChange={e=>setDuration(e.target.value)}/></label>{!valid&&<p className="sim-footnote">Enter 1–100000 whole steps, or minutes matching a whole session step.</p>}</>}
        <label className="sim-field">Availability reason (optional)<textarea maxLength={1000} value={reason} disabled={write.pending} onChange={e=>setReason(e.target.value)}/></label>
        <section className="sim-situation-context" aria-label="Availability change review"><strong>T{technician+1} · {operation==='return'?'Return early':'Temporary absence'}</strong><p>Current t{base} · revision {context.session.revision} · {seconds} seconds per step</p><p>{operation==='return'?`Return at t${base} · ${simulationTime(context.session,base!).time}`:valid&&returnTick!==undefined?`Absent [t${base}, t${returnTick}) · returns ${simulationTime(context.session,returnTick).date} at ${simulationTime(context.session,returnTick).time} · ${serviceDuration(ticks,seconds)}`:'Choose a valid duration.'}</p><p>Tick will not advance. The pending proposal and workforce-dependent deferrals will be cleared. Playback stays paused.</p><p>Both lanes share this calendar; a baseline repair already underway can finish.</p></section>
        {context.availability==='BUSY'&&<p role="status">This technician is now busy. Wait for the repair to finish.</p>}
        {contextChanged&&!write.result&&!write.error&&<div role="status" className="sim-inspection-note">The simulator changed while this form was open.<button className="sim-button" type="button" onClick={()=>void load(true)}>Refresh availability context</button></div>}
        {confirmFresh&&!loading&&<div className="sim-inspection-note"><p>Review the new tick, state and return time.</p><button className="sim-button" type="button" onClick={()=>{write.reset();setConfirmFresh(false);}}>Confirm updated availability context</button></div>}
        {!write.result&&<button className="research-primary" disabled={disabled}>{write.pending?'Updating availability…':operation==='return'?'Confirm return now':'Confirm temporary absence'}</button>}
      </form>}
    </div>}
    {write.error&&<div role="alert" className="sim-error"><p>{write.error}</p>{write.status===409?<button className="sim-button" onClick={()=>void load(true)}>Refresh availability context</button>:<button className="sim-button" disabled={write.pending||!allowed||finite} onClick={()=>{if(write.recovery)void write.run(write.recovery);else void submit();}}>Retry availability change</button>}</div>}
    {write.result&&<div role="status" className="sim-situation-success"><p>Availability updated from server. Playback is paused; the previous proposal is closed.</p><button className="sim-button" onClick={()=>{write.reset();setExpanded(false);setContext(undefined);setReason('');button.current?.focus();}}>Done</button></div>}
  </section>;
}
