'use client';
import {useEffect,useRef,useState} from 'react';
import {BookOpen,Save,X} from 'lucide-react';
import {ReviewDialog} from '@/components/research/review-dialog';
import {useWorkspaceUser} from '@/lib/workspace-user';
import {factoryLayouts,type LayoutId} from '@/lib/simulation/factory-layouts';
import {policyNames,serviceDuration,simulationTime} from '@/lib/simulation/clock';
import type {Simulation} from '@/lib/simulation/types';
import {situationsApi,situationError,situationLayout,type SituationExecutor} from '@/lib/simulation/situations';
import {useSituationWrite} from '@/lib/simulation/use-situation-write';
import type {DemoSituationSession,SnapshotMetadata} from '@/types/generated/simulation-situations';

export type PrepareSituation=(signal:AbortSignal)=>Promise<Simulation>;
export type OpenSituation=(session:Simulation & DemoSituationSession,snapshot:SnapshotMetadata)=>void;
const writable=(role:string|undefined)=>!role||['ADMIN','ENGINEER'].includes(role);
export function SituationButtons({session,onSave,onLibrary}:{session?:Simulation;onSave:()=>void;onLibrary:()=>void}){
  const user=useWorkspaceUser();
  return <div className="sim-situation-buttons" role="group" aria-label="Situation library controls">
    <button className="sim-button" disabled={!session||!writable(user?.role)} onClick={onSave}><Save size={14} aria-hidden="true"/>Save situation</button>
    <button className="sim-button" onClick={onLibrary}><BookOpen size={14} aria-hidden="true"/>Saved situations</button>
  </div>;
}

export function SituationPanels({mode,session,layoutId,prepare,execute,onOpened,onClose}:{mode:'save'|'library';session?:Simulation;layoutId:LayoutId;prepare:PrepareSituation;execute:SituationExecutor;onOpened:OpenSituation;onClose:()=>void}){
  const [busy,setBusy]=useState(false);const title='situation-panel-title';
  const user=useWorkspaceUser();const identity=`${user?.id??'authenticated'}:${user?.role??'scoped'}:${session?.id??'no-session'}`;
  return <ReviewDialog labelledBy={title} busy={busy} onClose={onClose}><div className="sim-situation-panel">
    <header><div><p className="research-eyebrow">Simulation · saved situations</p><h2 id={title}>{mode==='save'?'Save situation':'Saved situations'}</h2></div><button className="sim-button" disabled={busy} aria-label="Close situation panel" onClick={onClose}><X size={17} aria-hidden="true"/></button></header>
    {mode==='save'&&session?<SaveSituation key={identity} session={session} layoutId={layoutId} prepare={prepare} execute={execute} onOpened={onOpened} onBusy={setBusy}/>:
      <SavedSituations key={identity} scope={session?.id??'no-session'} execute={execute} onOpened={onOpened} onBusy={setBusy}/>}
  </div></ReviewDialog>;
}

