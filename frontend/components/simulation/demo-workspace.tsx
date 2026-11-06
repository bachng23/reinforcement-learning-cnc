"use client";
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipForward, RotateCcw, ArrowRight, Activity, Maximize, Minimize, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { researchRequest } from '@/lib/research-api/client';
import type { Simulation, Matching, SimulationRecord, Lane } from '@/lib/simulation/types';
import { policyNames, simulationTime } from '@/lib/simulation/clock';
import { hasNewFailure, incidentNotifications } from '@/lib/simulation/presentation';
import { MachineDetail } from './machine-detail';
import { FactoryPreview } from './factory-preview';
import { FleetView } from './fleet-view';
import { FactoryDashboard } from './factory-dashboard';
import { factoryLayouts, getFactoryLayout, type LayoutId } from '@/lib/simulation/factory-layouts';
import { ComparisonView } from './comparison-view';
import { DecisionView } from './decision-view';

export type DemoView = 'overview' | 'decision' | 'agents' | 'compare' | 'dashboard';
const labels: Record<DemoView,string> = {overview:'Simulation',dashboard:'Factory dashboard',decision:'Decision Center',agents:'Decision activity',compare:'Compare controllers'};
const descriptions: Record<DemoView, string> = {
  dashboard: 'Understand reliability, maintenance and operating cost.',
  overview: 'Monitor machine health and technician assignments.',
  decision: 'Review and confirm maintenance assignments.',
  agents: 'Review the history of maintenance decisions.',
  compare: 'Compare costs and downtime for the same scenario.',
};
const scenarioNames: Record<string, string> = {
  base: 'Two specialist technicians',
  generalist: 'Three technicians',
};
const routes: Record<DemoView,string> = {overview:'/simulation',dashboard:'/dashboard',decision:'/decisions',agents:'/agents',compare:'/what-if'};
const factoryViewKey = 'mcc-demo-factory-view';
const stationKey = (sessionId: string) => `mcc-demo-station:${sessionId}`;

