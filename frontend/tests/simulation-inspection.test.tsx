import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MachineDetail } from '@/components/simulation/machine-detail';
import { ComponentHealth, riskLabel } from '@/components/simulation/component-health';
import { MachineServices } from '@/components/simulation/machine-services';
import { SimulationActivity } from '@/components/simulation/simulation-activity';
import { DecisionView } from '@/components/simulation/decision-view';
import { WorkspaceUserContext } from '@/lib/workspace-user';
import { useMachineInspection } from '@/lib/simulation/use-machine-inspection';
import { researchRequest } from '@/lib/research-api/client';
import { healthAt, simulationAt } from './simulation-inspection-fixtures';
import type { MachineHealth } from '@/types/generated/simulation-machine-health';

vi.mock('@/lib/research-api/client', () => ({ researchRequest: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(200); }); };

describe('snapshot-scoped machine reads', () => {
  it('renders the canonical t5/t6/t7 lifecycle and preserves the start evidence identity', async () => {
    vi.useFakeTimers();
    vi.mocked(researchRequest).mockImplementation(async path => {
      const revision = Number(new URL(path, 'http://test').searchParams.get('expectedRevision'));
      return [healthAt(5),healthAt(6),healthAt(7)].find(item => item.revision === revision) as never;
    });
    const { result, rerender } = renderHook(({ snapshot }) => useMachineInspection(snapshot, 2), { initialProps: { snapshot: simulationAt(5) } });
    await flush();
    expect(result.current.context?.health.machineStatus).toBe('BREAKDOWN');
    expect(result.current.context?.health.history.events.map(item => item.type)).toEqual(['failure']);
    rerender({ snapshot: simulationAt(6) });
    expect(result.current.loading).toBe(true);
    expect(result.current.context?.snapshot.revision).toBe(simulationAt(5).revision);
    await flush();
    const start = result.current.context!.health.history.events.find(item => item.type === 'start')!.eventId;
    rerender({ snapshot: simulationAt(7) }); await flush();
    expect(result.current.context?.health.history.events.find(item => item.type === 'start')?.eventId).toBe(start);
    expect(result.current.context?.health.history.events.at(-1)?.tick).toBe(7);
  });
  it('aborts old machine/session requests, ignores late responses and never flashes the previous machine', async () => {
    vi.useFakeTimers();
    const resolvers: ((data: MachineHealth) => void)[] = [];
    const signals: AbortSignal[] = [];
    vi.mocked(researchRequest).mockImplementation((_path, options) => new Promise(resolve => {
      resolvers.push(resolve as (data: MachineHealth) => void); signals.push(options!.signal!);
    }));
    const first = simulationAt(5);
    const { result, rerender, unmount } = renderHook(({ snapshot, machine }) => useMachineInspection(snapshot, machine), { initialProps: { snapshot: first, machine: 2 } });
    await flush(); rerender({ snapshot: first, machine: 0 });
    expect(signals[0].aborted).toBe(true); expect(result.current.context).toBeUndefined();
    await act(async () => resolvers[0](healthAt(5))); expect(result.current.context).toBeUndefined();
    await flush(); rerender({ snapshot: {...first,id:'another-session'}, machine: 0 });
    expect(signals[1].aborted).toBe(true); await flush(); unmount(); expect(signals[2].aborted).toBe(true);
  });
  it('coalesces fast playback updates and only reads the most recent revision', async () => {
    vi.useFakeTimers(); vi.mocked(researchRequest).mockResolvedValue(healthAt(7) as never);
    const { rerender } = renderHook(({ snapshot }) => useMachineInspection(snapshot, 2), { initialProps: { snapshot: simulationAt(5) } });
    rerender({ snapshot: simulationAt(6) }); rerender({ snapshot: simulationAt(7) }); await flush();
    expect(researchRequest).toHaveBeenCalledTimes(1);
    expect(researchRequest).toHaveBeenCalledWith(expect.stringContaining(`expectedRevision=${simulationAt(7).revision}`), expect.anything());
  });
  it.each(['revision','sessionId','tick','machineIndex','stepSeconds'] as const)('fails closed for mismatched %s', async field => {
    vi.useFakeTimers(); const health = healthAt(5);
    Object.assign(health, { [field]: field === 'sessionId' ? 'wrong-session' : 999 });
    vi.mocked(researchRequest).mockResolvedValue(health as never);
    const { result } = renderHook(() => useMachineInspection(simulationAt(5),2)); await flush();
    expect(result.current.context).toBeUndefined(); expect(result.current.error).toMatch(/does not match/);
  });
  it.each([[401,/Sign in/],[403,/permission/],[404,/not available/],[409,/revision changed/],[503,/unavailable/],[0,/connection/]])('handles %s and recovers on explicit retry', async (status, message) => {
    vi.useFakeTimers(); vi.mocked(researchRequest).mockRejectedValueOnce(Object.assign(new Error('unsafe server detail'), { status })).mockResolvedValue(healthAt(5) as never);
    const { result } = renderHook(() => useMachineInspection(simulationAt(5),2)); await flush();
    expect(result.current.error).toMatch(message); expect(result.current.context).toBeUndefined();
    act(() => result.current.retry()); await flush(); expect(result.current.context?.health.tick).toBe(5);
    expect(result.current.error).toBeUndefined();
  });
});

