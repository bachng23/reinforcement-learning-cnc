import { beforeEach, expect, it, vi } from 'vitest';
import { authFetch } from '@/lib/auth';
import { readMachineHealth } from '@/lib/simulation/machine-health';
import { researchRequest } from '@/lib/research-api/client';
import { healthAt, simulationAt } from './simulation-inspection-fixtures';
vi.mock('@/lib/auth',()=>({authFetch:vi.fn(),endpoint:(path:string)=>path}));
beforeEach(()=>vi.clearAllMocks());
it('uses the actual health path, revision fence, no-store and abort signal',async()=>{
  vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({success:true,data:healthAt(6)})));
  const signal=new AbortController().signal; const snapshot=simulationAt(6);
  const result=await readMachineHealth(snapshot,2,signal);
  expect(result.snapshot).toBe(snapshot);
  expect(authFetch).toHaveBeenCalledWith(`/api/v1/research/demo/sessions/${snapshot.id}/machines/2/health?limit=256&expectedRevision=${snapshot.revision}`,expect.objectContaining({method:'GET',cache:'no-store',signal}));
});
it.each([401,403,404,409,503])('preserves HTTP %s for UI error states',async status=>{
  vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({success:false,error:{code:'DEMO_STALE',message:'Safe error'}}),{status}));
  await expect(researchRequest('/demo/sessions/example')).rejects.toMatchObject({status,code:'DEMO_STALE',message:'Safe error'});
});
it('handles non-JSON unavailability without leaking a parser error',async()=>{
  vi.mocked(authFetch).mockResolvedValue(new Response('gateway unavailable',{status:503}));
  await expect(researchRequest('/capabilities')).rejects.toMatchObject({status:503,code:'RESEARCH_API_ERROR'});
});
