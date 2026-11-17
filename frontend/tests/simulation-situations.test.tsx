import type {ReactNode} from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
import {DemoWorkspace} from '@/components/simulation/demo-workspace';
import {SituationPanels} from '@/components/simulation/situation-panels';
import {CreateIncidentPanel} from '@/components/simulation/create-incident';
import {InjectedIncidents} from '@/components/simulation/injected-incidents';
import {WorkspaceUserContext} from '@/lib/workspace-user';
import {researchRequest} from '@/lib/research-api/client';
import type {SituationExecutor} from '@/lib/simulation/situations';
import type {Simulation} from '@/lib/simulation/types';
import {branchSession,branchId,savedSituation,sourceSession,sourceId,injected} from './situation-fixtures';

vi.mock('@/components/app-shell',()=>({AppShell:({children}:{children:ReactNode})=><>{children}</>}));
vi.mock('@/lib/research-api/client',()=>({researchRequest:vi.fn()}));
vi.mock('@/lib/simulation/use-machine-inspection',()=>({useMachineInspection:()=>({context:undefined,loading:false,retry:vi.fn()})}));
vi.mock('@/components/simulation/factory-preview',()=>({FactoryPreview:()=>null}));
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();window.history.replaceState(null,'','/simulation');});
const capabilities={learned_releases:[]};