function SaveSituation({session,layoutId,prepare,execute,onOpened,onBusy}:{session:Simulation;layoutId:LayoutId;prepare:PrepareSituation;execute:SituationExecutor;onOpened:OpenSituation;onBusy:(busy:boolean)=>void}){
  const user=useWorkspaceUser();const scope=`${user?.id??'authenticated'}:${session.id}:save`;
  const write=useSituationWrite(scope,execute);const open=useSituationWrite(`${scope}:open`,execute);
  const [name,setName]=useState('');const [description,setDescription]=useState('');
  const [context,setContext]=useState<Simulation>();const [loading,setLoading]=useState(true);const [error,setError]=useState('');
  const [reviewRequired,setReviewRequired]=useState(false);const abort=useRef<AbortController|null>(null);
  const prepareRef=useRef(prepare);prepareRef.current=prepare;
  async function load(review=false){
    abort.current?.abort();const request=new AbortController();abort.current=request;setLoading(true);setError('');
    if(review)setReviewRequired(true);
    try{const next=await prepareRef.current(request.signal);if(!request.signal.aborted)setContext(next);}
    catch(e){if(!request.signal.aborted)setError(situationError(e));}
    finally{if(!request.signal.aborted)setLoading(false);}
  }
  useEffect(()=>{void load();return()=>abort.current?.abort();},[scope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{onBusy(write.pending||open.pending);return()=>onBusy(false);},[write.pending,open.pending,onBusy]);
  const saved=write.result?.kind==='save'?write.result.snapshot:undefined;
  const busy=write.pending||open.pending;const blocked=write.status===409||reviewRequired;
  return <>
    <p className="sim-footnote">Capture both lanes, current work, policies and the incident queue at one tick boundary. The source session can continue independently.</p>
    {loading&&<p role="status" className="sim-inspection-note">Pausing playback and reading the latest simulator revision…</p>}
    {error&&<div role="alert" className="sim-error">{error}<button onClick={()=>void load()}>Retry context</button></div>}
    {write.recovery?.kind==='save'&&<div className="sim-inspection-note"><p>An earlier save has no confirmed outcome: “{write.recovery.body.name}”, t{write.recovery.basisTick}, revision {write.recovery.body.revision}. Recover the original request before starting another save.</p><button className="sim-button" disabled={busy||loading||!writable(user?.role)} onClick={()=>{if(write.recovery)void write.run(write.recovery);}}>Recover previous save</button><button className="sim-button" disabled={busy} onClick={()=>{write.reset();setName('');setDescription('');}}>Start a different save</button></div>}
    {open.recovery?.kind==='open'&&<div className="sim-inspection-note"><p>Recover the previous opening of “{open.recovery.snapshot.name}” with its original key.</p><button className="sim-button" disabled={busy||loading||!writable(user?.role)} onClick={async()=>{if(!open.recovery)return;const result=await open.run(open.recovery);if(result?.kind==='open')onOpened(result.session,result.snapshot);}}>Recover previous opening</button></div>}
    {context&&<div className="sim-situation-context" aria-label="Snapshot review"><strong>{factoryLayouts.find(layout=>layout.id===layoutId)?.name}</strong><p>t{context.primary.state.tick} · {simulationTime(context,context.primary.state.tick).time} · revision {context.revision}</p><p>{policyNames[context.primary.controller]??context.primary.controller} / {policyNames[context.baseline.controller]??context.baseline.controller}</p>
      <p>{context.primary.state.components.length} machines · {context.primary.state.jobs.length} technicians</p>
      {context.primary.state.jobs.flatMap((job,index)=>job?[<p key={index}>T{job.technician+1} → M{job.machine+1}/C{job.component+1} · {job.kind} · {serviceDuration(job.remaining,context.step_seconds)} remaining</p>]:[])}
    </div>}
    <form onSubmit={event=>{event.preventDefault();if(context&&!blocked&&!loading&&!busy&&!saved&&name.trim())void write.run({kind:'save',sessionId:context.id,basisTick:context.primary.state.tick,body:{revision:context.revision,name:name.trim(),description:description.trim(),layoutId}});}}>
      <label className="sim-field">Situation name<input autoComplete="off" required maxLength={120} value={name} disabled={busy||Boolean(saved)} onChange={event=>setName(event.target.value)}/></label>
      <label className="sim-field">Description (optional)<textarea maxLength={2000} value={description} disabled={busy||Boolean(saved)} onChange={event=>setDescription(event.target.value)}/></label>
      {write.error&&<div role="alert" className="sim-error">{write.error}{write.status===409&&<button type="button" onClick={()=>void load(true)}>Refresh snapshot context</button>}</div>}
      {reviewRequired&&context&&!loading&&<div className="sim-inspection-note"><p>Review the refreshed tick, work and policy above before saving.</p><button type="button" className="sim-button" onClick={()=>{write.reset();setReviewRequired(false);}}>Use refreshed snapshot</button></div>}
      {!saved&&<button className="research-primary" disabled={busy||loading||!context||blocked||Boolean(write.recovery)||!name.trim()||!writable(user?.role)}>{write.pending?'Saving…':'Save situation'}</button>}
    </form>
    {saved&&<div className="sim-situation-success" role="status"><strong>Saved “{saved.name}”</strong><p>Immutable snapshot at t{saved.sourceTick} · source revision {saved.sourceRevision}.</p><button className="research-primary" disabled={busy} onClick={async()=>{const result=await open.run({kind:'open',snapshot:saved,body:{revision:saved.sourceRevision}});if(result?.kind==='open')onOpened(result.session,saved);}}>{open.pending?'Opening…':'Open saved situation'}</button></div>}
    {open.error&&<p role="alert" className="sim-error">{open.error}</p>}
  </>;
}

function SavedSituations({scope,execute,onOpened,onBusy}:{scope:string;execute:SituationExecutor;onOpened:OpenSituation;onBusy:(busy:boolean)=>void}){
  const user=useWorkspaceUser();const identity=`${user?.id??'authenticated'}:${scope}`;
  const [items,setItems]=useState<SnapshotMetadata[]>([]);const [cursor,setCursor]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [query,setQuery]=useState('');
  const [selected,setSelected]=useState<SnapshotMetadata>();const [detailError,setDetailError]=useState('');const [detailLoading,setDetailLoading]=useState(false);
  const controller=useRef<AbortController|null>(null);const detailAbort=useRef<AbortController|null>(null);const requested=useRef<string|null>(null);const pageLock=useRef(false);
  const write=useSituationWrite(`${identity}:open`,execute);
  async function page(next:string|null){
    if(pageLock.current)return;pageLock.current=true;requested.current=next;const abort=new AbortController();controller.current=abort;setLoading(true);setError('');
    try{const data=await situationsApi.list(next,abort.signal);if(abort.signal.aborted)return;
      if(next&&data.nextCursor===next)throw new Error('Repeated cursor');
      setItems(previous=>{const all=next?[...previous,...data.items]:data.items;return [...new Map(all.map(item=>[item.snapshotId,item])).values()];});setCursor(data.nextCursor);
    }catch(e){if(!abort.signal.aborted){setError(situationError(e));if([401,403].includes((e as {status?:number}).status??0))setItems([]);}}
    finally{if(!abort.signal.aborted){setLoading(false);pageLock.current=false;}}
  }
  useEffect(()=>{setItems([]);setSelected(undefined);void page(null);return()=>{controller.current?.abort();detailAbort.current?.abort();pageLock.current=false;};},[identity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{onBusy(write.pending);return()=>onBusy(false);},[write.pending,onBusy]);
  async function detail(item:SnapshotMetadata){
    detailAbort.current?.abort();const abort=new AbortController();detailAbort.current=abort;
    const previous=selected?.snapshotId??(write.recovery?.kind==='open'?write.recovery.snapshot.snapshotId:undefined);
    if(previous&&previous!==item.snapshotId)write.reset();setSelected(item);setDetailError('');setDetailLoading(true);
    try{const data=await situationsApi.detail(item.snapshotId,abort.signal);if(!abort.signal.aborted)setSelected(data);}
    catch(e){if(!abort.signal.aborted)setDetailError(situationError(e));}
    finally{if(!abort.signal.aborted)setDetailLoading(false);}
  }
  const visible=items.filter(item=>item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <>
    <p className="sim-footnote">Open an independent session from a saved situation. Playback starts paused; the source is unchanged.</p>
    {write.recovery?.kind==='open'&&<div className="sim-inspection-note"><p>An earlier opening of “{write.recovery.snapshot.name}” has no confirmed response.</p><button className="sim-button" disabled={write.pending||!writable(user?.role)} onClick={async()=>{if(!write.recovery)return;const result=await write.run(write.recovery);if(result?.kind==='open')onOpened(result.session,result.snapshot);}}>Recover previous opening</button></div>}
    <label className="sim-field">Search loaded situations<input type="search" value={query} onChange={event=>setQuery(event.target.value)} disabled={write.pending}/></label>
    <p className="sim-footnote">Search covers {items.length} loaded situations in your permitted scope.</p>
    {loading&&<p role="status" className="sim-inspection-note">Loading saved situations…</p>}
    {error&&<div role="alert" className="sim-error">{error}<button disabled={loading} onClick={()=>void page(requested.current)}>Retry list</button></div>}
    {!loading&&!error&&!items.length&&<p className="sim-inspection-note">No saved situations yet. Save a running or paused session to begin.</p>}
    {!!items.length&&!visible.length&&<p className="sim-inspection-note">No loaded situations match this name.</p>}
    <ul className="sim-saved-list">{visible.map(item=><li key={item.snapshotId}><button type="button" disabled={write.pending} aria-pressed={selected?.snapshotId===item.snapshotId} onClick={()=>void detail(item)}><strong>{item.name}</strong><span>{new Date(item.createdAt).toLocaleString('en-GB')} · t{item.sourceTick}</span><span>{factoryLayouts.find(layout=>layout.id===situationLayout(item.layoutId))?.name??`Unsupported layout: ${item.layoutId}`}</span></button></li>)}</ul>
    {cursor&&<button className="sim-button" disabled={loading||write.pending} onClick={()=>void page(cursor)}>Load more situations</button>}
    {selected&&<section className="sim-situation-context" aria-label="Saved situation details"><h3>{selected.name}</h3><p>{selected.description||'No description provided.'}</p><p>Saved source t{selected.sourceTick} · revision {selected.sourceRevision}</p>
      {detailLoading&&<p role="status">Reading saved summary…</p>}
      {detailError&&<div role="alert" className="sim-error">{detailError}<button onClick={()=>void detail(selected)}>Retry details</button></div>}
      {selected.summary&&<p>{selected.summary.machineCount} machines · {selected.summary.technicianCount} technicians · {selected.summary.status.replaceAll('_',' ')} · {policyNames[selected.summary.primary]??selected.summary.primary}</p>}
      <p className="sim-footnote">Saved machine conditions and active-service details are not provided by this metadata API. Open the saved session to inspect them.</p>
      <details><summary>Snapshot provenance</summary><p>Source session: {selected.sourceSessionId}</p><p>Snapshot: {selected.snapshotId}</p><p>Hash: {selected.snapshotHash}</p><p>Engine source: {selected.sourceCommit}</p></details>
      {!situationLayout(selected.layoutId)&&<p role="alert">This saved layout is not supported by this workspace.</p>}
      {write.error&&<p role="alert" className="sim-error">{write.error}</p>}
      <button className="research-primary" disabled={write.pending||detailLoading||Boolean(detailError)||Boolean(write.recovery)||!situationLayout(selected.layoutId)||!writable(user?.role)} onClick={async()=>{const result=await write.run({kind:'open',snapshot:selected,body:{revision:selected.sourceRevision}});if(result?.kind==='open')onOpened(result.session,selected);}}>{write.pending?'Opening…':'Open as new session'}</button>
      {!writable(user?.role)&&<p className="sim-footnote">Your role can read situations but cannot open a new session.</p>}
    </section>}
  </>;
}