describe('component health and service evidence', () => {
  it('switches component without a page reset and displays authoritative risk, including a valid zero', async () => {
    const health = healthAt(7); health.components[0].failureRisk = .987654;
    health.components[1].failureRisk = 0;
    render(<ComponentHealth health={health} session={simulationAt(7)} />);
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Component'}),'0');
    expect(screen.getByText('98.77%')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Component'}),'1');
    expect(screen.getByText('0%', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('list',{name:'C2 milestones'})).toHaveTextContent('Maintenance completed');
    expect(riskLabel(null)).toBe('Not available');
  });
  it('breaks risk lines at unavailable values and missing intervals and exposes keyboard milestones', async () => {
    const health = healthAt(7); health.history.truncated = true; health.history.gaps = [{fromTick:2,toTick:3}];
    health.history.samples = [0,1,3,4,5,6,7].map(tick => ({...health.history.samples[0],tick,componentIndex:1,failureRisk:tick===4?null:.1}));
    render(<ComponentHealth health={health} session={simulationAt(7)} />);
    await userEvent.selectOptions(screen.getByRole('combobox',{name:'Component'}),'1');
    expect(screen.getAllByTestId('risk-segment')).toHaveLength(3);
    expect(screen.getByText(/Partial history/)).toBeInTheDocument();
    const milestone = within(screen.getByRole('list',{name:'C2 milestones'})).getByText('Failure detected').closest('li')!;
    milestone.focus(); expect(milestone).toHaveFocus();
    expect(screen.getByText('Missing intervals: t2–t3.')).toBeInTheDocument();
  });
  it('shows no work at t5, T2 CM remaining one interval at t6 and the same completed service at t7', () => {
    const { rerender } = render(<MachineServices health={healthAt(5)} session={simulationAt(5)} />);
    expect(screen.queryByTestId('service-record')).not.toBeInTheDocument();
    rerender(<MachineServices health={healthAt(6)} session={simulationAt(6)} />);
    const card=screen.getByTestId('service-record'); const id=card.dataset.evidenceId;
    expect(card).toHaveTextContent('T2 · C2 · CM'); expect(card).toHaveTextContent('In progress');
    expect(card).toHaveTextContent('15 min'); expect(card).toHaveTextContent('0 min');
    rerender(<MachineServices health={healthAt(7)} session={simulationAt(7)} />);
    expect(screen.getByTestId('service-record')).toHaveAttribute('data-evidence-id',id);
    expect(screen.getByTestId('service-record')).toHaveTextContent('Completed');
    expect(screen.getByTestId('service-record')).toHaveTextContent('t5'); expect(screen.getByTestId('service-record')).toHaveTextContent('t7');
  });
  it('retains immediate start/completion and reports missing legacy starts instead of guessing', () => {
    const health = healthAt(7); health.history.events = health.history.events.map(item => item.type==='completion'?{...item,tick:5}:item);
    const {rerender}=render(<MachineServices health={health} session={simulationAt(7)} />);
    expect(screen.getByTestId('service-record')).toHaveTextContent('Completed');
    health.history.events = health.history.events.filter(item=>item.type==='completion'); health.history.truncated=true;
    rerender(<MachineServices health={health} session={simulationAt(7)} />);
    expect(screen.getByTestId('service-record')).toHaveTextContent('Not retained');
    expect(screen.getByText(/Partial history/)).toBeInTheDocument();
  });
  it('machine status stays Breakdown when another component remains failed after completion', async () => {
    const session=simulationAt(7); session.primary.state.components[2][0].failed=true;
    render(<MachineDetail machine={2} lane={session.primary} config={session.config} proposal={[]} onClose={()=>{}} />);
    expect(screen.getByText(/Machine M3 · Breakdown/)).toBeInTheDocument();
  });
  it('reads real mode only and provides a visible retry without fabricating health when the API is missing', async () => {
    vi.mocked(researchRequest).mockRejectedValue(Object.assign(new Error('missing'),{status:404}));
    const session=simulationAt(5);
    render(<MachineDetail session={session} machine={2} lane={session.primary} config={session.config} proposal={[]} onClose={()=>{}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not available');
    expect(screen.getByRole('button',{name:'Retry machine history'})).toBeEnabled();
    expect(screen.queryByRole('img',{name:/failure risk/})).not.toBeInTheDocument();
  });
  it('shows defer in Activity and links back to its proposed machine without creating a service', () => {
    const session=simulationAt(5);session.decisions=[{tick:5,actor:'operator',reason:'Wait for access',action:[],proposed_action:[[2,1,1]],override:true}];
    const inspect=vi.fn();render(<SimulationActivity session={session} onInspect={inspect}/>);
    expect(screen.getByText(/Maintenance deferred/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Inspect M3'}));expect(inspect).toHaveBeenCalledWith(2);
    expect(screen.queryByTestId('service-record')).not.toBeInTheDocument();
  });
  it('shows an empty legacy history without inventing services or zero risks', () => {
    const health=healthAt(5);health.history={...health.history,availableFromTick:null,samples:[],events:[],returnedIntervals:0,truncated:true};
    const {unmount}=render(<ComponentHealth health={health} session={simulationAt(5)}/>);
    expect(screen.queryByTestId('risk-segment')).not.toBeInTheDocument();
    expect(screen.getByText(/No recorded milestones/)).toBeInTheDocument();unmount();
    render(<MachineServices health={health} session={simulationAt(5)}/>);
    expect(screen.queryByTestId('service-record')).not.toBeInTheDocument();
    expect(screen.getByText(/Partial history/)).toBeInTheDocument();
  });
  it('disables all decision commands for VIEWER without preventing inspection', () => {
    const decide=vi.fn();render(<WorkspaceUserContext.Provider value={{id:'viewer',role:'VIEWER'}}><DecisionView session={simulationAt(5)} busy={false} onDecide={decide}/></WorkspaceUserContext.Provider>);
    expect(screen.getByRole('button',{name:'Approve & dispatch'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Defer new assignments'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Confirm alternative'})).toBeDisabled();
    expect(screen.getByText(/cannot approve or override/)).toBeInTheDocument();expect(decide).not.toHaveBeenCalled();
  });
});
