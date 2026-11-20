import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {useTechnicianAvailability} from '@/lib/simulation/use-technician-availability';
import {researchRequest} from '@/lib/research-api/client';
import {technicianSession,workforce} from './technician-fixtures';
vi.mock('@/lib/research-api/client',()=>({researchRequest:vi.fn()}));
beforeEach(()=>vi.clearAllMocks());
it('inline snapshot is read without extra requests and never expires locally at returnTick',()=>{
  const session=technicianSession('ABSENT');const h=renderHook(()=>useTechnicianAvailability(session,'actor'));
  expect(h.result.current.rows?.[0].availability).toBe('ABSENT');expect(researchRequest).not.toHaveBeenCalled();
});
it('coalesces revision changes, aborts stale reads, hides old scope and retries',async()=>{
  const session=technicianSession();delete session.technicians;delete session.comparisonContext;
  let finish!:(data:unknown)=>void;vi.mocked(researchRequest).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(workforce());
  const h=renderHook(({scope})=>useTechnicianAvailability(session,scope),{initialProps:{scope:'actor'}});
  await waitFor(()=>expect(researchRequest).toHaveBeenCalledTimes(1));const signal=vi.mocked(researchRequest).mock.calls[0][1]?.signal;
  h.rerender({scope:'new-actor'});expect(signal?.aborted).toBe(true);expect(h.result.current.rows).toBeUndefined();
  await act(async()=>finish(workforce('ABSENT')));await waitFor(()=>expect(h.result.current.rows?.[0].availability).toBe('AVAILABLE'));
  act(()=>h.result.current.retry());await waitFor(()=>expect(researchRequest).toHaveBeenCalledTimes(3));
});
it.each([401,403,503])('exposes %i without invented rows; retries on explicit action',async status=>{
  const session=technicianSession();delete session.technicians;delete session.comparisonContext;
  vi.mocked(researchRequest).mockRejectedValueOnce({status}).mockResolvedValue(workforce());const h=renderHook(()=>useTechnicianAvailability(session,'actor'));
  await waitFor(()=>expect(h.result.current.error).toBeTruthy());expect(h.result.current.rows).toBeUndefined();act(()=>h.result.current.retry());await waitFor(()=>expect(h.result.current.data).toBeTruthy());
});
it('404 compatibility only for missing legacy metadata, never fallback for calendar-bearing session',async()=>{
  const session=technicianSession('ABSENT');delete session.technicians;delete session.comparisonContext;
  vi.mocked(researchRequest).mockRejectedValue({status:404});const h=renderHook(()=>useTechnicianAvailability(session,'actor'));
  await waitFor(()=>expect(h.result.current.error).toBeTruthy());expect(h.result.current.legacy).toBe(false);expect(h.result.current.rows).toBeUndefined();
});