it('save pauses/drains an in-flight step, reads its latest revision and sends metadata only',async()=>{
  let latest=sourceSession(6);let finish!:(value:Simulation)=>void;let reads=0;
  vi.mocked(researchRequest).mockImplementation(async(path,options)=>{
    if(path==='/capabilities')return capabilities as never;
    if(path.endsWith('/commands'))return await new Promise<Simulation>(resolve=>{finish=resolve;}) as never;
    if(path.endsWith('/snapshots')&&options?.body)return {...savedSituation(7),name:'Latest boundary',layoutId:'machining'} as never;
    reads++;return latest as never;
  });
  render(<DemoWorkspace initialId={sourceId}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Step'}));
  await userEvent.click(screen.getByRole('button',{name:'Save situation'}));
  const dialog=screen.getByRole('dialog');expect(dialog).toHaveTextContent('Pausing playback');expect(reads).toBe(1);
  latest=sourceSession(7);await act(async()=>finish(latest));
  await waitFor(()=>expect(within(dialog).getByLabelText('Situation name')).toBeEnabled());
  expect(dialog).toHaveTextContent('revision 14');
  await userEvent.type(within(dialog).getByLabelText('Situation name'),'Latest boundary');
  await userEvent.click(within(dialog).getByRole('button',{name:'Save situation'}));
  await waitFor(()=>expect(researchRequest).toHaveBeenCalledWith(`/demo/sessions/${sourceId}/snapshots`,expect.objectContaining({body:{revision:14,name:'Latest boundary',description:'',layoutId:'machining'},key:expect.any(String)})));
  expect(await screen.findByText('Saved “Latest boundary”')).toBeInTheDocument();
  expect(vi.mocked(researchRequest).mock.calls.filter(([path])=>path.endsWith('/commands'))).toHaveLength(1);
});
it('opens an immutable situation as a new paused session, preserving work and clock after the source advanced',async()=>{
  const restored=branchSession(6);
  vi.mocked(researchRequest).mockImplementation(async(path,options)=>{
    if(path==='/capabilities')return capabilities as never;
    if(path.startsWith('/demo/snapshots?'))return {items:[savedSituation()],nextCursor:null} as never;
    if(path.endsWith('/sessions')&&options?.body)return restored as never;
    if(path.startsWith('/demo/snapshots/'))return savedSituation() as never;
    if(path.endsWith('/incidents'))return {sessionId:branchId,revision:0,tick:6,source:'JCST_SIMULATION',events:[]} as never;
    return (path.endsWith(branchId)?restored:sourceSession(7)) as never;
  });
  render(<DemoWorkspace initialId={sourceId}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Saved situations'}));
  await userEvent.click(await screen.findByRole('button',{name:/Maintenance exercise.*t6/}));
  await userEvent.click(await screen.findByRole('button',{name:'Open as new session'}));
  await waitFor(()=>expect(new URLSearchParams(window.location.search).get('session')).toBe(branchId));
  expect(screen.getByRole('button',{name:'Run simulator'})).toBeEnabled();expect(screen.queryByRole('button',{name:'Pause'})).not.toBeInTheDocument();
  expect(screen.getByText(/Opened “Maintenance exercise”/)).toHaveTextContent('t6');
  expect(screen.getByLabelText('Workshop')).toHaveValue('machining');
  expect(screen.getAllByText(/15 min/).length).toBeGreaterThan(0);
  expect(vi.mocked(researchRequest).mock.calls.filter(([path])=>path.endsWith('/commands'))).toHaveLength(0);
});
it('creates M3/C2 now from a restored session without advancing, then renders the server outcome',async()=>{
  let current=branchSession(7);
  vi.mocked(researchRequest).mockImplementation(async(path,options)=>{
    if(path==='/capabilities')return capabilities as never;
    if(path.endsWith('/incidents')&&options?.body){
      const body=options.body as {reason:string};current=structuredClone(current);current.revision=1;current.primary.state.components[2][1].failed=true;current.incidents=[{...injected(),requestedReason:body.reason}];
      return {session:current,event:current.incidents[0]} as never;
    }
    if(path.endsWith('/incidents'))return {sessionId:branchId,revision:current.revision,tick:7,source:'JCST_SIMULATION',events:current.incidents} as never;
    return current as never;
  });
  render(<DemoWorkspace initialId={branchId}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Inspect machine M3'}));
  const dialog=screen.getByRole('dialog');await userEvent.click(within(dialog).getByRole('button',{name:'Create incident'}));
  await waitFor(()=>expect(within(dialog).getByRole('region',{name:'Incident execution review'})).toHaveTextContent('t7'));
  await userEvent.selectOptions(within(dialog).getByRole('combobox',{name:'Incident component'}),'1');
  await userEvent.type(within(dialog).getByLabelText('Incident note'),'Training failure');
  await userEvent.click(within(dialog).getByRole('button',{name:'Create injected incident'}));
  expect(await screen.findByText('Injected incident · APPLIED',{selector:'strong'})).toBeInTheDocument();
  expect(dialog).toHaveTextContent('C2 · FAILED');expect(current.tick).toBe(7);
  expect(researchRequest).toHaveBeenCalledWith(`/demo/sessions/${branchId}/incidents`,expect.objectContaining({body:{revision:0,machineIndex:2,componentIndex:1,scheduledTick:7,reason:'Training failure'},key:expect.any(String)}));
});
it('lists cursor pages, searches loaded names and never uses current machine state as saved summary',async()=>{
  const older={...savedSituation(),snapshotId:'10000000-0000-4000-8000-000000000099',name:'Older saved case'};
  vi.mocked(researchRequest).mockImplementation(async path=>path.includes('cursor=')?{items:[savedSituation(),older],nextCursor:null} as never:path.includes('?')?{items:[savedSituation()],nextCursor:'opaque+/='} as never:savedSituation() as never);
  render(<SituationPanels mode="library" layoutId="machining" prepare={vi.fn()} execute={vi.fn()} onOpened={vi.fn()} onClose={vi.fn()}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Load more situations'}));
  expect(await screen.findByRole('button',{name:/Older saved case/})).toBeInTheDocument();
  expect(screen.getAllByRole('button',{name:/Maintenance exercise.*t6/})).toHaveLength(1);
  await userEvent.type(screen.getByLabelText('Search loaded situations'),'Older');
  expect(screen.queryByRole('button',{name:/Maintenance exercise.*t6/})).not.toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Search loaded situations'));
  await userEvent.click(screen.getByRole('button',{name:/Maintenance exercise.*t6/}));
  expect(await screen.findByText(/Saved machine conditions and active-service details are not provided/)).toBeInTheDocument();
});
it('requires refresh and explicit reconfirmation after a stale incident; then sends a new absolute tick',async()=>{
  const initial=branchSession(7);const latest=structuredClone(initial);latest.primary.state.tick=8;latest.baseline.state.tick=8;latest.tick=8;latest.revision=3;
  const prepare=vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(latest);
  const execute=vi.fn<SituationExecutor>().mockRejectedValueOnce({status:409,code:'DEMO_STALE'}).mockRejectedValue(new TypeError('offline'));
  render(<CreateIncidentPanel session={initial} machine={2} prepare={prepare} execute={execute} onReview={vi.fn()} onBusy={vi.fn()}/>);
  await userEvent.click(screen.getByRole('button',{name:'Create incident'}));
  await waitFor(()=>expect(screen.getByLabelText('Incident note')).toBeEnabled());
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Execution'}),'after');await userEvent.type(screen.getByLabelText('Incident note'),'After two steps');
  await userEvent.click(screen.getByRole('button',{name:'Create injected incident'}));await screen.findByRole('alert');
  expect(screen.getByRole('button',{name:'Create injected incident'})).toBeDisabled();
  await userEvent.click(screen.getByRole('button',{name:'Refresh incident context'}));
  await screen.findByRole('button',{name:'Confirm updated execution time'});expect(screen.getByRole('button',{name:'Create injected incident'})).toBeDisabled();
  expect(screen.getByRole('region',{name:'Incident execution review'})).toHaveTextContent('Apply at t10');
  await userEvent.click(screen.getByRole('button',{name:'Confirm updated execution time'}));await userEvent.click(screen.getByRole('button',{name:'Create injected incident'}));
  expect(execute.mock.calls[0][0]).toMatchObject({body:{revision:0,scheduledTick:9}});expect(execute.mock.calls[1][0]).toMatchObject({body:{revision:3,scheduledTick:10}});
  expect(execute.mock.calls[0][1]).not.toBe(execute.mock.calls[1][1]);
});
it('uses backend REVIEW conflict guidance and does not synthesize a repair or a failure',async()=>{
  const current=branchSession(7);const review=vi.fn();const execute=vi.fn<SituationExecutor>().mockRejectedValue({status:409,code:'DEMO_REVIEW_REQUIRED'});
  render(<CreateIncidentPanel session={current} machine={2} prepare={vi.fn().mockResolvedValue(current)} execute={execute} onReview={review} onBusy={vi.fn()}/>);
  await userEvent.click(screen.getByRole('button',{name:'Create incident'}));await userEvent.type(screen.getByLabelText('Incident note'),'Training');
  await userEvent.click(screen.getByRole('button',{name:'Create injected incident'}));
  await userEvent.click(await screen.findByRole('button',{name:'Review pending assignments'}));expect(review).toHaveBeenCalledOnce();expect(current.primary.state.components[2][1].failed).toBe(false);
});
it('shows APPLIED/SCHEDULED/SKIPPED as server states and preserves zero tick',()=>{
  const session=branchSession(7);const skipped={...injected('SKIPPED'),scheduledTick:0,appliedTick:0};const planned=injected('SCHEDULED');planned.eventId+='x';
  render(<InjectedIncidents session={session} read={{loading:false,retry:vi.fn(),data:{sessionId:branchId,revision:0,tick:7,source:'JCST_SIMULATION',events:[skipped,planned]}}} onInspect={vi.fn()}/>);
  expect(screen.getByText('Injected incident · SKIPPED')).toBeInTheDocument();expect(screen.getByText('Injected incident · SCHEDULED')).toBeInTheDocument();expect(screen.getByText(/Skipped: machine is in maintenance/)).toBeInTheDocument();
  expect(screen.getByText(/processed t0/)).toBeInTheDocument();
});
it('disables writes for VIEWER but keeps the library readable',async()=>{
  vi.mocked(researchRequest).mockImplementation(async path=>path.includes('?')?{items:[savedSituation()],nextCursor:null} as never:savedSituation() as never);
  render(<WorkspaceUserContext.Provider value={{id:'viewer',role:'VIEWER'}}><SituationPanels mode="library" layoutId="machining" execute={vi.fn()} prepare={vi.fn()} onOpened={vi.fn()} onClose={vi.fn()}/></WorkspaceUserContext.Provider>);
  await userEvent.click(await screen.findByRole('button',{name:/Maintenance exercise.*t6/}));
  expect(await screen.findByText(/Your role can read situations/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Open as new session'})).toBeDisabled();
});
it('library has retry for unavailable reads and closing returns focus to its opener',async()=>{
  vi.mocked(researchRequest).mockRejectedValueOnce({status:503}).mockResolvedValue({items:[],nextCursor:null} as never);
  const opener=document.createElement('button');document.body.appendChild(opener);opener.focus();const close=vi.fn();
  const view=render(<SituationPanels mode="library" layoutId="machining" execute={vi.fn()} prepare={vi.fn()} onOpened={vi.fn()} onClose={close}/>);
  await userEvent.click(await screen.findByRole('button',{name:'Retry list'}));expect(await screen.findByText(/No saved situations yet/)).toBeInTheDocument();
  fireEvent.keyDown(document,{key:'Escape'});expect(close).toHaveBeenCalledOnce();view.unmount();expect(opener).toHaveFocus();opener.remove();
});
it('recovers a lost save after remount with the original key/body even if the current source has advanced',async()=>{
  const execute=vi.fn<SituationExecutor>().mockRejectedValueOnce(new TypeError('response lost')).mockResolvedValue({kind:'save',snapshot:{...savedSituation(),name:'Frozen repair',layoutId:'machining'}});
  const props={mode:'save' as const,layoutId:'machining' as const,execute,onOpened:vi.fn(),onClose:vi.fn()};
  const first=render(<SituationPanels {...props} session={sourceSession(6)} prepare={vi.fn().mockResolvedValue(sourceSession(6))}/>);
  await userEvent.type(screen.getByLabelText('Situation name'),'Frozen repair');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Save situation'}));
  await screen.findByRole('alert');first.unmount();
  render(<SituationPanels {...props} session={sourceSession(7)} prepare={vi.fn().mockResolvedValue(sourceSession(7))}/>);
  const recover=await screen.findByRole('button',{name:'Recover previous save'});await waitFor(()=>expect(recover).toBeEnabled());
  expect(execute).toHaveBeenCalledTimes(1);await userEvent.click(recover);
  expect(await screen.findByText('Saved “Frozen repair”')).toBeInTheDocument();
  expect(execute.mock.calls[1][0]).toEqual(execute.mock.calls[0][0]);expect(execute.mock.calls[1][1]).toBe(execute.mock.calls[0][1]);
  expect(execute.mock.calls[1][0]).toMatchObject({basisTick:6,body:{revision:12}});
});
it('validates future offsets and handles REVIEW without inventing an immediate write',async()=>{
  const session={...branchSession(7),status:'REVIEW' as const};const execute=vi.fn<SituationExecutor>();
  const review=vi.fn();render(<CreateIncidentPanel session={session} machine={2} prepare={vi.fn().mockResolvedValue(session)} execute={execute} onReview={review} onBusy={vi.fn()}/>);
  await userEvent.click(screen.getByRole('button',{name:'Create incident'}));await userEvent.type(screen.getByLabelText('Incident note'),'Future exercise');
  expect(screen.getByRole('button',{name:'Create injected incident'})).toBeDisabled();await userEvent.click(screen.getByRole('button',{name:'Review pending assignments'}));expect(review).toHaveBeenCalledOnce();
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Execution'}),'after');
  const steps=screen.getByLabelText('Steps from current tick');
  for(const value of ['0','1.5','100001']){fireEvent.change(steps,{target:{value}});expect(screen.getByRole('button',{name:'Create injected incident'})).toBeDisabled();}
  fireEvent.change(steps,{target:{value:'2'}});expect(screen.getByRole('button',{name:'Create injected incident'})).toBeEnabled();expect(execute).not.toHaveBeenCalled();
});
it('aborts a machine form context read and ignores its late response when selecting another machine',async()=>{
  let finish!:(value:Simulation)=>void;let signal:AbortSignal|undefined;
  const prepare=vi.fn().mockImplementation((request:AbortSignal)=>{signal=request;return new Promise<Simulation>(resolve=>{finish=resolve;});});
  const session=branchSession(7);const props={session,prepare,execute:vi.fn(),onReview:vi.fn(),onBusy:vi.fn()};
  const view=render(<CreateIncidentPanel key="M3" machine={2} {...props}/>);await userEvent.click(screen.getByRole('button',{name:'Create incident'}));
  view.rerender(<CreateIncidentPanel key="M1" machine={0} {...props}/>);expect(signal?.aborted).toBe(true);await act(async()=>finish(session));
  expect(screen.queryByRole('region',{name:'Incident execution review'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Create incident'})).toHaveAttribute('aria-expanded','false');
});
it('refuses incident submission if the freshly read session completed while opening the form',async()=>{
  const original=branchSession(7);const completed={...original,status:'COMPLETE' as const};const execute=vi.fn<SituationExecutor>();
  render(<CreateIncidentPanel session={original} machine={2} prepare={vi.fn().mockResolvedValue(completed)} execute={execute} onReview={vi.fn()} onBusy={vi.fn()}/>);
  await userEvent.click(screen.getByRole('button',{name:'Create incident'}));await screen.findByText(/Completed sessions cannot create incidents/);await userEvent.type(screen.getByLabelText('Incident note'),'Training');
  expect(screen.getByRole('button',{name:'Create injected incident'})).toBeDisabled();expect(execute).not.toHaveBeenCalled();
});
it('uses the restored server layout on reload instead of a stale URL workshop',async()=>{
  const session=branchSession(7);window.history.replaceState(null,'',`/simulation?session=${branchId}&workshop=packaging`);
  vi.mocked(researchRequest).mockImplementation(async path=>path==='/capabilities'?capabilities as never:path.endsWith('/incidents')?{sessionId:branchId,revision:0,tick:7,source:'JCST_SIMULATION',events:[]} as never:session as never);
  render(<DemoWorkspace/>);expect(await screen.findByLabelText('Workshop')).toHaveValue('machining');
  expect(new URLSearchParams(window.location.search).get('workshop')).toBe('machining');
});
