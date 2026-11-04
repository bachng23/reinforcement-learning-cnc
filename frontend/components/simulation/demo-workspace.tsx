"use client";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Activity, Play, Pause, SkipForward, RotateCcw } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { researchRequest } from '@/lib/research-api/client';
import { liveApi } from '@/lib/simulation/live-api';
import { useLiveRead } from '@/lib/simulation/use-live-read';
import { useLiveSimulation } from '@/lib/simulation/use-live-simulation';
import type { Matching, Simulation } from '@/lib/simulation/types';
import type { DemoIncident } from '@/types/generated/demo-read';
import { FleetView } from './fleet-view';
import { FactoryMap } from './factory-map';
import { MachineDetail } from './machine-detail';
import { IncidentCenter } from './incident-center';
import { ComparisonView } from './comparison-view';
import { DecisionView } from './decision-view';

export type DemoView = 'overview' | 'decision' | 'agents' | 'compare';
const labels = {overview: 'Live simulation', decision: 'Decision Center', agents: 'AI coordination workflow', compare: 'Compare controllers'};
const routes = {overview: '/overview', decision: '/decisions', agents: '/agents', compare: '/what-if'};
function querySelection() {
  const query = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  return {session: query.get('session'), machine: query.get('machine'), incident: query.get('incident')};
}
export function DemoWorkspace({view = 'overview', initialId}: {view?: DemoView; initialId?: string}) {
  const router = useRouter(); const sim = useLiveSimulation(initialId); const session = sim.session;
  const {setRunning} = sim;
  const [selection, setSelection] = useState(querySelection);
  const [scenario, setScenario] = useState<'base' | 'generalist'>('base'); const [seed, setSeed] = useState('990000001');
  const [mode, setMode] = useState<'incident' | 'policy'>('incident'); const [setup, setSetup] = useState(false);
  const capability = useLiveRead(sim.actor ? `${sim.actor.id}:${scenario}` : undefined, signal => researchRequest<{learned_releases: {arm: string; case_id: string; available: boolean}[]}>('/capabilities', {signal}));
  const available = ['S', 'F'].every(arm => capability.data?.learned_releases.some(release => release.arm === arm && release.case_id === scenario && release.available));
  const observation = useLiveRead(session ? `${sim.actor?.id}:${session.id}:${session.revision}` : undefined, signal => liveApi.observation(session!.id, session!.revision, signal));
  useEffect(() => {
    const read = () => setSelection(querySelection()); read();
    window.addEventListener('popstate', read); window.addEventListener('sim-selection-change', read);
    return () => { window.removeEventListener('popstate', read); window.removeEventListener('sim-selection-change', read); };
  }, []);
  useEffect(() => { if (observation.error !== undefined) setRunning(false); }, [observation.error, setRunning]);
  function select(machine?: string, incident?: string) {
    sim.setRunning(false);
    const url = new URL(window.location.href);
    for (const [key, value] of [['machine', machine], ['incident', incident]]) {
      if (value) url.searchParams.set(key!, value); else url.searchParams.delete(key!);
    }
    window.history.replaceState(null, '', url); setSelection(querySelection());
  }
  const inspectIncident = (incident: DemoIncident) => select(incident.machineId, incident.incidentId);
  const selected = session && selection.session === session.id ? selection : undefined;
  const query = new URLSearchParams(); if (session) query.set('session', session.id);
  if (selected?.machine) query.set('machine', selected.machine); if (selected?.incident) query.set('incident', selected.incident);
  const suffix = session ? `?${query}` : '';
  const commandDisabled = sim.busy || !!sim.uncertain || !sim.canWrite || sim.loading || !observation.data;
  async function decide(action: Matching | null, reason: string) {
    sim.setRunning(false);
    const matching = action?.map(([machine, component, technician]) => [machine, component, technician] satisfies [number, number, number]);
    const next = await sim.command(matching === undefined ? {command: 'approve', reason} : {command: 'override', action: matching, reason});
    if (next) router.push(`/overview?${new URLSearchParams({session: next.id})}`);
  }
  async function retryCommand() {
    const kind = sim.uncertain?.body.command;
    const next = await sim.retryCommand();
    if (next && (kind === 'approve' || kind === 'override')) router.push(`/overview?${new URLSearchParams({session: next.id})}`);
  }
  const focused = observation.data?.incidents.find(incident => incident.incidentId === selected?.incident);
  return <AppShell title={labels[view]} simulationId={session?.id}><main className="simulation-workspace">
    <header className="sim-page-heading"><div><p className="research-eyebrow"><Activity size={14} aria-hidden="true"/> JCST/1.1 · Engineering simulation</p><h1>{labels[view]}</h1><p>Observe the factory, inspect an incident, review a policy and watch actual service progress.</p></div><button className="sim-button" disabled={sim.busy || !!sim.uncertain} onClick={() => {sim.setRunning(false); setSetup(value => !value);}}><RotateCcw size={14} aria-hidden="true"/>New session</button></header>
    {sim.error && <div role="alert" className="sim-error">{sim.error}<button disabled={sim.busy} onClick={sim.refresh}>Reload session</button></div>}
    {sim.uncertain && <div role="status" className="sim-inline-note">The command outcome is uncertain. Other commands are blocked; recovery keeps the original revision, key and body.<button className="sim-button" disabled={sim.busy} onClick={() => void retryCommand()}>Retry same command</button></div>}
    {sim.actor === null && <p role="alert" className="sim-error">Sign in to view and control simulator sessions.</p>}
    {sim.loading && <p role="status">Loading session…</p>}
    {(setup || !session && !sim.loading) && sim.actor && <section className="sim-panel sim-setup"><div className="sim-panel-heading"><div><h2>Start a simulator session</h2><p>Registered S/F policies · explicit creation · no training or invented milestones.</p></div></div>
      <div className="sim-setup-fields"><label className="sim-field">Scenario<select disabled={sim.busy} value={scenario} onChange={event => setScenario(event.target.value as typeof scenario)}><option value="base">Base · two specialist technicians</option><option value="generalist">Generalist · three technicians</option></select></label><label className="sim-field">Control starts<select disabled={sim.busy} value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="incident">After first failure · shared WAIT prelude</option><option value="policy">At tick 0 · policy from start</option></select></label><label className="sim-field">Engineering seed<input disabled={sim.busy} value={seed} pattern="99[0-9]{7}" onChange={event => setSeed(event.target.value)}/></label></div>
      <p className="sim-footnote">Simulation time is measured in abstract ticks. Only installed, compatible learned policies may run. No catalogue-verified scenario is claimed without a Flex catalogue.</p>
      {!capability.loading && !available && <p role="status" className="sim-error">Learned runtime is unavailable: {capability.message || 'Compatible S/F checkpoints are not registered.'}<button onClick={capability.retry}>Retry capabilities</button></p>}
      {!sim.canWrite && <p className="sim-footnote">Read-only role: an ENGINEER or ADMIN is required to create or control a simulation.</p>}
      <button className="research-primary" disabled={sim.busy || !!sim.uncertain || !sim.canWrite || !available || !/^99\d{7}$/.test(seed)} onClick={async() => {if (await sim.create({case: scenario, seed, mode, primary: 'S', baseline: 'F'})) setSetup(false);}}>{sim.busy ? 'Creating…' : 'Create simulation'}</button>
    </section>}
    {session && <>
      <section className="sim-control-bar live-sticky-controls" aria-label="Simulation controls"><div className="sim-clock"><span className={`sim-live-dot ${session.status === 'REVIEW' ? 'needs-review' : ''}`}/><strong>Tick {session.primary.state.tick}<span> / {session.horizon + session.tail}</span></strong><span>{session.status === 'REVIEW' ? 'Awaiting decision' : session.status === 'COMPLETE' ? 'Episode complete' : sim.running ? 'Playing' : 'Paused'}</span></div><div className="sim-control-actions">
        <label className="sim-auto"><input type="checkbox" checked={sim.pauseOnFailure} onChange={event => sim.setPauseOnFailure(event.target.checked)}/>Pause on new failure</label>
        <label className="sim-auto"><input type="checkbox" checked={sim.automatic} disabled={sim.running || sim.busy || !sim.canWrite} onChange={event => sim.setAutomatic(event.target.checked)}/>Auto-approve future policy decisions</label>
        <select aria-label="Simulation speed" value={sim.speed} onChange={event => sim.setSpeed(Number(event.target.value))}><option value={1000}>×1</option><option value={500}>×2</option><option value={200}>×5</option></select>
        <button className="sim-button" disabled={commandDisabled || session.status !== 'RUNNING'} onClick={() => {sim.setRunning(false); void sim.command({command: 'advance', autoApprove: sim.automatic});}}><SkipForward size={14} aria-hidden="true"/>Step</button>
        <button className="research-primary" disabled={!sim.running && (commandDisabled || session.status !== 'RUNNING')} onClick={() => sim.setRunning(value => !value)}>{sim.running ? <Pause size={14} aria-hidden="true"/> : <Play size={14} aria-hidden="true"/>}{sim.running ? 'Pause' : 'Run simulator'}</button>
      </div></section>
      {sim.automatic && <p className="sim-inline-note" role="status">Auto-approval is enabled for future policy decisions in this page session. Confirmations are labelled automatic. Reload turns it off.</p>}
      <nav className="sim-view-tabs" aria-label="Simulation views">{(Object.keys(routes) as DemoView[]).map(key => <Link key={key} aria-current={view === key ? 'page' : undefined} onClick={() => sim.setRunning(false)} href={routes[key] + suffix}>{key === 'overview' ? 'Factory' : key === 'decision' ? 'Decision Center' : key === 'agents' ? 'AI workflow' : 'S/F comparison'}</Link>)}</nav>
      <div className="sim-context"><span>{session.case_id} · seed {session.physical_seed} · {session.mode === 'incident' ? 'Shared WAIT prelude' : 'Policy from tick 0'}</span><span>Revision {session.revision} · {session.primary.controller}{session.primary.overrides ? ' + human override' : ''} / {session.baseline.controller}</span></div>
      {session.status === 'REVIEW' && view !== 'decision' && <div className="sim-alert"><div><strong>Policy matching ready for review at tick {session.pending?.tick}</strong><p>Both lanes are paused until an explicit confirmation.</p></div><Link className="research-primary" href={'/decisions' + suffix}>Review & dispatch</Link></div>}
      {observation.error !== undefined && <div role="alert" className="sim-error">{observation.message}<button onClick={observation.retry}>Retry observation</button><button onClick={sim.refresh}>Reload synchronized state</button></div>}
      {view === 'compare' ? <ComparisonView session={session}/> : view === 'agents' ? <Workflow session={session}/> : <>
        {view === 'decision' && <DecisionView session={session} busy={commandDisabled} onDecide={decide} focusMachine={focused?.machineId ?? selected?.machine ?? undefined} focusComponent={focused?.componentId}/>}
        {observation.loading && <section className="sim-panel" role="status">Loading factory and incidents at revision {session.revision}…</section>}
        {observation.data && <div className="live-monitor-grid"><section className="sim-panel sim-factory-panel"><div className="sim-panel-heading"><div><h2>{observation.data.context?.factory.name ?? 'Factory state'}</h2><p>API boundary {observation.data.tick} · machine status and actual commitments</p></div><span className="evidence-badge">{observation.data.status}</span></div><div className="live-map-scroll"><FactoryMap observation={observation.data} onInspect={id => select(id)}/></div><details className="live-component-details"><summary>Components, technician assignments and proposed matching</summary><FleetView lane={session.primary} config={session.config} proposal={session.pending?.action} onInspect={id => select(id)}/></details></section><IncidentCenter key={`${sim.actor?.id}:${session.id}`} scope={`${sim.actor?.id}:${session.id}`} incidents={observation.data.incidents} onInspect={inspectIncident}/></div>}
      </>}
      {view === 'overview' && selected && (selected.machine || selected.incident) && <MachineDetail session={session} machine={selected.machine ?? undefined} incident={selected.incident ?? undefined} incidents={observation.data?.incidents ?? []} onInspectIncident={inspectIncident} onClose={() => select()} canPrepare={!commandDisabled && session.status === 'RUNNING'} onPrepare={() => {sim.setRunning(false); void sim.command({command: 'advance', autoApprove: false});}}/>}
      <section className="sim-provenance"><p>Simulator source <code>{session.source_commit}</code>. Assignments are not travel animation. <Link href="/research">Research evidence →</Link></p><details><summary>Checkpoint provenance</summary>{Object.entries(session.releases).map(([arm, release]) => <p key={arm}>{arm} · {release.release_id}<br/><code>{release.sha256}</code></p>)}</details></section>
    </>}
    <footer className="sim-footer">Engineering simulation only. Scientific campaign records are unchanged. <Link href="/legacy/overview">Legacy sample workspace</Link></footer>
  </main></AppShell>;
}
function Workflow({session}: {session: Simulation}) {
  return <section className="sim-panel sim-agent-workflow"><div className="sim-panel-heading"><div><h2>AI coordination workflow</h2><p>Actual observations, policy calls, validation and confirmations. No generated LLM explanation.</p></div><span className="evidence-badge">{session.status}</span></div>{!session.workflow.length ? <p className="sim-footnote">No workflow events yet.</p> : <ol className="sim-workflow">{session.workflow.slice().reverse().map((entry, index) => <li key={index}><span className="sim-workflow-tick">t{entry.tick}</span><div><strong>{entry.stage}</strong><p>{entry.message}</p></div></li>)}</ol>}</section>;
}
