import type {ReactNode} from 'react';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
import {TechnicianAvailabilityForm,TechnicianDetails} from '@/components/simulation/technician-details';
import {TechnicianActivity} from '@/components/simulation/technician-activity';
import {DecisionView} from '@/components/simulation/decision-view';
import {ComparisonView} from '@/components/simulation/comparison-view';
import {DemoWorkspace} from '@/components/simulation/demo-workspace';
import type {PrepareSituation} from '@/components/simulation/situation-panels';
import {WorkspaceUserContext} from '@/lib/workspace-user';
import type {TechnicianExecutor} from '@/lib/simulation/technicians';
import {embeddedTechnicians} from '@/lib/simulation/technicians';
import type {Simulation} from '@/lib/simulation/types';
import {researchRequest} from '@/lib/research-api/client';
import {commandResponse,returnedSession,technicianSession} from './technician-fixtures';

vi.mock('@/components/app-shell',()=>({AppShell:({children}:{children:ReactNode})=><>{children}</>}));
vi.mock('@/lib/research-api/client',()=>({researchRequest:vi.fn()}));
vi.mock('@/components/simulation/factory-preview',()=>({FactoryPreview:()=>null}));
beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage?.clear();
  window.history.replaceState(null, '', '/simulation');
});
const engineer={id:'10000000-0000-4000-8000-000000000002',username:'Engineer',role:'ENGINEER' as const};
const wrapper=({children}:{children:ReactNode})=><WorkspaceUserContext.Provider value={engineer}>{children}</WorkspaceUserContext.Provider>;
const read=(session:Simulation)=>({data:embeddedTechnicians(session),rows:session.technicians,loading:false,legacy:false,retry:vi.fn()});
const form=(session:Simulation,execute:TechnicianExecutor,prepare:PrepareSituation=async()=>session)=><TechnicianAvailabilityForm session={session} technician={0} read={read(session)} prepare={prepare} execute={execute} onBusy={vi.fn()}/>;
it('absence form reviews server clock, accepts three steps and treats optional reason using the contract default',async()=>{
  const session=technicianSession(),execute=vi.fn<TechnicianExecutor>().mockResolvedValue(technicianSession('ABSENT'));
  render(form(session,execute),{wrapper});await userEvent.click(screen.getByRole('button',{name:'Mark temporarily absent'}));
  expect(await screen.findByLabelText('Availability change review')).toHaveTextContent('Absent [t5, t8)');expect(screen.getByLabelText('Availability change review')).toHaveTextContent('45 min');
  await userEvent.click(screen.getByRole('button',{name:'Confirm temporary absence'}));expect(execute).toHaveBeenCalledWith({kind:'absence',sessionId:session.id,technicianIndex:0,basisTick:5,body:{revision:11,durationTicks:3,reason:'Temporary absence'}},expect.any(String),expect.any(AbortSignal));
});
it('rejects fractional/zero steps and fractional minute-to-step conversion without rounding',async()=>{
  const session=technicianSession();render(form(session,vi.fn()),{wrapper});await userEvent.click(screen.getByRole('button',{name:'Mark temporarily absent'}));
  const input=await screen.findByLabelText('Absence duration');for(const value of ['0','1.5','100001']){fireEvent.change(input,{target:{value}});expect(screen.getByRole('button',{name:'Confirm temporary absence'})).toBeDisabled();}
  await userEvent.selectOptions(screen.getByLabelText('Duration unit'),'minutes');fireEvent.change(input,{target:{value:'16'}});expect(screen.getByRole('button',{name:'Confirm temporary absence'})).toBeDisabled();
  fireEvent.change(input,{target:{value:'45'}});expect(screen.getByRole('button',{name:'Confirm temporary absence'})).toBeEnabled();expect(screen.getByLabelText('Availability change review')).toHaveTextContent('t8');
});
it('return now is separate confirmation at the same physical tick',async()=>{
  const session=technicianSession('ABSENT'),execute=vi.fn<TechnicianExecutor>().mockResolvedValue(returnedSession());render(form(session,execute),{wrapper});
  await userEvent.click(screen.getByRole('button',{name:'Return now'}));await userEvent.click(await screen.findByRole('button',{name:'Confirm return now'}));
  expect(execute).toHaveBeenCalledWith({kind:'return',sessionId:session.id,technicianIndex:0,basisTick:5,body:{revision:11,reason:'Returned early'}},expect.any(String),expect.any(AbortSignal));
});
it('BUSY panel explains repair and remaining time; cannot mark absent',()=>{
  const session=technicianSession('BUSY');render(<TechnicianDetails session={session} technician={1} lane={session.primary} config={session.config} read={read(session)} prepare={vi.fn()} execute={vi.fn()} onClose={vi.fn()} onSelectMachine={vi.fn()} onBusy={vi.fn()}/>,{wrapper});
  expect(screen.getByLabelText('Technician T2 details')).toHaveTextContent('M3 / C2');expect(screen.getByText('15 min')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Mark temporarily absent'})).toBeDisabled();expect(screen.getByText(/Finish the active repair/)).toBeInTheDocument();
});
it('stale revision requires refreshed clock and explicit reconfirmation; no automatic resubmit',async()=>{
  const session=technicianSession(),fresh=structuredClone(session);fresh.revision++;fresh.primary.state.tick=6;fresh.baseline.state.tick=6;fresh.tick=6;
  const prepare=vi.fn().mockResolvedValueOnce(session).mockResolvedValue(fresh),execute=vi.fn<TechnicianExecutor>().mockRejectedValueOnce({status:409,code:'DEMO_STALE'}).mockResolvedValue(technicianSession('ABSENT'));
  const h=render(form(session,execute,prepare),{wrapper});await userEvent.click(screen.getByRole('button',{name:'Mark temporarily absent'}));await userEvent.click(await screen.findByRole('button',{name:'Confirm temporary absence'}));
  await userEvent.click(await screen.findByRole('button',{name:'Refresh availability context'}));expect(await screen.findByLabelText('Availability change review')).toHaveTextContent('t9');
  expect(screen.getByRole('button',{name:'Confirm temporary absence'})).toBeDisabled();expect(execute).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button',{name:'Confirm updated availability context'}));
  h.rerender(form(fresh,execute,prepare));await userEvent.click(screen.getByRole('button',{name:'Confirm temporary absence'}));
  expect(prepare).toHaveBeenCalledTimes(2);expect(execute.mock.calls[1][0]).toMatchObject({basisTick:6,body:{revision:12,durationTicks:3}});expect(execute.mock.calls[1][1]).not.toBe(execute.mock.calls[0][1]);
});
it('unknown network outcome retries original request/key and blocks double submit',async()=>{
  const session=technicianSession(),execute=vi.fn<TechnicianExecutor>().mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(technicianSession('ABSENT'));render(form(session,execute),{wrapper});
  await userEvent.click(screen.getByRole('button',{name:'Mark temporarily absent'}));await userEvent.click(await screen.findByRole('button',{name:'Confirm temporary absence'}));
  await userEvent.click(await screen.findByRole('button',{name:'Recover previous availability change'}));expect(execute).toHaveBeenCalledTimes(2);expect(execute.mock.calls[0].slice(0,2)).toEqual(execute.mock.calls[1].slice(0,2));
});
it('VIEWER and unknown identity cannot write; session change cancels preparation',async()=>{
  const session=technicianSession();const viewer={...engineer,role:'VIEWER' as const};
  const h=render(<WorkspaceUserContext.Provider value={viewer}>{form(session,vi.fn())}</WorkspaceUserContext.Provider>);expect(screen.getByRole('button',{name:'Mark temporarily absent'})).toBeDisabled();h.unmount();
  const unknown=render(form(session,vi.fn()));expect(screen.getByRole('button',{name:'Mark temporarily absent'})).toBeDisabled();unknown.unmount();
  let signal!:AbortSignal;const prepare=vi.fn((s:AbortSignal)=>{signal=s;return new Promise<Simulation>(()=>{});});const second=render(form(session,vi.fn(),prepare),{wrapper});
  await userEvent.click(screen.getByRole('button',{name:'Mark temporarily absent'}));second.unmount();expect(signal.aborted).toBe(true);
});
it('activity uses stable server events and early return, with no local expiry creation',()=>{
  const session=returnedSession(),inspect=vi.fn();render(<TechnicianActivity session={session} onInspect={inspect}/>);
  expect(screen.getByLabelText('Workforce activity').querySelectorAll('li')).toHaveLength(2);expect(screen.getByText('T1 · Returned early')).toBeInTheDocument();fireEvent.click(screen.getAllByRole('button',{name:'Inspect T1'})[0]);expect(inspect).toHaveBeenCalledWith(0);
});
it('eligibility explains absence and refuses a catalogue assigning an absent technician; WAIT stays legal',()=>{
  const session=technicianSession('ABSENT');session.status='REVIEW';session.pending={tick:5,action:[[2,1,1]],baseline_action:[],catalogue:[[],[[2,1,0]],[[2,1,1]]]};
  render(<DecisionView session={session} busy={false} onDecide={vi.fn()} workforce={read(session)}/>,{wrapper});expect(screen.getByText(/Not eligible for new assignments/)).toHaveTextContent('returns t8');expect(screen.getByRole('button',{name:'Approve & dispatch'})).toBeDisabled();
});
it('comparison never treats changed workforce as a fair two-policy origin',()=>{
  render(<ComparisonView session={technicianSession('ABSENT')}/>);expect(screen.getByRole('heading',{name:'Common snapshot required'})).toBeInTheDocument();expect(screen.queryByText('Total cost (points)')).not.toBeInTheDocument();
});
it('all absent workers leave WAIT legal and show Repairs waiting for a failed machine',async()=>{
  const session=technicianSession('ABSENT'),calendar=session.technicianAvailability!;
  const event={...calendar.events[0],eventId:'10000000-0000-4000-8000-000000000077',technicianIndex:1};
  calendar.version=2;calendar.events.push(event);calendar.absences.push({...calendar.absences[0],eventId:event.eventId,automaticEndEventId:'10000000-0000-4000-8000-000000000066',technicianIndex:1});
  calendar.origin={eventId:event.eventId,tick:5,workforceVersion:2};session.comparisonContext={...session.comparisonContext!,workforceVersion:2,origin:calendar.origin};session.technicians![1]={...session.technicians![0],technicianIndex:1,activeAbsence:{...session.technicians![0].activeAbsence!,eventId:event.eventId}};
  session.status='REVIEW';session.pending={tick:5,action:[],baseline_action:[],catalogue:[[]]};session.primary.state.components[2][1].failed=true;
  const decision=render(<DecisionView session={session} busy={false} onDecide={vi.fn()} workforce={read(session)}/>,{wrapper});expect(screen.getByRole('button',{name:'Continue without dispatch'})).toBeEnabled();decision.unmount();
  vi.mocked(researchRequest).mockImplementation(async path=>(path==='/capabilities'?{learned_releases:[]}:session) as never);render(<DemoWorkspace initialId={session.id}/>,{wrapper});expect(await screen.findByText(/Repairs waiting/)).toBeInTheDocument();expect(screen.getByText('Technicians free: 0')).toBeInTheDocument();
});
it('user change hides old panels and aborts the old actor scope before the new read resolves',async()=>{
  const session=technicianSession('ABSENT');let resolve!:(session:Simulation)=>void;let reads=0;
  vi.mocked(researchRequest).mockImplementation(async path=>{if(path==='/capabilities')return {learned_releases:[]} as never;if(++reads===1)return session as never;return await new Promise<Simulation>(done=>{resolve=done;}) as never;});
  const h=render(<WorkspaceUserContext.Provider value={engineer}><DemoWorkspace initialId={session.id}/></WorkspaceUserContext.Provider>);await userEvent.click(await screen.findByRole('button',{name:'Inspect technician T1'}));expect(screen.getByLabelText('Technician T1 details')).toBeInTheDocument();
  h.rerender(<WorkspaceUserContext.Provider value={{...engineer,id:'other-user'}}><DemoWorkspace initialId={session.id}/></WorkspaceUserContext.Provider>);expect(screen.queryByLabelText('Technician T1 details')).not.toBeInTheDocument();
  await act(async()=>resolve({...session,id:'other-session',sessionId:'other-session'}));expect(screen.queryByLabelText('Technician T1 details')).not.toBeInTheDocument();
});
it('workspace drains an in-flight command, clears REVIEW from server and remains paused after availability change',async()=>{
  let latest=technicianSession();let finish!:(value:Simulation)=>void;
  const changed=technicianSession('ABSENT');changed.revision=13;changed.playbackPaused=true;changed.technicianAvailability!.events[0].reason='Temporary absence';
  vi.mocked(researchRequest).mockImplementation(async(path,options)=>{
    if(path==='/capabilities')return {learned_releases:[]} as never;
    if(path.endsWith('/commands'))return await new Promise<Simulation>(resolve=>{finish=resolve;}) as never;
    if(path.endsWith('/absence')){latest=changed;return commandResponse(changed) as never;}
    return latest as never;
  });
  render(<DemoWorkspace initialId={latest.id}/>,{wrapper});await userEvent.click(await screen.findByRole('button',{name:'Inspect technician T1'}));
  await userEvent.click(screen.getByRole('button',{name:'Step'}));await userEvent.click(screen.getByRole('button',{name:'Mark temporarily absent'}));expect(screen.getByText(/Pausing playback and reading/)).toBeInTheDocument();
  latest=structuredClone(latest);latest.revision=12;latest.status='REVIEW';latest.pending={tick:5,action:[[2,1,0]],baseline_action:[],catalogue:[[],[[2,1,0]]]};
  await act(async()=>finish(latest));await userEvent.click(await screen.findByRole('button',{name:'Confirm temporary absence'}));
  await waitFor(()=>expect(screen.getByLabelText('Technician T1 details')).toHaveTextContent('ABSENT'));
  expect(screen.queryByRole('button',{name:'Pause'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Review assignments'})).not.toBeInTheDocument();expect(screen.getByText('Technicians free: 1')).toBeInTheDocument();
  const call=vi.mocked(researchRequest).mock.calls.find(([path])=>path.endsWith('/absence'));expect(call?.[1]?.body).toMatchObject({revision:12,durationTicks:3});
  expect(screen.getByLabelText('Workforce activity')).toHaveTextContent('Absence started');
});
it('rapid T1/T2 selection shows correct snapshot and close restores the opener focus',async()=>{
  const session=technicianSession('ABSENT');vi.mocked(researchRequest).mockImplementation(async path=>(path==='/capabilities'?{learned_releases:[]}:session) as never);
  render(<DemoWorkspace initialId={session.id}/>,{wrapper});const t1=await screen.findByRole('button',{name:'Inspect technician T1'});await userEvent.click(t1);
  expect(screen.getByLabelText('Technician T1 details')).toHaveTextContent('t8');await userEvent.click(screen.getByRole('button',{name:'Inspect technician T2'}));
  expect(screen.queryByLabelText('Technician T1 details')).not.toBeInTheDocument();expect(screen.getByLabelText('Technician T2 details')).toHaveTextContent('Ready for assignment');
  await userEvent.click(screen.getByRole('button',{name:'Close technician panel'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Inspect technician T2'})).toHaveFocus());
});
