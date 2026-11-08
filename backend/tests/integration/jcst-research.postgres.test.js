const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.RESEARCH_ARTIFACT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jcst-research-it-'));
const jwt = require('jsonwebtoken');
const prisma = require('../../src/config/prisma');
const app = require('../../src/app');
const service = require('../../src/research/service');
const { bridge } = require('../../src/research/bridge');
const { sha, canonical } = require('../../src/research/artifact-store');
const fixture = require('../../../contracts/jcst/v1/fixtures/engineering-bundle.json');
let server, base, owner, other, viewer, imported;
const key = () => crypto.randomUUID();
const fresh = () => ({ ...structuredClone(fixture), campaign_key: `test-${key()}` });
async function request(url, { user = owner, body, method, headers = {} } = {}) {
  const response = await fetch(`${base}/api/v1/research${url}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(user ? { Authorization: `Bearer ${jwt.sign({ id:user.id }, process.env.JWT_SECRET)}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type':'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, json: await response.json() };
}
async function importBundle(bundle = fresh(), identity = key()) {
  const r = await request('/imports', { body: { bundle }, headers: { 'Idempotency-Key':identity } });
  expect(r.status).toBe(202); await service.workOnce();
  return (await request(`/jobs/${r.json.data.id}`)).json.data;
}
beforeAll(async () => {
  for (const [name,role] of [['owner','ENGINEER'],['other','ENGINEER'],['viewer','VIEWER']]) {
    const user = await prisma.user.create({ data: { username:`jcst-${name}-${key()}`, passwordHash:'unused-test-password-hash', role } });
    if (name === 'owner') owner=user; else if (name === 'other') other=user; else viewer=user;
  }
  server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  imported = await importBundle(); expect(imported.status).toBe('SUCCEEDED');
});
afterAll(async () => { if(server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); fs.rmSync(process.env.RESEARCH_ARTIFACT_DIR,{recursive:true,force:true}); });

