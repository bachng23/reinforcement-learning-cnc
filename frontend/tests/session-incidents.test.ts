import {act,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useSessionIncidents} from '@/lib/simulation/use-session-incidents';
import {researchRequest} from '@/lib/research-api/client';
import {branchSession,branchId,injected} from './situation-fixtures';
import type {IncidentList} from '@/types/generated/simulation-situations';
vi.mock('@/lib/research-api/client',()=>({researchRequest:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();});afterEach(()=>vi.useRealTimers());
const flush=async()=>{await act(async()=>vi.advanceTimersByTimeAsync(200));};
it('coalesces revisions, cancels old requests and hides data immediately on session change',async()=>{
  const signals:AbortSignal[]=[];const resolvers:((value:IncidentList)=>void)[]=[];
  vi.mocked(researchRequest).mockImplementation((_path,options)=>new Promise<IncidentList>(resolve=>{signals.push(options!.signal!);resolvers.push(resolve);}) as never);
  const initial=branchSession(7);
  const hook=renderHook(({session})=>useSessionIncidents(session),{initialProps:{session:initial}});await flush();
  const next={...initial,revision:2};hook.rerender({session:next});expect(signals[0].aborted).toBe(true);
  await act(async()=>resolvers[0]({sessionId:branchId,revision:0,tick:7,source:'JCST_SIMULATION',events:[injected()]}));expect(hook.result.current.data).toBeUndefined();
  hook.rerender({session:{...next,revision:3}});await flush();expect(researchRequest).toHaveBeenCalledTimes(2);
  hook.rerender({session:{...next,id:'different',sessionId:'different'}});expect(hook.result.current.data).toBeUndefined();expect(signals[1].aborted).toBe(true);
  hook.unmount();
});
it('reads persisted queue after reload, does not transition scheduled status locally, and retries errors',async()=>{
  const session=branchSession(7);const scheduled=injected('SCHEDULED');
  vi.mocked(researchRequest).mockRejectedValueOnce({status:503}).mockResolvedValue({sessionId:branchId,revision:0,tick:7,source:'JCST_SIMULATION',events:[scheduled]} as never);
  const hook=renderHook(()=>useSessionIncidents(session));await flush();expect(hook.result.current.error).toMatch(/unavailable/);
  act(()=>hook.result.current.retry());await flush();expect(hook.result.current.data?.events[0].status).toBe('SCHEDULED');
  await act(async()=>vi.advanceTimersByTimeAsync(50000));expect(researchRequest).toHaveBeenCalledTimes(2);
  hook.unmount();renderHook(()=>useSessionIncidents(session));await flush();
  expect(vi.mocked(researchRequest).mock.calls.every(([,options])=>options?.body===undefined)).toBe(true);
});
