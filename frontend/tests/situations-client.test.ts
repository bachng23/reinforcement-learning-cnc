import {beforeEach,expect,it,vi} from 'vitest';
import {authFetch} from '@/lib/auth';
import {sendSituationCommand,situationsApi,validateSituationSession,situationLayout,situationError} from '@/lib/simulation/situations';
import {branchSession,savedSituation,injected,branchId,sourceId} from './situation-fixtures';
vi.mock('@/lib/auth',()=>({authFetch:vi.fn(),endpoint:(path:string)=>path}));
const reply=(data:unknown)=>vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({success:true,data})));
const signal=()=>new AbortController().signal;
beforeEach(()=>vi.clearAllMocks());
it('saves metadata only with the exact revision, idempotency key and no-store',async()=>{
  const snapshot=savedSituation();reply(snapshot);const body={revision:12,name:snapshot.name,description:'Optional',layoutId:snapshot.layoutId};
  await sendSituationCommand({kind:'save',sessionId:sourceId,basisTick:6,body},'save-key',signal());
  expect(authFetch).toHaveBeenCalledWith(`/api/v1/research/demo/sessions/${sourceId}/snapshots`,expect.objectContaining({method:'POST',cache:'no-store',headers:expect.objectContaining({'Idempotency-Key':'save-key'}),body:JSON.stringify(body)}));
});
it('opens by immutable sourceRevision, keeps in-flight jobs/tick and never reads the live source instead',async()=>{
  const snapshot=savedSituation();const branch=branchSession();reply(branch);
  const result=await sendSituationCommand({kind:'open',snapshot,body:{revision:snapshot.sourceRevision}},'open-key',signal());
  expect(authFetch).toHaveBeenCalledTimes(1);expect(authFetch).toHaveBeenCalledWith(expect.stringContaining(`/snapshots/${snapshot.snapshotId}/sessions`),expect.objectContaining({body:JSON.stringify({revision:12})}));
  expect(result.kind==='open'&&result.session.primary.state.jobs[1]?.remaining).toBe(1);
  expect(result.kind==='open'&&result.session.primary.state.tick).toBe(6);
});
it.each(['id','tick','revision','hash','source','layout'])('rejects an inconsistent restored %s',field=>{
  const session=branchSession();
  if(field==='id')session.id=sourceId;
  if(field==='tick')session.tick=8;
  if(field==='revision')session.revision=2;
  if(field==='hash')session.branch.snapshotHash='b'.repeat(64);
  if(field==='source')session.branch.sourceRevision=999;
  if(field==='layout')session.context={layoutId:'wrong-layout'};
  expect(()=>validateSituationSession(session,savedSituation())).toThrow(/does not match/);
});
it('keeps cursor metadata and URL encodes opaque cursors without a fabricated search query',async()=>{
  reply({items:[savedSituation()],nextCursor:'next+/='});const page=await situationsApi.list('cursor+/=',signal());
  expect(page.nextCursor).toBe('next+/=');expect(authFetch).toHaveBeenCalledWith('/api/v1/research/demo/snapshots?limit=20&cursor=cursor%2B%2F%3D',expect.objectContaining({method:'GET'}));
});
it('creates a zero-time primary incident using the DTO unchanged and validates the returned identity',async()=>{
  const session=branchSession(7);session.revision=1;session.incidents=[injected()];session.primary.state.components[2][1].failed=true;
  reply({session,event:injected()});const body={revision:0,machineIndex:2,componentIndex:1,scheduledTick:7,reason:injected().requestedReason};
  const result=await sendSituationCommand({kind:'incident',sessionId:branchId,basisTick:7,body},'incident-key',signal());
  expect(result.kind==='incident'&&result.session.tick).toBe(7);
  expect(authFetch).toHaveBeenCalledWith(`/api/v1/research/demo/sessions/${branchId}/incidents`,expect.objectContaining({body:JSON.stringify(body)}));
});
it('does not accept an injected response that advances time',async()=>{
  const session=branchSession(7);session.tick=8;session.revision=1;session.primary.state.tick=8;session.baseline.state.tick=8;
  reply({session,event:injected()});await expect(sendSituationCommand({kind:'incident',sessionId:branchId,basisTick:7,body:{revision:0,machineIndex:2,componentIndex:1,scheduledTick:7,reason:injected().requestedReason}},'key',signal())).rejects.toThrow(/does not match/);
});
it('fences incident reads by session, revision and tick without inventing an expectedRevision query',async()=>{
  const session=branchSession(7);reply({sessionId:branchId,revision:1,tick:7,source:'JCST_SIMULATION',events:[]});
  await expect(situationsApi.incidents(session,signal())).rejects.toThrow(/does not match/);
  expect(authFetch).toHaveBeenCalledWith(`/api/v1/research/demo/sessions/${branchId}/incidents`,expect.anything());
});
it.each(['DEMO_RELEASE_UNAVAILABLE','DEMO_SNAPSHOT_INCOMPATIBLE','DEMO_SCENARIO_RUNTIME_UNAVAILABLE'])('surfaces %s and never creates fixture data',async code=>{
  vi.mocked(authFetch).mockResolvedValue(new Response(JSON.stringify({success:false,error:{code,message:'Producer unavailable'}}),{status:code.includes('RUNTIME')?503:409}));
  await expect(sendSituationCommand({kind:'open',snapshot:savedSituation(),body:{revision:12}},'key',signal())).rejects.toMatchObject({code});
  expect(authFetch).toHaveBeenCalledTimes(1);
});
it('rejects unknown layouts and describes missing/auth/network states clearly',()=>{
  expect(situationLayout('unknown')).toBeUndefined();expect(situationLayout('smt-board-assembly')).toBe('machining');
  expect(situationError({status:403})).toMatch(/role/);expect(situationError({status:404})).toMatch(/not available/);expect(situationError(new TypeError('network'))).toMatch(/same operation/);
});