export function DemoWorkspace({view='overview',initialId}: {view?:DemoView;initialId?:string}) {
  const [layoutId, setLayoutId] = useState<LayoutId>('machining');
  const selectedLayout = getFactoryLayout(layoutId);
  const [session,setSession]=useState<Simulation>(); const current=useRef<Simulation | undefined>(undefined);
  const [busy,setBusy]=useState(false); const locked=useRef(false); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  const [running,setRunning]=useState(false); const [automatic,setAutomatic]=useState(false); const [speed,setSpeed]=useState(2000);
  const [pauseOnIncident,setPauseOnIncident]=useState(true);
  const [selectedMachine,setSelectedMachine]=useState<number|null>(null);
  const [factoryView, setFactoryView] = useState<'2d' | '3d'>('2d');
  const workspace = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandError, setExpandError] = useState(false);
  useEffect(() => {
    function updateFullscreen() {
      setExpanded(document.fullscreenElement === workspace.current);
    }
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);
  async function toggleFullscreen() {
    setExpandError(false);
    try {
      if (document.fullscreenElement === workspace.current) await document.exitFullscreen();
      else await workspace.current?.requestFullscreen();
    } catch {
      setExpandError(true);
    }
  }

  const [station, setStation] = useState<number | null>(null);
  useEffect(() => {
    let preferred: string | null = null;
    try { preferred = sessionStorage.getItem(factoryViewKey); } catch {}
    const restoredView = preferred === '2d' || preferred === '3d'
      ? preferred
      : window.matchMedia?.('(min-width: 1050px)').matches ? '3d' : '2d';
    setFactoryView(restoredView);
    try { sessionStorage.setItem(factoryViewKey, restoredView); } catch {}
  }, []);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  function chooseFactoryView(nextView: '2d' | '3d') {
    setFactoryView(nextView);
    if (nextView === '3d') setPreviewUnavailable(false);
    try { sessionStorage.setItem(factoryViewKey, nextView); } catch {}
  }

  function selectStation(machine: number | null) {
    setStation(machine);
    if (!session) return;
    try {
      if (machine === null) sessionStorage.removeItem(stationKey(session.id));
      else sessionStorage.setItem(stationKey(session.id), String(machine));
    } catch {}
  }
  const showFleet = useCallback(() => {
    setFactoryView('2d');
    setPreviewUnavailable(true);
  }, []);
  const inspectMachine = useCallback((machine: number) => {
    setRunning(false);
    setSelectedMachine(machine);
  }, []);
  const pathname = usePathname();
  const [localView, setLocalView] = useState<DemoView>(view);
  const activeView = pathname === '/overview' ? 'overview' : (Object.keys(routes) as DemoView[]).find(key => routes[key] === pathname) ?? localView;

  function openView(nextView: DemoView, sessionId: string) {
    setLocalView(nextView);
    const url = new URL(routes[nextView], window.location.origin);
    url.searchParams.set('session', sessionId);
    url.searchParams.set('workshop', layoutId);
    window.history.replaceState(null, '', url);
  }

  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [primaryPolicy, setPrimaryPolicy] = useState('S');
  const baselinePolicy = primaryPolicy === 'corrective' ? 'risk' : 'corrective';
  const [releases, setReleases] = useState<{arm:string;case_id:string;available:boolean}[]>([]);
  const [scenario,setScenario]=useState('base'); const [mode,setMode]=useState<'incident'|'policy'>('policy'); const [seed,setSeed]=useState('990000001');
  const [setup,setSetup]=useState(false); const [capabilityError,setCapabilityError]=useState('');
  const [available,setAvailable]=useState<boolean>();
  const createIdentity=useRef<{input:string;key:string} | undefined>(undefined);
  const commandIdentity=useRef<{input:string;key:string} | undefined>(undefined);
  const accept = useCallback((data:Simulation, workshop?: LayoutId)=>{
    let layout = getFactoryLayout(workshop ?? new URLSearchParams(window.location.search).get('workshop') ?? undefined).id;
    try {
      layout = workshop ?? getFactoryLayout(window.localStorage.getItem(`mcc-workshop:${data.id}`) ?? new URLSearchParams(window.location.search).get('workshop') ?? undefined).id;
      window.localStorage.setItem(`mcc-workshop:${data.id}`,layout);
      window.localStorage.setItem(`mcc-workshop-session:${layout}`,data.id);
    } catch {}
    setLayoutId(layout);
    if (current.current?.id !== data.id) {
      let savedStation: number | null = null;
      try {
        const saved = sessionStorage.getItem(stationKey(data.id));
        if (saved !== null) savedStation = Number(saved);
      } catch {}
      setStation(savedStation !== null && Number.isInteger(savedStation) &&
        savedStation >= 0 && savedStation < data.primary.state.components.length ? savedStation : null);
    }
    current.current=data;setSession(data);setError('');
    try{sessionStorage.setItem('mcc-demo-session',data.id);}catch{}
    const url=new URL(window.location.href);url.searchParams.set('session',data.id);url.searchParams.set('workshop',layout);window.history.replaceState(null,'',url);
  },[]);
  useEffect(()=>{
    const abort=new AbortController();
    let stored: string | null=null;try{stored=sessionStorage.getItem('mcc-demo-session');}catch{}
    const addressId=new URLSearchParams(window.location.search).get('session');
    const id=addressId || initialId || stored;
    setLoading(true);
    if(id)researchRequest<Simulation>(`/demo/sessions/${encodeURIComponent(id)}`,{signal:abort.signal}).then(data=>{if(!abort.signal.aborted)accept(data);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    else setLoading(false);
    return()=>abort.abort();
  },[initialId,accept]);
  useEffect(()=>{
    const abort=new AbortController();
    setAvailable(undefined);
    setCapabilityError('');
    researchRequest<{learned_releases:{arm:string;case_id:string;available:boolean}[]}>('/capabilities',{signal:abort.signal}).then(c=>{if(!abort.signal.aborted){setReleases(c.learned_releases);setAvailable([primaryPolicy].filter(arm=>['S','A','F'].includes(arm)).every(arm=>c.learned_releases.some(r=>r.arm===arm&&r.case_id===scenario&&r.available)));}}).catch(e=>{if(!abort.signal.aborted){setAvailable(false);setCapabilityError(e.message);}});
    return()=>abort.abort();
  },[scenario,primaryPolicy]);
  async function create(start=false) {
    if(locked.current)return;locked.current=true;setBusy(true);setRunning(false);setError('');
    const body={case:scenario,seed,mode,primary:primaryPolicy,baseline:baselinePolicy,continuous:true};const input=JSON.stringify(body);
    if(createIdentity.current?.input!==input)createIdentity.current={input,key:crypto.randomUUID()};
    try{const data=await researchRequest<Simulation>('/demo/sessions',{body,key:createIdentity.current.key});if(!mounted.current)return;accept(data,layoutId);createIdentity.current=undefined;setSetup(false);setAutomatic(Boolean(data.continuous));setPauseOnIncident(!data.continuous);setSelectedMachine(null);setStation(null);openView('overview', data.id);setRunning(start);}
    catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}
  }
  async function chooseWorkshop(workshop: LayoutId) {
    if (workshop===layoutId || locked.current) return;
    if (!session) { setLayoutId(workshop); return; }
    locked.current=true;setBusy(true);setRunning(false);setError('');
    try {
      let saved: string | null=null;
      try { saved=window.localStorage.getItem(`mcc-workshop-session:${workshop}`); } catch {}
      let data: Simulation;
      if (saved) {
        try { data=await researchRequest<Simulation>(`/demo/sessions/${encodeURIComponent(saved)}`); }
        catch(e) { if (!/not found/i.test((e as Error).message)) throw e; saved=null; }
      }
      if (!saved) data=await researchRequest<Simulation>('/demo/sessions',{body:{case:session.case_id,seed:String(990000001+factoryLayouts.findIndex(l=>l.id===workshop)*101),mode:'policy',primary:primaryPolicy,baseline:baselinePolicy,continuous:true},key:crypto.randomUUID()});
      if (!mounted.current) return;
      accept(data!,workshop);setSelectedMachine(null);setStation(null);
    } catch(e) { setError((e as Error).message); }
    finally { locked.current=false;setBusy(false); }
  }
  async function refreshSession() {
    if (!current.current || locked.current) return;
    locked.current=true;setBusy(true);
    try { accept(await researchRequest<Simulation>(`/demo/sessions/${current.current.id}`)); }
    catch(e) { setError((e as Error).message); }
    finally { locked.current=false;setBusy(false); }
  }
  async function command(body:Record<string,unknown>) {
    const before=current.current;if(!before||locked.current)return;
    locked.current=true;setBusy(true);setError('');
    const inputBody={revision:before.revision,...body};const input=JSON.stringify(inputBody);
    if(commandIdentity.current?.input!==input)commandIdentity.current={input,key:crypto.randomUUID()};
    try{
      const next=await researchRequest<Simulation>(`/demo/sessions/${before.id}/commands`,{body:inputBody,key:commandIdentity.current.key});if(!mounted.current)return;accept(next);commandIdentity.current=undefined;
      if(next.status==='REVIEW'||next.status==='COMPLETE'||(pauseOnIncident&&hasNewFailure(before.primary.state.tick,next)))setRunning(false);
      return next;
    }catch(e){setRunning(false);setError((e as Error).message);}finally{locked.current=false;setBusy(false);}
  }
  const decide=async(action:Matching|null,reason:string)=>{
    const count=current.current?.primary.state.tick??0;
    const next=await command(action===null ? {command:'approve',reason} : {command:'override',action,reason});
    if(next){openView('overview', next.id);
      const hasFailure=hasNewFailure(count,next);
      setRunning(next.status==='RUNNING'&&!(pauseOnIncident&&hasFailure));}
  };
  async function inspectDecision(){
    if(locked.current)return;
    const next=current.current?.status==='RUNNING'?await command({command:'advance',autoApprove:false}):current.current;
    if(next){setRunning(false);setSelectedMachine(null);openView('decision', next.id);}
  }
  useEffect(()=>{
    if(!running||busy||!session||session.status!=='RUNNING')return;
    const timer=setTimeout(()=>void command({command:'advance',autoApprove:automatic}),speed);
    return()=>clearTimeout(timer);
    // A single command at a time, scheduled only after the previous response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[running,busy,session?.revision,automatic,speed,pauseOnIncident]);
  const tick=session?.primary.state.tick ?? 0;
  const clock = simulationTime(session ?? {}, tick);
  useEffect(() => {
    if (!session) return;
    setPrimaryPolicy(session.primary.controller);
    setAutomatic(Boolean(session.continuous));
    setPauseOnIncident(!session.continuous);
  }, [session?.id]);
  async function applyPolicies() {
    setRunning(false);
    const next = await command({command:'configure',primary:primaryPolicy,baseline:baselinePolicy,continuous:true});
    if (next) { setAutomatic(true); setPauseOnIncident(false); }
  }
  const policyAvailable = (policy: string) => !['S','A','F'].includes(policy) || releases.some(release => release.arm === policy && release.case_id === (setup ? scenario : session?.case_id ?? scenario) && release.available);
  const workshopField = <label className="sim-field sim-workshop-picker">Workshop
    <select aria-label="Workshop" value={layoutId} disabled={busy} onChange={e=>void chooseWorkshop(e.target.value as LayoutId)}>
      {factoryLayouts.map(layout=><option key={layout.id} value={layout.id}>{layout.name}</option>)}
    </select>
  </label>;
  const policyFields = <div className="sim-policy-fields">
    <label className="sim-field">Maintenance policy<select aria-label="Maintenance policy" value={primaryPolicy} disabled={busy} onChange={e=>setPrimaryPolicy(e.target.value)}>
      {Object.entries(policyNames).map(([key,name])=><option key={key} value={key} disabled={!policyAvailable(key)}>{name}</option>)}
    </select></label>
  </div>;
  const notifications=incidentNotifications(session?.primary.records??[]);
  function openScenarioSetup() {
    if (!session) return;
    setRunning(false);
    setScenario(session.case_id);
    setMode(session.mode);
    setSeed(session.physical_seed);
    setSetup(true);
  }

  const showSetup = setup || (!session && !loading);
  const showFloor = activeView === 'overview' && factoryView === '3d' && Boolean(session) && !showSetup;
  const status = session?.status === 'REVIEW' ? 'Awaiting decision'
    : session?.status === 'COMPLETE' ? 'Complete'
    : running ? 'Running' : 'Paused';
  return <AppShell title={labels[activeView]} simulationId={session?.id} workshopId={layoutId}><main ref={workspace} className={showFloor ? "simulation-workspace sim-floor-workspace" : "simulation-workspace"}>
    {showFloor ? <h1 className="sr-only">{labels[activeView]}</h1> : <header className="sim-page-heading">
      <div>
        <p className="research-eyebrow"><Activity size={14} aria-hidden="true" /> Factory simulation</p>
        <h1>{labels[activeView]}</h1>
        <p>{activeView === 'overview' && session && !showSetup
          ? scenarioNames[session.case_id] ?? descriptions.overview
          : descriptions[activeView]}</p>
      </div>
      {expanded && <button className="sim-button" type="button" onClick={() => void toggleFullscreen()}>
        <Minimize size={14} aria-hidden="true" /> Exit full screen
      </button>}
      {session && <button className="sim-button" disabled={busy} aria-expanded={showSetup} onClick={showSetup ? () => setSetup(false) : openScenarioSetup}>
        <RotateCcw size={14} aria-hidden="true" />{showSetup ? 'Cancel' : 'Change scenario'}
      </button>}
    </header>}
    {error && <div role="alert" className="sim-error">{error}<button onClick={()=>{if(current.current){setLoading(true);researchRequest<Simulation>(`/demo/sessions/${current.current.id}`).then(accept).catch(e=>setError(e.message)).finally(()=>setLoading(false));}}}>Reload session</button></div>}
    {showSetup && <section className="sim-panel sim-setup">
      <div className="sim-panel-heading"><h2>{session ? 'Choose a scenario for a new session' : 'Start a simulation'}</h2></div>
      <div className="sim-setup-fields">
        <label className="sim-field">Scenario
          <select value={scenario} onChange={event => setScenario(event.target.value)}>
            {Object.entries(scenarioNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="sim-field">Maintenance decisions begin
          <select value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
            <option value="incident">After the first failure</option>
            <option value="policy">From the start</option>
          </select>
        </label>
      </div>
      {workshopField}
      {policyFields}
      <details className="sim-compatibility">
        <summary>Advanced settings</summary>
        <label className="sim-field">Simulation seed
          <input value={seed} onChange={event => setSeed(event.target.value)} pattern="99[0-9]{7}" />
        </label>
        {!/^99\d{7}$/.test(seed) && <p className="sim-footnote">Enter a 9-digit number starting with 99.</p>}
      </details>
      {available === false && <p role="status" className="sim-error">Simulation is unavailable for this scenario. {capabilityError}</p>}
      <button className="research-primary" disabled={busy || available !== true || !/^99\d{7}$/.test(seed)} onClick={() => void create(true)}>
        {busy ? 'Starting…' : 'Start simulation'}
      </button>
    </section>}
    {loading && <p role="status">Loading simulator session…</p>}
    {session && !showSetup && <>
      {activeView !== 'dashboard' && <section className={showFloor ? 'sim-control-bar sim-floor-controls' : 'sim-control-bar'} aria-label="Simulation controls">
        {showFloor && <h2 className="sim-floor-eyebrow">Simulation</h2>}
        <div className="sim-clock">
          <span className={`sim-live-dot ${session.status === 'REVIEW' ? 'needs-review' : ''}`} aria-hidden="true" />
          <time dateTime={clock.iso}><strong>{clock.time}</strong><span>{clock.date}</span></time>
          <span>{status}</span>
        </div>
        <p className="sim-clock-scale">Simulated time · 15 min / step</p>
        {workshopField}
        {policyFields}
        {(primaryPolicy !== session.primary.controller || !session.continuous) && <button className="sim-button" disabled={busy || !policyAvailable(primaryPolicy)} onClick={()=>void applyPolicies()}>{!session.continuous ? 'Enable continuous operation' : 'Apply policy'}</button>}
        <div className="sim-control-actions">
          <label className="sim-auto">
            <input type="checkbox" checked={pauseOnIncident} disabled={busy}
              onChange={event => setPauseOnIncident(event.target.checked)} />
            Pause on new failure
          </label>
          <label className="sim-auto">
            <input type="checkbox" checked={automatic} disabled={busy}
              onChange={event => setAutomatic(event.target.checked)} />
            Auto-approve decisions
          </label>
          {showFloor ? <div className="sim-floor-speed">
            <span>Speed</span>
            <div role="group" aria-label="Simulation speed">
              {[[2000, '1×'], [1000, '2×'], [400, '5×']].map(([delay, label]) => (
                <button key={delay} type="button" aria-pressed={speed === delay}
                  onClick={() => setSpeed(Number(delay))}>{label}</button>
              ))}
            </div>
          </div> : <select aria-label="Simulation speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}>
            <option value={2000}>1×</option>
            <option value={1000}>2×</option>
            <option value={400}>5×</option>
          </select>}
          <div className="sim-playback-buttons">
          <button className="sim-button" disabled={session.status !== 'RUNNING' || busy}
            onClick={() => { setRunning(false); void command({command:'advance', autoApprove:automatic}); }}>
            <SkipForward size={14} aria-hidden="true" />Step
          </button>
          <button className="research-primary" disabled={session.status !== 'RUNNING'} onClick={() => setRunning(value => !value)}>
            {running ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            {running ? 'Pause' : 'Run simulator'}
          </button>
          </div>
          {showFloor && <button className="sim-button sim-floor-scenario" type="button" disabled={busy}
            title={scenarioNames[session.case_id]} onClick={openScenarioSetup}>
            <RotateCcw size={14} aria-hidden="true" /> Change scenario
          </button>}
        </div>
      </section>}
      {selectedMachine!==null&&<MachineDetail layout={selectedLayout} clockSession={session} machine={selectedMachine} lane={session.primary} config={session.config} proposal={session.pending?.action??[]} onClose={()=>setSelectedMachine(null)} decisionAction={session.status!=='COMPLETE'&&session.activated?<div><p className="sim-footnote">If there is no assignment to review, the simulation may advance one simulation step.</p><button className="research-primary" disabled={busy} onClick={()=>void inspectDecision()}>View dispatch proposal<ArrowRight size={14} aria-hidden="true"/></button></div>:undefined}/>}
      {session.status === 'REVIEW' && activeView === 'overview' && factoryView === '2d' && <div className="sim-alert">
        <AlertTriangle size={18} aria-hidden="true" />
        <div><strong>Maintenance proposal ready</strong></div>
        <button className="research-primary" onClick={() => openView('decision', session.id)}>
          Review assignments<ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>}
      {activeView === 'overview' && <>
        {showFloor && <FactoryStatus lane={session.primary} />}
        <section className={showFloor ? "sim-floor-panel" : "sim-panel sim-factory-panel"} aria-label="Factory floor">
          <div className="sim-panel-heading">
            {!showFloor && <h2>Machines and technicians</h2>}
            <div className="sim-floor-actions">
              {showFloor && session.pending && <button type="button" className="research-primary" onClick={() => openView('decision', session.id)}>
                Review assignments <ArrowRight size={14} aria-hidden="true" />
              </button>}
              {showFloor && typeof document !== 'undefined' && document.fullscreenEnabled && (
                <button type="button" className="sim-button" onClick={() => void toggleFullscreen()}>
                  {expanded ? <Minimize size={14} aria-hidden="true" /> : <Maximize size={14} aria-hidden="true" />}
                  {expanded ? 'Exit full screen' : 'Full screen'}
                </button>
              )}
              <div className="sim-factory-toggle" role="group" aria-label="Factory view">
                <button type="button" className="sim-button" aria-pressed={factoryView === '2d'} onClick={() => chooseFactoryView('2d')}>2D</button>
                <button type="button" className="sim-button" aria-pressed={factoryView === '3d'}
                  onClick={() => chooseFactoryView('3d')}>3D</button>
              </div>
            </div>
          </div>
          {showFloor && expandError && <p className="sim-footnote" role="status">Full screen is unavailable in this browser.</p>}
          {previewUnavailable && <p className="sim-footnote" role="status">3D could not load. Select 3D to try again.</p>}
          {factoryView === '3d'
            ? <FactoryPreview key={`${session.id}:${layoutId}`} layout={selectedLayout} lane={session.primary} config={session.config} clockSession={session} proposal={session.pending?.action} running={running}
                selected={station} onSelect={selectStation} onInspect={inspectMachine} onUnavailable={showFleet} />
            : <FleetView layout={selectedLayout} lane={session.primary} config={session.config} proposal={session.pending?.action} onInspect={inspectMachine} />}
        </section>
        {showFloor
          ? <FactoryTimeline session={session} records={session.primary.records} selected={station} onSelect={selectStation} />
          : <section className="sim-panel sim-notifications" aria-label="Incident notifications"><div className="sim-panel-heading"><h2>Incident notifications</h2></div>
          <ul aria-live="polite" aria-relevant="additions">{notifications.slice(0,1).map(e=><li key={`${e.tick}-${e.type}-${e.machine}-${e.component}`}><button className={e.type==='failure'?'sim-notice-failure':'sim-notice-resolved'} onClick={()=>{setRunning(false);setSelectedMachine(e.machine);}}>{e.type==='failure'?<AlertTriangle size={16} aria-hidden="true"/>:<CheckCircle2 size={16} aria-hidden="true"/>}<span><strong>{e.type==='failure'?`M${e.machine+1} / C${e.component+1} failure detected`:`M${e.machine+1} / C${e.component+1} corrective service completed`}</strong><small>{simulationTime(session,e.tick).time}</small></span><ArrowRight size={14} aria-hidden="true"/></button></li>)}</ul>
          {notifications.length>1&&<details className="sim-notification-history"><summary>Event history ({notifications.length-1} earlier events)</summary><ul>{notifications.slice(1).map(e=><li key={`${e.tick}-${e.type}-${e.machine}-${e.component}`}><button onClick={()=>{setRunning(false);setSelectedMachine(e.machine);}}>{simulationTime(session,e.tick).time} · M{e.machine+1}/C{e.component+1} · {e.type==='failure'?'Failure detected':'Corrective service completed'}<ArrowRight size={13} aria-hidden="true"/></button></li>)}</ul></details>}
          {!notifications.length&&<p className="sim-footnote">No incidents recorded.</p>}
        </section>}
      </>}
      {activeView === 'dashboard' && <><div className="sim-dashboard-toolbar">{workshopField}<p>{selectedLayout.description}</p><button className="sim-button" disabled={busy} onClick={()=>void refreshSession()}><RotateCcw size={14}/> Refresh data</button><button className="sim-button" onClick={()=>openView('overview',session.id)}>Open simulation <ArrowRight size={14}/></button></div><FactoryDashboard session={session} layout={selectedLayout} onSelectMachine={machine=>{selectStation(machine);openView('overview',session.id);}} /></>}
      {activeView === 'decision' && <DecisionView session={session} busy={busy} onDecide={decide} />}
      {activeView === 'agents' && <Workflow session={session} />}
      {activeView === 'compare' && <ComparisonView layout={selectedLayout} session={session} />}
    </>}
  </main></AppShell>;
}

function FactoryStatus({ lane }: { lane: Lane }) {
  const machines = lane.state.components.length;
  const servicing = lane.state.jobs.filter(job => job !== null).length;
  const stopped = lane.state.components.filter((components, machine) =>
    components.some(component => component.failed) && !lane.state.jobs.some(job => job?.machine === machine),
  ).length;

  return <aside className="sim-floor-hud" aria-label="Factory status">
    <h2 className="sim-floor-eyebrow">Factory status</h2>
    <dl>
      <div><dt>Working</dt><dd>{machines - servicing - stopped}</dd></div>
      <div><dt>Breakdown</dt><dd>{stopped}</dd></div>
      <div><dt>In service</dt><dd>{servicing}</dd></div>
      <div><dt>Technicians free</dt><dd>{lane.state.jobs.length - servicing}</dd></div>
    </dl>
  </aside>;
}

function FactoryTimeline({ session, records, selected, onSelect }: {
  session: Simulation; records: SimulationRecord[]; selected: number | null; onSelect: (machine: number) => void;
}) {
  const events = records.flatMap(record => record.events)
    .filter(event => event.type === 'failure' || event.type === 'start' || event.type === 'completion')
    .reverse().sort((a, b) => b.tick - a.tick || Number(b.type === 'failure') - Number(a.type === 'failure'));
  const [showAll, setShowAll] = useState(false);
  return <section className="sim-panel sim-factory-timeline" aria-label="Factory timeline">
    <div className="sim-panel-heading">
      <h2>Factory timeline</h2>
      {events.length > 1 && <button type="button" className="sim-button" aria-expanded={showAll}
        onClick={() => setShowAll(value => !value)}>{showAll ? 'Hide history' : `Event history (${events.length})`}</button>}
    </div>
    {events.length ? <ol>{events.slice(0, showAll ? undefined : 1).map((event, index) => {
      const description = event.type === 'failure' ? 'Failure detected'
        : event.type === 'start' ? 'Maintenance started' : 'Maintenance completed';
      return <li key={`${event.tick}-${event.machine}-${event.component}-${event.type}-${index}`}>
        <button type="button" aria-pressed={selected === event.machine} onClick={() => onSelect(event.machine)}>
          <time className="sim-timeline-tick" dateTime={simulationTime(session,event.tick).iso} title={simulationTime(session,event.tick).date}>{simulationTime(session,event.tick).time}</time>
          <span className="sim-timeline-dot" data-event={event.type} aria-hidden="true" />
          <strong>{description}</strong>
          <span>M{event.machine + 1} / C{event.component + 1}{event.technician == null ? '' : ` · T${event.technician + 1}`}</span>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </li>;
    })}</ol> : <p className="sim-footnote">No machine or maintenance events yet.</p>}
  </section>;
}

function Workflow({session}:{session:Simulation}) {
  return <section className="sim-panel sim-agent-workflow"><div className="sim-panel-heading"><div><h2>Activity log</h2></div></div>{!session.workflow.length?<p className="sim-footnote">No decisions recorded yet.</p>:<ol className="sim-workflow">{session.workflow.slice().reverse().map((e,i)=><li key={i}><span className="sim-workflow-tick">{simulationTime(session,e.tick).time}</span><div><strong>{e.stage.replaceAll('_',' ')}</strong><p>{e.message}</p></div><CheckCircle2 size={16} aria-hidden="true"/></li>)}</ol>}</section>;
}
