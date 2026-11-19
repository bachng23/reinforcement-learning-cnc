import {beforeEach,expect,it,vi} from 'vitest';
import {authFetch} from '@/lib/auth';
import {getTechnicians,sendTechnicianCommand} from '@/lib/simulation/technicians';
import {commandResponse,technicianSession,workforce} from './technician-fixtures';
vi.mock('@/lib/auth',()=>({authFetch:vi.fn(),endpoint:(path:string)=>path}));
beforeEach(()=>vi.clearAllMocks());
it('HTTP read is GET/no-store, abortable and has no query or write headers',async()=>{
  const session=technicianSession(),signal=new AbortController().signal;vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({success:true,data:workforce()})));
  await getTechnicians(session,signal);expect(authFetch).toHaveBeenCalledExactlyOnceWith(`/api/v1/research/demo/sessions/${session.id}/technicians`,{method:'GET',signal,cache:'no-store',headers:{Accept:'application/json'}});
});
it('HTTP write uses the pinned body and Idempotency-Key without UI-only fields',async()=>{
  const session=technicianSession('ABSENT');session.playbackPaused=true;vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({success:true,data:commandResponse(session)})));
  const body={revision:10,durationTicks:3,reason:'Short break'},signal=new AbortController().signal;
  await sendTechnicianCommand({kind:'absence',sessionId:session.id,technicianIndex:0,basisTick:5,body},'retained-key',signal);
  expect(authFetch).toHaveBeenCalledWith(`/api/v1/research/demo/sessions/${session.id}/technicians/0/absence`,expect.objectContaining({method:'POST',cache:'no-store',signal,body:JSON.stringify(body),headers:expect.objectContaining({'Idempotency-Key':'retained-key'})}));
});
it.each([403,404,409,503])('HTTP %i is an error, never fixture or successful write',async status=>{
  vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({success:false,error:{code:'SAFE_CODE',message:'Rejected'}}),{status}));
  await expect(getTechnicians(technicianSession(),new AbortController().signal)).rejects.toMatchObject({status,code:'SAFE_CODE'});expect(authFetch).toHaveBeenCalledTimes(1);
});
