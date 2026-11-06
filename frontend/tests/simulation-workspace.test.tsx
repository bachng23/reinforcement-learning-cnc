import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoWorkspace } from '@/components/simulation/demo-workspace';
import { ComparisonView } from '@/components/simulation/comparison-view';
import { researchRequest } from '@/lib/research-api/client';
import type { Simulation } from '@/lib/simulation/types';
import type { Episode } from '@/types/generated/jcst';
import fixture from '../../contracts/jcst/v1/fixtures/engineering-bundle.json';
vi.mock('@/components/app-shell',()=>({AppShell:({children}:{children:ReactNode})=><>{children}</>}));
vi.mock('@/lib/research-api/client',()=>({researchRequest:vi.fn()}));
vi.mock('@/components/simulation/factory-preview',()=>({
  FactoryPreview: ({ selected, onSelect }: { selected: number | null; onSelect: (machine: number) => void }) =>
    <div aria-label="3D factory">
      <button onClick={() => onSelect(2)}>Select M3</button>
      {selected !== null && <p>Selected machine M{selected + 1}</p>}
    </div>,
}));
const capabilities={learned_releases:[{arm:'S',case_id:'base',available:true},{arm:'F',case_id:'base',available:true}]};
function session():Simulation {
  const e=fixture.episodes[0] as unknown as Episode;const state=e.records[0].before;
  const lane=(controller:string)=>({controller,state,records:[],total_cost:0,controlled_cost:0,tail_cost:0,failures:0,unavailable_machine_ticks:0,technician_busy_ticks:0,overrides:0});
  return {id:'session-1',revision:6,case_id:'base',physical_seed:'990000001',mode:'incident',horizon:48,tail:16,source_commit:'c577b6be',config:e.config,releases:{S:{release_id:'S-root0-96k',sha256:'abc'},F:{release_id:'F-root0-96k',sha256:'def'}},primary:lane('S'),baseline:lane('F'),status:'REVIEW',activated:true,first_incident_tick:5,pending:{tick:0,action:[[0,0,0]],baseline_action:[],catalogue:[[],[[0,0,0]]]},workflow:[],decisions:[]};
}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();const values=new Map<string,string>();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key),clear:()=>values.clear()}});window.history.replaceState(null,'','/overview');});
afterEach(()=>vi.useRealTimers());
describe('live simulation workflow',()=>{
  it('restores a pending decision, keeps it frozen, then submits approval against its persisted revision',async()=>{
    const s=session();
    vi.mocked(researchRequest).mockImplementation(async(path,options)=>{
      if(path==='/capabilities')return capabilities as never;
      if(path.endsWith('/commands'))return {...s,revision:7,status:'RUNNING',pending:null,primary:{...s.primary,state:{...s.primary.state,tick:1}}} as never;
      return s as never;
    });
    render(<DemoWorkspace view="decision" initialId="session-1"/>);
    expect(await screen.findByText('Recommended assignments')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Run simulator'})).toBeDisabled();
    expect(screen.queryByRole('heading',{name:'Machines and technicians'})).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation',{name:'Simulation views'})).not.toBeInTheDocument();
    expect(vi.mocked(researchRequest).mock.calls.filter(([p])=>p.endsWith('/commands'))).toHaveLength(0);
    await userEvent.click(screen.getByRole('button',{name:'Approve & dispatch'}));
    await waitFor(()=>expect(researchRequest).toHaveBeenCalledWith('/demo/sessions/session-1/commands',expect.objectContaining({body:expect.objectContaining({revision:6,command:'approve'})})));
    expect(await screen.findByRole('heading',{name:'Simulation'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Pause'})).toBeEnabled();
    expect(screen.getByRole('checkbox',{name:'Auto-approve decisions'})).not.toBeChecked();
    expect(sessionStorage.getItem('mcc-demo-session')).toBe('session-1');
  });
  it('restores 3D and its selected machine after leaving Overview to approve a decision', async () => {
    const pending = session();
    vi.mocked(researchRequest).mockImplementation(async path => {
      if (path === '/capabilities') return capabilities as never;
      if (path.endsWith('/commands')) return {...pending, revision: 7, status: 'RUNNING', pending: null} as never;
      return pending as never;
    });

    const overview = render(<DemoWorkspace initialId="session-1" />);
    await userEvent.click(await screen.findByRole('button', { name: '3D' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Select M3' }));
    overview.unmount();
    window.history.replaceState(null, '', '/decisions?session=session-1');

    render(<DemoWorkspace view="decision" initialId="session-1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve & dispatch' }));

    expect(await screen.findByText('Selected machine M3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.pathname).toBe('/simulation');
  });
  it('shows runtime unavailability and does not silently use fixture policies',async()=>{
    vi.mocked(researchRequest).mockRejectedValue(new Error('Policy runtime unavailable'));
    render(<DemoWorkspace/>);
    expect(await screen.findByText(/Simulation is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Start simulation'})).toBeDisabled();
  });
  it('starts a real session via API rather than fabricating a local incident',async()=>{
    vi.mocked(researchRequest).mockImplementation(async(path)=>path==='/capabilities'?capabilities as never:{...session(),status:'RUNNING',pending:null} as never);
    render(<DemoWorkspace/>);
    const button=await screen.findByRole('button',{name:'Start simulation'});
    await waitFor(()=>expect(button).toBeEnabled());await userEvent.click(button);
    await waitFor(()=>expect(researchRequest).toHaveBeenCalledWith('/demo/sessions',expect.objectContaining({body:{case:'base',seed:'990000001',mode:'policy',primary:'S',baseline:'corrective',continuous:true}})));
    expect(await screen.findByRole('button',{name:'Pause'})).toBeEnabled();
  });
  it('enables continuous operation and switches policies without comparison controls or creating a new session', async () => {
    const original = session();
    vi.mocked(researchRequest).mockImplementation(async (path, options) => {
      if (path === '/capabilities') return capabilities as never;
      if (path.endsWith('/commands')) return {...original, revision:7, continuous:true, status:'RUNNING', pending:null, baseline:{...original.baseline,controller:'corrective'}} as never;
      return original as never;
    });
    render(<DemoWorkspace initialId="session-1" />);
    await screen.findByRole('button',{name:'Enable continuous operation'});
    expect(screen.queryByRole('combobox',{name:'Comparison policy'})).not.toBeInTheDocument();
    expect(screen.queryByRole('region',{name:'Live policy comparison'})).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Maintenance policy'}),'F');
    await userEvent.click(screen.getByRole('button',{name:'Enable continuous operation'}));
    await waitFor(()=>expect(researchRequest).toHaveBeenCalledWith('/demo/sessions/session-1/commands',expect.objectContaining({body:{revision:6,command:'configure',primary:'F',baseline:'corrective',continuous:true}})));
    expect(screen.getByRole('checkbox',{name:'Auto-approve decisions'})).toBeChecked();
    expect(screen.getByRole('checkbox',{name:'Pause on new failure'})).not.toBeChecked();
    expect(vi.mocked(researchRequest).mock.calls.some(([path])=>path==='/demo/sessions')).toBe(false);
  });
  it('creates a separate workshop session and restores the original workshop without resetting it', async () => {
    const original={...session(),status:'RUNNING',pending:null,continuous:true} as Simulation;
    const fabrication={...original,id:'fabrication-session',revision:0} as Simulation;
    vi.mocked(researchRequest).mockImplementation(async path=>{
      if(path==='/capabilities')return capabilities as never;
      if(path==='/demo/sessions')return fabrication as never;
      return original as never;
    });
    render(<DemoWorkspace initialId="session-1"/>);
    await screen.findByRole('combobox',{name:'Workshop'});
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Workshop'}),'fabrication');
    await waitFor(()=>expect(new URLSearchParams(window.location.search).get('session')).toBe('fabrication-session'));
    expect(window.localStorage.getItem('mcc-workshop:fabrication-session')).toBe('fabrication');
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Workshop'}),'machining');
    await waitFor(()=>expect(new URLSearchParams(window.location.search).get('session')).toBe('session-1'));
    expect(vi.mocked(researchRequest).mock.calls.filter(([path])=>path==='/demo/sessions')).toHaveLength(1);
    expect(window.localStorage.getItem('mcc-workshop-session:machining')).toBe('session-1');
  });
  it('keeps a human-overridden trajectory distinct and shows whichever policy has lower actual cost',()=>{
    const s=session();s.primary.overrides=1;s.primary.total_cost=150;s.baseline.total_cost=100;
    render(<ComparisonView session={s}/>);
    expect(screen.getByText('F has lower cost in this run')).toBeInTheDocument();
    expect(screen.getByRole('columnheader',{name:'S + human override'})).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.queryByText(/shared WAIT prelude/i)).not.toBeInTheDocument();
  });
  it('paces real intervals, pauses on failure and opens its machine without changing view',async()=>{
    vi.useFakeTimers();const user={click:async(element:HTMLElement)=>{await act(async()=>{fireEvent.click(element);});}};
    const initial={...session(),status:'RUNNING',activated:false,pending:null,first_incident_tick:null} as Simulation;
    const failed=structuredClone(initial);failed.activated=true;failed.first_incident_tick=1;failed.revision++;
    failed.primary.state.tick=1;failed.primary.state.components[2][1].failed=true;
    const e=fixture.episodes[0] as unknown as Episode;
    failed.primary.records=[{...e.records[0],events:[{type:'failure',tick:1,machine:2,component:1,uniform:'0.1'}]} as never];
    const review={...failed,status:'REVIEW',pending:session().pending,revision:8} as Simulation;
    vi.mocked(researchRequest).mockImplementation(async(path,options)=>{
      if(path==='/capabilities')return capabilities as never;
      if(path.endsWith('/commands'))return (options?.body as {autoApprove?:boolean})?.autoApprove===false&&vi.mocked(researchRequest).mock.calls.filter(([p])=>p.endsWith('/commands')).length>1?review as never:failed as never;
      return initial as never;
    });
    render(<DemoWorkspace initialId="session-1"/>);await act(async()=>{});
    expect(screen.getByRole('checkbox',{name:'Pause on new failure'})).toBeChecked();
    await user.click(screen.getByRole('button',{name:'Run simulator'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(1999);});
    expect(vi.mocked(researchRequest).mock.calls.filter(([p])=>p.endsWith('/commands'))).toHaveLength(0);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
    expect(screen.getByRole('button',{name:'Run simulator'})).toBeEnabled();
    expect(screen.getByRole('heading',{name:'Simulation'})).toBeInTheDocument();
    await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
    expect(vi.mocked(researchRequest).mock.calls.filter(([p])=>p.endsWith('/commands'))).toHaveLength(1);
    await user.click(screen.getByRole('button',{name:/M3 \/ C2 failure detected/}));
    expect(screen.getByRole('dialog')).toBeInTheDocument();expect(screen.getByText('Current simulation')).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'View dispatch proposal'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Recommended assignments')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/decisions');
    expect(new URLSearchParams(window.location.search).get('session')).toBe('session-1');
    expect(researchRequest).toHaveBeenCalledWith('/demo/sessions/session-1/commands',expect.objectContaining({body:{revision:7,command:'advance',autoApprove:false}}));
  });
  it('can keep running through failure when pause is disabled, then pauses without queuing more commands',async()=>{
    vi.useFakeTimers();const user={click:async(element:HTMLElement)=>{await act(async()=>{fireEvent.click(element);});}};
    const s={...session(),status:'RUNNING',pending:null} as Simulation;
    const e=fixture.episodes[0] as unknown as Episode;
    const next=structuredClone(s);next.revision++;next.primary.records=[{...e.records[0],events:[{type:'failure',tick:1,machine:0,component:0}]} as never];
    vi.mocked(researchRequest).mockImplementation(async(path)=>path==='/capabilities'?capabilities as never:path.endsWith('/commands')?next as never:s as never);
    render(<DemoWorkspace initialId="session-1"/>);await act(async()=>{});
    await user.click(screen.getByRole('checkbox',{name:'Pause on new failure'}));
    await user.click(screen.getByRole('button',{name:'Run simulator'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
    expect(screen.getByRole('button',{name:'Pause'})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Pause'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
    expect(vi.mocked(researchRequest).mock.calls.filter(([p])=>p.endsWith('/commands'))).toHaveLength(1);
  });
  it('restores incident history after reload without resuming or inventing alerts',async()=>{
    const s=session();const e=fixture.episodes[0] as unknown as Episode;
    s.primary.records=[{...e.records[0],events:[{type:'failure',tick:1,machine:2,component:1},{type:'completion',tick:3,machine:2,component:1,kind:'CM',technician:1}]} as never];
    vi.mocked(researchRequest).mockImplementation(async(path)=>path==='/capabilities'?capabilities as never:s as never);
    render(<DemoWorkspace initialId="session-1"/>);
    expect(await screen.findByRole('button',{name:/M3 \/ C2 corrective service completed/})).toBeInTheDocument();
    await userEvent.click(screen.getByText('Event history (1 earlier events)'));
    expect(screen.getByRole('button',{name:/\d{2}:\d{2} · M3\/C2 · Failure detected/})).toBeInTheDocument();
    expect(vi.mocked(researchRequest).mock.calls.filter(([p])=>p.endsWith('/commands'))).toHaveLength(0);
    expect(screen.queryByText('Auto demo')).not.toBeInTheDocument();
  });

});

describe('machine inspection',()=>{
  it('opens scenario context with live condition, then Escape restores focus',async()=>{
    const {FleetView}=await import('@/components/simulation/fleet-view');const s=session();
    const failed=structuredClone(s.primary);failed.state.components[2][1].failed=true;
    render(<FleetView lane={failed} config={s.config}/>);
    const trigger=screen.getByRole('button',{name:'Inspect machine M3'});await userEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Current simulation')).toBeInTheDocument();
    expect(screen.getByText('Line P1')).toBeInTheDocument();
    expect(screen.getByText('01 · SMT board assembly · Station 3')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(trigger).toHaveFocus();
  });
});
