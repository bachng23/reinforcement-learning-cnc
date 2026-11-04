import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveSimulation } from '@/lib/simulation/use-live-simulation';
import { getUserFromToken } from '@/lib/auth';
import { researchRequest } from '@/lib/research-api/client';
import { simulation } from './live-simulation-fixtures';
import type { Simulation } from '@/lib/simulation/types';
import bundle from '../../contracts/jcst/v1/fixtures/engineering-bundle.json';
vi.mock('@/lib/auth', () => ({getUserFromToken: vi.fn()}));
vi.mock('@/lib/research-api/client', () => ({researchRequest: vi.fn()}));
const commandCalls = () => vi.mocked(researchRequest).mock.calls.filter(([path]) => path.endsWith('/commands'));
let state: Simulation;
async function boot() {
  const hook = renderHook(() => useLiveSimulation(state.id));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(hook.result.current.session).toBeDefined(); return hook;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); sessionStorage.clear(); window.history.replaceState(null, '', '/overview');
  vi.mocked(getUserFromToken).mockResolvedValue({id: 'engineer', role: 'ENGINEER'});
  state = {...simulation(), status: 'RUNNING', pending: null};
  vi.mocked(researchRequest).mockImplementation(async () => state as never);
});
afterEach(() => vi.useRealTimers());
describe('live playback scheduler regression', () => {
  it('pause cancels the next tick without enqueueing', async () => {
    const hook = await boot(); act(() => hook.result.current.setRunning(true));
    await act(async () => vi.advanceTimersByTimeAsync(999)); expect(commandCalls()).toHaveLength(0);
    act(() => hook.result.current.setRunning(false)); await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(commandCalls()).toHaveLength(0);
  });
  it('one in-flight interval can finish after pause but no following tick is queued', async () => {
    let finish!: (data: Simulation) => void;
    vi.mocked(researchRequest).mockImplementation(async path => path.endsWith('/commands') ? await new Promise<Simulation>(resolve => {finish = resolve;}) as never : state as never);
    const hook = await boot(); act(() => hook.result.current.setRunning(true)); await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(commandCalls()).toHaveLength(1); act(() => hook.result.current.setRunning(false));
    await act(async () => finish({...state, revision: 8})); await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(hook.result.current.session?.revision).toBe(8); expect(commandCalls()).toHaveLength(1);
  });
  it.each(['REVIEW', 'COMPLETE'] as const)('%s never schedules another interval', async status => {
    state.status = status; const hook = await boot(); act(() => hook.result.current.setRunning(true));
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(commandCalls()).toHaveLength(0);
  });
  it('new failure pauses even if another component was already repaired', async () => {
    const hook = await boot();
    const next = structuredClone(state); next.revision = 8;
    next.primary.records = [{...bundle.episodes[0].records[0], events: [{type: 'failure', machine: 1, component: 0, tick: 8}]}] as Simulation['primary']['records'];
    vi.mocked(researchRequest).mockResolvedValue(next as never);
    act(() => hook.result.current.setRunning(true)); await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(hook.result.current.running).toBe(false); await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(commandCalls()).toHaveLength(1);
  });
  it('reload restores the session and resets automatic confirmation without POST', async () => {
    const first = await boot(); act(() => {first.result.current.setAutomatic(true); first.result.current.setRunning(true);}); first.unmount();
    const second = await boot(); expect(second.result.current.running).toBe(false); expect(second.result.current.automatic).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(commandCalls()).toHaveLength(0);
  });
  it.each([500, 200])('speed %s changes only the next interval delay, not physical duration', async delay => {
    const hook = await boot(); act(() => {hook.result.current.setSpeed(delay); hook.result.current.setRunning(true);});
    await act(async() => vi.advanceTimersByTimeAsync(delay - 1)); expect(commandCalls()).toHaveLength(0);
    await act(async() => vi.advanceTimersByTimeAsync(1)); expect(commandCalls()).toHaveLength(1);
    expect(commandCalls()[0][1]?.body).toEqual({revision: 7, command: 'advance', autoApprove: false});
  });
  it('an old in-flight command cannot pull navigation back to another session', async () => {
    const old = structuredClone(state); const other = {...state, id: '22222222-2222-4222-8222-222222222222'};
    let finish!: (value: Simulation) => void;
    vi.mocked(researchRequest).mockImplementation(async path => path.endsWith('/commands') ? await new Promise<Simulation>(resolve => {finish = resolve;}) as never : (path.includes(other.id) ? other : old) as never);
    const hook = renderHook(({id}) => useLiveSimulation(id), {initialProps: {id: old.id}});
    await act(async() => {await Promise.resolve(); await Promise.resolve();});
    act(() => {void hook.result.current.command({command: 'advance'});});
    window.history.replaceState(null, '', `/overview?session=${other.id}`); hook.rerender({id: other.id});
    await act(async() => {await Promise.resolve(); await Promise.resolve();});
    expect(hook.result.current.session?.id).toBe(other.id);
    await act(async() => finish({...old, revision: old.revision + 1}));
    expect(hook.result.current.session?.id).toBe(other.id); expect(window.location.search).toContain(other.id);
  });
  it('creating a new session fences an older unfinished restore read', async () => {
    const old = structuredClone(state); const next = {...state, id: '33333333-3333-4333-8333-333333333333'};
    let finish!: (value: Simulation) => void;
    vi.mocked(researchRequest).mockImplementation(async path => path === '/demo/sessions' ? next as never : await new Promise<Simulation>(resolve => {finish = resolve;}) as never);
    const hook = renderHook(() => useLiveSimulation(old.id));
    await act(async() => {await Promise.resolve(); await Promise.resolve();});
    await act(async() => {await hook.result.current.create({case: 'base', seed: '990000001', mode: 'incident', primary: 'S', baseline: 'F'});});
    expect(hook.result.current.session?.id).toBe(next.id); expect(hook.result.current.loading).toBe(false);
    await act(async() => finish(old)); expect(hook.result.current.session?.id).toBe(next.id); expect(window.location.search).toContain(next.id);
  });
});
