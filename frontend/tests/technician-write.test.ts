import {act,renderHook} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {useTechnicianWrite} from '@/lib/simulation/use-technician-write';
import type {TechnicianCommand,TechnicianExecutor} from '@/lib/simulation/technicians';
import {TechnicianRecoveryError} from '@/lib/simulation/technicians';
import {technicianSession} from './technician-fixtures';
const command:TechnicianCommand={kind:'absence',sessionId:technicianSession().id,technicianIndex:0,basisTick:5,body:{revision:10,durationTicks:3,reason:'Short break'}};
beforeEach(()=>sessionStorage.clear());
it('double-submit guard and same-key/body recovery after lost response and remount; mount never posts',async()=>{
  const execute=vi.fn<TechnicianExecutor>().mockRejectedValueOnce(new TypeError('lost')).mockResolvedValue(technicianSession('ABSENT'));
  const first=renderHook(()=>useTechnicianWrite('actor:session:0',execute));await act(()=>first.result.current.run(command));const key=execute.mock.calls[0][1];first.unmount();
  const next=renderHook(()=>useTechnicianWrite('actor:session:0',execute));expect(execute).toHaveBeenCalledTimes(1);expect(next.result.current.recovery).toEqual(command);
  await act(async()=>{const work=next.result.current.run(next.result.current.recovery!);void next.result.current.run(command);await work;});
  expect(execute).toHaveBeenCalledTimes(2);expect(execute.mock.calls[1].slice(0,2)).toEqual([command,key]);expect(sessionStorage.length).toBe(0);
  await act(()=>next.result.current.run(command));expect(execute.mock.calls[2][1]).not.toBe(key);
});
it('editing body creates a new key; stale conflict requires a new review',async()=>{
  const execute=vi.fn<TechnicianExecutor>().mockRejectedValue(Object.assign(new Error('stale'),{status:409}));const h=renderHook(()=>useTechnicianWrite('scope',execute));
  await act(()=>h.result.current.run(command));expect(h.result.current.recovery).toBeUndefined();expect(sessionStorage.length).toBe(0);
  await act(()=>h.result.current.run({...command,body:{...command.body,durationTicks:4}}));expect(execute.mock.calls[0][1]).not.toBe(execute.mock.calls[1][1]);
});
it('retains original receipt when POST succeeded but the following authoritative GET failed authorization',async()=>{
  const execute=vi.fn<TechnicianExecutor>().mockRejectedValueOnce(new TechnicianRecoveryError({status:403,code:'FORBIDDEN'})).mockResolvedValue(technicianSession('ABSENT'));
  const h=renderHook(()=>useTechnicianWrite('post-acknowledged',execute));await act(()=>h.result.current.run(command));expect(h.result.current.recovery).toEqual(command);expect(h.result.current.error).toContain('role');
  await act(()=>h.result.current.run(h.result.current.recovery!));expect(execute.mock.calls[1].slice(0,2)).toEqual(execute.mock.calls[0].slice(0,2));
});
it('scope change aborts and ignores an old response; no cross-technician recovery',async()=>{
  let finish!:(value:ReturnType<typeof technicianSession>)=>void;
  const execute=vi.fn<TechnicianExecutor>(()=>new Promise(resolve=>{finish=resolve;}));
  const h=renderHook(({scope})=>useTechnicianWrite(scope,execute),{initialProps:{scope:'actor:session:T1'}});
  let pending!:Promise<unknown>;act(()=>{pending=h.result.current.run(command);});const signal=execute.mock.calls[0][2];h.rerender({scope:'actor:other:T2'});
  expect(signal.aborted).toBe(true);await act(async()=>{finish(technicianSession('ABSENT'));await pending;});expect(h.result.current.result).toBeUndefined();expect(h.result.current.recovery).toBeUndefined();
});