test('real import, original artifact bytes, source scope and replay survive new reads', async () => {
  const campaign=(await request(`/campaigns/${imported.outputJson.campaignId}`)).json.data;
  const run=campaign.runs[0]; expect(run.origin).toBe('engineering'); expect(run.physicalReplayJson[0].status).toBe('PASS');
  const row=run.episodes[0]; expect(typeof row.physicalSeed).toBe('string');
  expect((await request(`/episodes/${row.id}/records`,{user:other})).status).toBe(404);
  expect((await request(`/artifacts/${run.artifacts[0].id}`,{user:other})).status).toBe(404);
  const records=await request(`/episodes/${row.id}/records?limit=10`);
  expect(records.json.data.records).toHaveLength(10); expect(records.json.meta.total).toBe(64);
  const bytes=await fetch(`${base}/api/v1/research/artifacts/${run.artifacts[0].id}`,{headers:{Authorization:`Bearer ${jwt.sign({id:owner.id},process.env.JWT_SECRET)}`}});
  expect(await bytes.text()).toBe(fixture.artifacts[0].content);
  const reloaded=await prisma.researchRun.findUnique({where:{id:run.id}}); expect(reloaded.bundleHash).toBe(run.bundleHash);
  await expect(prisma.researchEpisode.update({where:{id:row.id},data:{totalCost:0}})).rejects.toThrow();
});
test('auth, owner scope, viewer mutation denial and bounded query validation', async () => {
  expect((await request('/campaigns',{user:null})).status).toBe(401);
  expect((await request('/imports',{user:viewer,body:{bundle:fixture},headers:{'Idempotency-Key':key()}})).status).toBe(403);
  expect((await request(`/campaigns/${imported.outputJson.campaignId}`,{user:other})).status).toBe(404);
  expect((await request(`/jobs/${imported.id}`,{user:other})).status).toBe(404);
  expect((await request('/campaigns?limit=101')).status).toBe(400);
  expect((await request('/campaigns/not-uuid')).status).toBe(400);
});
test('idempotency preserves exactly one input; identical run reimport is a no-op', async () => {
  const bundle=fresh(), identity=key();
  const first=await importBundle(bundle,identity); const second=await request('/imports',{body:{bundle},headers:{'Idempotency-Key':identity}});
  expect(second.json.data.id).toBe(first.id); expect(second.headers.get('idempotency-replayed')).toBe('true');
  const conflict=await request('/imports',{body:{bundle:{...bundle,title:'Changed'}},headers:{'Idempotency-Key':identity}}); expect(conflict.status).toBe(409);
  const duplicate=await importBundle(bundle); expect(duplicate.status).toBe('SUCCEEDED'); expect(duplicate.outputJson.runId).toBe(first.outputJson.runId);
  const changed=await importBundle({...bundle,claims:['different retained input']}); expect(changed.status).toBe('FAILED'); expect(changed.errorCode).toBe('RUN_IDENTITY_CONFLICT');
  expect(await prisma.researchRun.count({where:{campaignId:first.outputJson.campaignId}})).toBe(1);
});
test('hash/cost corruption fails without publishing a campaign or erasing the attempt', async () => {
  const bundle=fresh(); bundle.artifacts[0].content+='tampered';
  const job=await importBundle(bundle); expect(job.status).toBe('FAILED'); expect(job.errorCode).toBe('JCST_VALIDATION_FAILED');
  expect(await prisma.researchCampaign.findFirst({where:{ownerId:owner.id,campaignKey:bundle.campaign_key}})).toBeNull();
  const read=await service.store.json(job.inputJson.bundleHash); expect(read.artifacts[0].content).toContain('tampered');
});
test('branch uses frozen source, preserves original trace, and review never publishes operations', async () => {
  const campaign=(await request(`/campaigns/${imported.outputJson.campaignId}`)).json.data; const e=campaign.runs[0].episodes[0];
  const basis=await service.store.get(e.contentHash); const count=await prisma.operationsHead.count();
  const input={episode_id:e.id,tick:3,action:[],reason:'Compare WAIT with source action',expected_episode_hash:e.contentHash,controller:'risk'};
  const r=await request('/branches',{body:input,headers:{'Idempotency-Key':key()}}); expect(r.status).toBe(202);
  await service.workOnce(); const job=(await request(`/jobs/${r.json.data.id}`)).json.data;
  expect(job.status).toBe('SUCCEEDED'); expect(job.outputJson.audit.status).toBe('PASS');
  expect(job.outputJson.baselineAudit.status).toBe('PASS');
  const baseline=(await request(`/jobs/${job.id}/episode?variant=baseline`)).json.data;
  const branch=(await request(`/jobs/${job.id}/episode`)).json.data;
  expect(branch.physical_seed).toBe(e.physicalSeed); expect(await service.store.get(e.contentHash)).toEqual(basis);
  expect(baseline.physical_seed).toBe(branch.physical_seed);
  expect(baseline.controller).toBe(branch.controller);
  expect(job.outputJson.deltaTotalCost).toBe(branch.total_cost-baseline.total_cost);
  const review={decision:'ACCEPT',reason:'Retain this simulated comparison',expected_output_hash:sha(canonical(job.outputJson))};
  expect((await request(`/jobs/${job.id}/review`,{body:review})).status).toBe(201);
  expect((await request(`/jobs/${job.id}/review`,{body:review})).status).toBe(200);
  expect((await request(`/jobs/${job.id}/review`,{body:{...review,decision:'REJECT'}})).status).toBe(409);
  expect(await prisma.operationsHead.count()).toBe(count);
  expect((await request('/branches',{body:{...input,expected_episode_hash:'0'.repeat(64)},headers:{'Idempotency-Key':key()}})).status).toBe(409);
});
test('running cancellation fences late output and retry preserves prior attempt', async () => {
  const r=await request('/imports',{body:{bundle:fresh()},headers:{'Idempotency-Key':key()}});
  let started; const ready=new Promise(resolve=>{started=resolve;}); let release; const blocked=new Promise(resolve=>{release=resolve;});
  const working=service.workOnce({execute:async request=>{started(); await blocked; return bridge(request);}});
  await ready;
  expect((await request(`/jobs/${r.json.data.id}/cancel`,{body:{}})).status).toBe(200);
  release(); await working;
  const cancelled=(await request(`/jobs/${r.json.data.id}`)).json.data; expect(cancelled.status).toBe('CANCELLED'); expect(cancelled.outputJson).toBeNull();
  const retry=await request(`/jobs/${cancelled.id}/retry`,{body:{},headers:{'Idempotency-Key':key()}}); expect(retry.status).toBe(202);
  expect(retry.json.data.attempt).toBe(2);
  await service.workOnce(); expect((await request(`/jobs/${retry.json.data.id}`)).json.data.status).toBe('SUCCEEDED');
  expect((await request(`/jobs/${cancelled.id}`)).json.data.status).toBe('CANCELLED');
});
test('expired lease fails once and is never automatically replayed', async () => {
  const result=await service.enqueue(owner,'IMPORT',{bundleHash:imported.inputJson.bundleHash},key());
  await prisma.researchJob.update({where:{id:result.job.id},data:{status:'RUNNING',leaseToken:key(),leaseExpiresAt:new Date(Date.now()-1000)}});
  await service.workOnce(); const job=await service.getJob(owner,result.job.id);
  expect(job.status).toBe('FAILED'); expect(job.errorCode).toBe('WORKER_LEASE_EXPIRED');
  await expect(prisma.researchJob.update({where:{id:job.id},data:{inputJson:{changed:true}}})).rejects.toThrow();
});
