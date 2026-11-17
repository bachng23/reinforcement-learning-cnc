import {act,renderHook} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {useSituationWrite} from '@/lib/simulation/use-situation-write';
import type {SituationCommand,SituationResult,SituationExecutor} from '@/lib/simulation/situations';
import {savedSituation,sourceId} from './situation-fixtures';
const command:SituationCommand={kind:'save',sessionId:sourceId,basisTick:6,body:{revision:12,name:'Frozen repair',layoutId:'machining'}};
const success:SituationResult={kind:'save',snapshot:savedSituation()};
beforeEach(()=>sessionStorage.clear());
it('retries lost responses with exactly the same key/body, including after remount',async()=>{
  const execute=vi.fn<SituationExecutor>().mockRejectedValueOnce(new TypeError('response lost')).mockResolvedValue(success);
  const first=renderHook(()=>useSituationWrite('operator:source:save',execute));await act(async()=>{await first.result.current.run(command);});first.unmount();
  const second=renderHook(()=>useSituationWrite('operator:source:save',execute));
  expect(execute).toHaveBeenCalledTimes(1);await act(async()=>{await second.result.current.run(command);});
  expect(execute.mock.calls[0][1]).toBe(execute.mock.calls[1][1]);expect(execute.mock.calls[0][0]).toEqual(execute.mock.calls[1][0]);
});
it('uses new keys for changed input and a new action after known success',async()=>{
  const execute=vi.fn<SituationExecutor>().mockRejectedValueOnce(new Error('lost')).mockResolvedValue(success);
  const hook=renderHook(()=>useSituationWrite('scope',execute));await act(async()=>{await hook.result.current.run(command);});
  const changed={...command,body:{...command.body,name:'New situation'}} as SituationCommand;
  await act(async()=>{await hook.result.current.run(changed);});await act(async()=>{await hook.result.current.run(changed);});
  expect(new Set(execute.mock.calls.map(call=>call[1])).size).toBe(3);
});
it('blocks double submit and cancels on scope change, ignoring a late result',async()=>{
  let resolve!:(value:SituationResult)=>void;const execute=vi.fn<SituationExecutor>().mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const hook=renderHook(({scope})=>useSituationWrite(scope,execute),{initialProps:{scope:'userA:sessionA'}});
  act(()=>{void hook.result.current.run(command);void hook.result.current.run(command);});expect(execute).toHaveBeenCalledTimes(1);
  hook.rerender({scope:'userB:sessionB'});expect(execute.mock.calls[0][2].aborted).toBe(true);
  await act(async()=>resolve(success));expect(hook.result.current.result).toBeUndefined();
});
it('keeps the opening key when metadata is enriched but the target and request body are unchanged',async()=>{
  const execute=vi.fn<SituationExecutor>().mockRejectedValue(new TypeError('response lost'));
  const hook=renderHook(()=>useSituationWrite('operator:open',execute));
  const snapshot=savedSituation();const open:SituationCommand={kind:'open',snapshot,body:{revision:12}};
  await act(async()=>{await hook.result.current.run(open);});
  const enriched={...snapshot,summary:undefined};
  await act(async()=>{await hook.result.current.run({kind:'open',snapshot:enriched,body:{revision:12}});});
  expect(execute.mock.calls[0][1]).toBe(execute.mock.calls[1][1]);
});
