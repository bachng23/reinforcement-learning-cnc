const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../../src/config/prisma');
const app = require('../../src/app');
const demo = require('../../src/research/demo-service');

 test('concurrent duplicate commands replay a single saved revision without learned checkpoints', async () => {
  const user = await prisma.user.create({ data: { username: `demo-retry-${crypto.randomUUID()}`, passwordHash: 'unused-test-hash', role: 'ENGINEER' } });
  const session = await demo.create(user, { mode: 'incident', primary: 'risk', baseline: 'wait', continuous: true }, crypto.randomUUID());
  const key = crypto.randomUUID();
  const command = { command: 'advance', revision: session.revision, autoApprove: false };
  const [first, retry] = await Promise.all([
    demo.command(user, session.id, command, key),
    demo.command(user, session.id, command, key),
  ]);
  expect(first.revision).toBe(session.revision + 1);
  expect(retry).toEqual(first);
  expect(await prisma.auditLog.count({ where: { entityId: session.id, action: 'DEMO_ADVANCE' } })).toBe(1);
  await expect(demo.command(user, session.id, { ...command, autoApprove: true }, key)).rejects.toMatchObject({ code: 'DEMO_KEY_CONFLICT' });
  await expect(demo.command(user, session.id, command, crypto.randomUUID())).rejects.toMatchObject({ code: 'DEMO_STALE' });
});

afterAll(async () => { await prisma.$disconnect(); });

