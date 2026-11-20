import {beforeEach,expect,it,vi} from 'vitest';
import {researchRequest,ResearchApiError} from '@/lib/research-api/client';
import {embeddedTechnicians,getTechnicians,legacyTechnicians,sendTechnicianCommand,technicianError,validateTechnicians} from '@/lib/simulation/technicians';
import {commandResponse,returnedSession,technicianSession,workforce} from './technician-fixtures';
import {sourceSession} from './situation-fixtures';
vi.mock('@/lib/research-api/client',async importOriginal=>({...await importOriginal<typeof import('@/lib/research-api/client')>(),researchRequest:vi.fn()}));
beforeEach(()=>vi.clearAllMocks());
it.each(['AVAILABLE','BUSY','ABSENT'] as const)('accepts pinned %s DTO and existing job semantics',state=>{
  const session=technicianSession(state);expect(validateTechnicians(workforce(state),session)).toEqual(workforce(state));expect(embeddedTechnicians(session)?.technicians).toEqual(session.technicians);
});
it('GET uses a read-only endpoint, no invented query or write',async()=>{
  const session=technicianSession('ABSENT'),abort=new AbortController();vi.mocked(researchRequest).mockResolvedValue(workforce('ABSENT'));
  await getTechnicians(session,abort.signal);expect(researchRequest).toHaveBeenCalledExactlyOnceWith(`/demo/sessions/${session.id}/technicians`,{signal:abort.signal});
});
it.each(['session','revision','tick','step','index','job','absence','hash','metadata'] as const)('fails closed on %s mismatch',field=>{
  const session=technicianSession('ABSENT'),data=workforce('ABSENT');
  if(field==='session')data.sessionId='wrong';if(field==='revision')data.revision++;if(field==='tick')data.tick++;
  if(field==='step')data.stepSeconds=30;if(field==='index')data.technicians[0].technicianIndex=1;
  if(field==='job')data.technicians[0].availability='BUSY';if(field==='absence')data.technicians[0].returnTick=9;
  if(field==='hash')data.comparisonContext.cacheIdentity='fake';if(field==='metadata')session.technicianAvailability!.absences=[];
  expect(()=>validateTechnicians(data,session)).toThrow('does not match');
});
it('legacy missing metadata follows jobs, but calendar-bearing sessions cannot use legacy fallback',()=>{
  const old=sourceSession();expect(legacyTechnicians(old)[1].availability).toBe('BUSY');expect(()=>legacyTechnicians(technicianSession('ABSENT'))).toThrow();
});
it('supports config-sized technician arrays without sorting or changing the duration matrix',()=>{
  const session=technicianSession(),data=workforce();session.primary.state.jobs.push(null);session.baseline.state.jobs.push(null);
  session.config.duration.forEach(machine=>machine.forEach(row=>row.push(2)));data.technicians.push({...data.technicians[0],technicianIndex:2});
  expect(validateTechnicians(data,session).technicians.map(t=>t.technicianIndex)).toEqual([0,1,2]);expect(session.config.duration[0][0]).toHaveLength(3);
});
it('sends generated absence DTO and key unchanged; validates zero-time revision and pending removal',async()=>{
  const session=technicianSession('ABSENT');session.playbackPaused=true;vi.mocked(researchRequest).mockResolvedValue(commandResponse(session));
  const signal=new AbortController().signal,body={revision:10,durationTicks:3,reason:'Short break'};
  const result=await sendTechnicianCommand({kind:'absence',sessionId:session.id,technicianIndex:0,basisTick:5,body},'same-key',signal);
  expect(result.primary.state.tick).toBe(5);expect(result.revision).toBe(11);expect(researchRequest).toHaveBeenCalledWith(`/demo/sessions/${session.id}/technicians/0/absence`,{body,key:'same-key',signal});
});
it('return now preserves planned return time and records a separate server event',async()=>{
  const session=returnedSession();vi.mocked(researchRequest).mockResolvedValue(commandResponse(session));
  const result=await sendTechnicianCommand({kind:'return',sessionId:session.id,technicianIndex:0,basisTick:5,body:{revision:11,reason:'Returned early'}},'return-key',new AbortController().signal);
  expect(result.technicianAvailability!.absences[0]).toMatchObject({returnTick:8,endedTick:5});expect(result.primary.state.tick).toBe(5);
});
it.each(['tick','revision','pending','paused','target','reason','embedded'] as const)('rejects invalid write response %s',async field=>{
  const session=technicianSession('ABSENT');session.playbackPaused=true;
  if(field==='tick')session.tick=6;if(field==='revision')session.revision++;if(field==='pending')session.pending={tick:5,action:[],baseline_action:[],catalogue:[[]]};
  if(field==='paused')Object.assign(session,{playbackPaused:false});if(field==='target')session.technicianAvailability!.events[0].technicianIndex=1;
  if(field==='reason')session.technicianAvailability!.events[0].reason='other';
  const response=commandResponse(session);if(field==='embedded')session.technicians=workforce().technicians;
  vi.mocked(researchRequest).mockResolvedValue(response);
  await expect(sendTechnicianCommand({kind:'absence',sessionId:session.id,technicianIndex:0,basisTick:5,body:{revision:10,durationTicks:3,reason:'Short break'}},'key',new AbortController().signal)).rejects.toThrow();
});
it.each([[401,'AUTH','Sign in'],[403,'FORBIDDEN','role'],[404,'TECHNICIAN_NOT_FOUND','not available'],[409,'TECHNICIAN_BUSY','repairing'],[409,'DEMO_STALE','confirm'],[503,'TECHNICIAN_RUNTIME_UNAVAILABLE','not installed'],[504,'TIMEOUT','timed out']] as const)('safe error %i/%s', (status,code,expected)=>expect(technicianError(new ResearchApiError(status,code,'secret stack trace'))).toContain(expected));
it('network error never claims success or exposes raw error',()=>expect(technicianError(new TypeError('private details'))).toBe('The response was not received. Retry unchanged details to recover the same operation.'));