const enabled = Boolean(process.env.JCST_RELEASE_REGISTRY);
(enabled ? describe : describe.skip)('persistent JCST demo with registered policies', () => {
  let server,base,owner,other,viewer,session;
  const key=()=>crypto.randomUUID();
  async function req(url,{user=owner,body,identity=key()}={}) {
    const response=await fetch(base+'/api/v1/research/demo/sessions'+url,{method:body===undefined?'GET':'POST',headers:{...(user?{Authorization:'Bearer '+jwt.sign({id:user.id},process.env.JWT_SECRET)}:{}),'Content-Type':'application/json','Idempotency-Key':identity},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,json:await response.json()};
  }
  const create=(body={},identity)=>req('',{body:{continuous:false,...body},identity});
  const command=(body,options={})=>req(`/${session.id}/commands`,{...options,body:{revision:session.revision,...body}});
  beforeAll(async()=>{
    for(const [name,role] of [['owner','ENGINEER'],['other','ENGINEER'],['viewer','VIEWER']]){
      const user=await prisma.user.create({data:{username:`demo-${name}-${key()}`,passwordHash:'unused-test-hash',role}});
      if(name==='owner')owner=user;else if(name==='other')other=user;else viewer=user;
    }
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async()=>{if(server)await new Promise(r=>server.close(r));});
  test('auth, mutation roles, seeds and unknown fields are enforced',async()=>{
    expect((await req('',{user:null,body:{}})).status).toBe(401);
    expect((await req('',{user:viewer,body:{}})).status).toBe(403);
    expect((await create({seed:'18034398509481984'})).status).toBe(400);
    expect((await create({uniforms:{}})).status).toBe(400);
    expect((await create({primary:'S',baseline:'S'})).status).toBe(400);
  });
  test('create is idempotent, owner scoped and persisted with exact source identity',async()=>{
    const identity=key();const first=await create({},identity);expect(first.status).toBe(201);session=first.json.data;
    const repeat=await create({},identity);expect(repeat.json.data.id).toBe(session.id);
    expect((await create({seed:'990000002'},identity)).status).toBe(409);
    expect((await req('/'+session.id,{user:other})).status).toBe(404);
    expect(session.source_commit).toBe('c577b6be26f40de5f539cee0bc1b99a3405e0f7e');
    expect(session.primary.state).toEqual(session.baseline.state);
    expect((await prisma.demoSession.findUnique({where:{id:session.id}})).revision).toBe(0);
  },30000);
  test('duplicate and concurrent commands cannot double advance; stale approvals rejected',async()=>{
    const identity=key();const first=await command({command:'advance'},{identity});expect(first.status).toBe(200);
    const repeat=await command({command:'advance'},{identity});expect(repeat.json.data.revision).toBe(first.json.data.revision);
    expect((await command({command:'advance',autoApprove:true},{identity})).status).toBe(409);
    session=first.json.data;
    const results=await Promise.all([command({command:'advance'}),command({command:'advance'})]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);session=results.find(r=>r.status===200).json.data;
    expect(session.primary.state.tick).toBe(2);
    expect((await command({command:'approve',reason:'stale',revision:0})).status).toBe(409);
  },30000);
  test('failure triggers review without advancing; legal dispatch is audited and survives reload',async()=>{
    while(session.status!=='REVIEW'){
      const r=await command({command:'advance'});expect(r.status).toBe(200);session=r.json.data;
    }
    expect(session.primary.state.tick).toBe(5);expect(session.first_incident_tick).toBe(5);
    expect(session.primary.records).toEqual(session.baseline.records);
    expect((await command({command:'advance'})).status).toBe(409);
    expect((await command({command:'approve',reason:''})).status).toBe(400);
    expect((await command({command:'approve',reason:'test'},{user:viewer})).status).toBe(403);
    const invalid=await command({command:'override',action:[[0,0,0],[1,0,0]],reason:'Invalid worker reuse'});expect(invalid.status).toBe(422);
    expect((await req('/'+session.id)).json.data.revision).toBe(session.revision);
    const approved=await command({command:'approve',reason:'Accept the real policy dispatch'});expect(approved.status).toBe(200);session=approved.json.data;
    expect(session.primary.state.tick).toBe(6);
    expect(session.primary.state.jobs.some(j=>j?.kind==='CM')).toBe(true);
    expect(session.primary.overrides).toBe(0);
    const loaded=await req('/'+session.id);expect(loaded.json.data.primary).toEqual(session.primary);
    expect(await prisma.auditLog.count({where:{entityId:session.id,action:'DEMO_APPROVE'}})).toBe(1);
  },45000);
  test('explicit override is recorded separately from automatic policy comparison',async()=>{
    let r;
    do{r=await command({command:'advance'});expect(r.status).toBe(200);session=r.json.data;}while(session.status!=='REVIEW');
    // Choose an action distinct from the proposal, rather than assuming WAIT differs.
    const alternative=session.pending.catalogue.find(a=>JSON.stringify(a)!==JSON.stringify(session.pending.action));
    r=await command({command:'override',action:alternative,reason:'Human alternative for comparison'});expect(r.status).toBe(200);session=r.json.data;
    expect(session.primary.overrides).toBe(1);
    expect(session.decisions.at(-1).override).toBe(true);
  },30000);
  test('JSONB round-trip retains exact physical uniforms through final independent replay',async()=>{
    const created=await create({mode:'policy'});expect(created.status).toBe(201);
    const {id,revision,createdAt,...payload}=created.json.data;
    const {spawnSync}=require('node:child_process');const path=require('node:path');
    const root=path.resolve(__dirname,'../../..');
    const code=`import json,sys
from domain.jcst.demo import prepare,commit
s=json.load(sys.stdin)
while s['primary']['state']['tick'] < 63:
 prepare(s)
 if s['status']=='REVIEW': commit(s,s['pending']['action'],'automatic','policy comparison')
print(json.dumps(s))`;
    const built=spawnSync(process.env.JCST_PYTHON,['-c',code],{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'ai_services')},input:JSON.stringify(payload),encoding:'utf8'});
    expect(built.status).toBe(0);
    await prisma.demoSession.update({where:{id},data:{payloadJson:JSON.parse(built.stdout)}});
    session=(await req('/'+id)).json.data;
    expect(session.primary.state.tick).toBe(63);
    const done=await command({command:'advance',autoApprove:true});expect(done.status).toBe(200);session=done.json.data;
    expect(session.status).toBe('COMPLETE');expect(session.primary.state.tick).toBe(64);
    expect(session.audits.primary.status).toBe('PASS');expect(session.audits.baseline.status).toBe('PASS');
    expect(session.audits.primary.records).toBe(64);
    expect((await command({command:'advance'})).status).toBe(409);
    const resumed=await command({command:'configure',primary:'S',baseline:'corrective',continuous:true});
    expect(resumed.status).toBe(200);session=resumed.json.data;
    expect(session.primary.state.tick).toBe(64);
    expect(session.status).toBe('RUNNING');
    const continued=await command({command:'advance',autoApprove:true});
    expect(continued.status).toBe(200);
    expect(continued.json.data.primary.state.tick).toBe(65);
  },30000);

  test('bounded autoplay pauses at incident/review/dispatch/repair and records automatic confirmation',async()=>{
    session=(await create()).json.data;
    expect((await command({command:'autoplay',stopAt:'complete',maxTicks:9})).status).toBe(400);
    expect((await command({command:'autoplay',stopAt:'fake',maxTicks:1})).status).toBe(400);
    expect((await command({command:'autoplay',stopAt:'incident',maxTicks:8},{user:viewer})).status).toBe(403);
    for(const [stopAt,tick,status] of [['incident',5,'RUNNING'],['review',5,'REVIEW'],['dispatch',6,'RUNNING'],['repair',7,'RUNNING']]){
      const r=await command({command:'autoplay',stopAt,maxTicks:8});expect(r.status).toBe(200);session=r.json.data;
      expect(session.primary.state.tick).toBe(tick);expect(session.status).toBe(status);
    }
    expect(session.decisions[0].actor).toBe('automatic');expect(session.decisions[0].override).toBe(false);
    expect(session.primary.state.components[2][1].failed).toBe(false);
    const identity=key();const first=await command({command:'autoplay',stopAt:'complete',maxTicks:8},{identity});expect(first.status).toBe(200);
    const retry=await command({command:'autoplay',stopAt:'complete',maxTicks:8},{identity});expect(retry.json.data.revision).toBe(first.json.data.revision);
    expect(first.json.data.primary.state.tick-session.primary.state.tick).toBe(8);
    session=first.json.data;
  },30000);

  test('live defaults, policy changes and continuous resumption preserve physical commitments', async () => {
    const created = await req('', {body:{mode:'policy',primary:'risk',baseline:'corrective'}});
    expect(created.status).toBe(201);
    session = created.json.data;
    expect(session.continuous).toBe(true);
    const initialDate = session.simulation_start;
    let r = await command({command:'autoplay',stopAt:'complete',maxTicks:8});
    expect(r.status).toBe(200); session=r.json.data;
    const before=structuredClone(session.primary.state);
    r=await command({command:'configure',primary:'S',baseline:'corrective',continuous:true});
    expect(r.status).toBe(200); session=r.json.data;
    expect(session.primary.state).toEqual(before);
    expect(session.primary.comparison_start.tick).toBe(before.tick);
    expect(session.simulation_start).toBe(initialDate);
    expect((await command({command:'configure',primary:'S',baseline:'S',continuous:true})).status).toBe(400);
    expect((await command({command:'configure',primary:'fake',baseline:'S',continuous:true})).status).toBe(400);
    r=await command({command:'advance',autoApprove:true});
    expect(r.status).toBe(200);
    expect(r.json.data.primary.state.tick).toBe(before.tick+1);
  },30000);
});
