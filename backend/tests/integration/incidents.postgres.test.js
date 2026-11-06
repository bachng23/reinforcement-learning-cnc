const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');
const canonical = require('../../../contracts/v3/fixtures/demo-health-alert.json');
let server, base, users, factoryA, factoryB;
const previousMode = process.env.FACTORY_ACCESS_SOURCE;
beforeAll(async () => {
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  users = {};
  for (const role of ['ADMIN','ENGINEER','OPERATOR','VIEWER','OUTSIDER']) users[role] = await db.user.create({ data: {
    username: `incident-${randomUUID()}`, passwordHash: 'not-used-by-token-auth', role: role === 'OUTSIDER' ? 'OPERATOR' : role } });
  factoryA=`incident-A-${randomUUID()}`;factoryB=`incident-B-${randomUUID()}`;
  for (const factoryId of [factoryA,factoryB]) {
    await db.factory.create({data:{factoryId,name:factoryId}});
    for (const role of ['ENGINEER','OPERATOR','VIEWER']) await db.factoryMembership.create({data:{factoryId,userId:users[role].id,grantSource:'http',grantedBy:users.ADMIN.id}});
    const s=structuredClone(canonical.factory_snapshot);s.factory_id=factoryId;s.current_schedule.factory_id=factoryId;
    await ingestFactorySnapshot({factoryId,expectedHeadRevision:0,snapshot:s,sourceId:'incident-test'},db);
  }
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}/api/v1`;
},60000);
afterAll(async()=>{if(server)await new Promise(r=>server.close(r));await db.$disconnect();if(previousMode===undefined)delete process.env.FACTORY_ACCESS_SOURCE;else process.env.FACTORY_ACCESS_SOURCE=previousMode;});
async function http(path,{method='GET',body,user=users.ADMIN,key=randomUUID()}={}) {
  const response=await fetch(base+path,{method,signal:AbortSignal.timeout(60000),headers:{...(user?{Authorization:`Bearer ${jwt.sign({id:user.id,role:'ADMIN'},process.env.JWT_SECRET)}`} :{}),
    'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json(),replay:response.headers.get('idempotency-replayed'),cache:response.headers.get('cache-control')};
}
const report=(extra={})=>({factory_id:factoryA,source:{type:'manual',source_event_id:randomUUID()},title:'Inspection report',description:'Human report, not automatic detection',category:'EQUIPMENT',proposed_severity:'WARNING',...extra});
async function create(extra={},options={}) {const response=await http('/incidents',{method:'POST',body:report(extra),...options});expect(response.status).toBe(201);return response.body.data.incident;}
async function command(row,command,extra={},user=users.ADMIN,key=randomUUID()) {
  return http(`/incidents/${row.id}/commands`,{method:'POST',user,key,body:{command,expected_revision:row.revision,...extra}});
}
async function investigate(owner=users.OPERATOR) {
  let row=await create({severity:'WARNING'});
  let r=await command(row,'ASSIGN',{owner_user_id:owner.id});expect(r.status).toBe(200);row=r.body.data.incident;
  r=await command(row,'ACKNOWLEDGE',{},owner);expect(r.status).toBe(200);row=r.body.data.incident;
  r=await command(row,'START_INVESTIGATION',{},owner);expect(r.status).toBe(200);return r.body.data.incident;
}
test('concurrent manual source creates one occurrence/incident; lost response replays exact receipt',async()=>{
  const body=report(),key=randomUUID();
  const responses=await Promise.all([http('/incidents',{method:'POST',body,key}),http('/incidents',{method:'POST',body,key}),http('/incidents',{method:'POST',body})]);
  // Either logical request may win. The same-key pair must replay the winner's
  // receipt, while a different-key duplicate source returns the existing record.
  expect(responses.every(r=>[200,201].includes(r.status))).toBe(true);
  expect(responses.some(r=>r.status===201)).toBe(true);
  expect(responses[0].status).toBe(responses[1].status);
  expect(responses[0].body).toEqual(responses[1].body);
  const ids=responses.map(r=>r.body.data.incident.id);expect(new Set(ids).size).toBe(1);
  const replay=await http('/incidents',{method:'POST',body,key});expect(replay.replay).toBe('true');expect(replay.body).toEqual(responses[0].body);
  const rows=await db.$queryRaw`SELECT count(*)::int AS count FROM incident_occurrences WHERE source_id=${body.source.source_event_id}::uuid`;expect(rows[0].count).toBe(1);
  const changed=await http('/incidents',{method:'POST',key,body:{...body,title:'Different'}});expect(changed.status).toBe(409);
});
test('real false-positive lifecycle, independent verification, reopen, durable history; publication unchanged',async()=>{
  const before=await db.operationsHead.findUnique({where:{factoryId:factoryA}});
  let row=await investigate(users.ENGINEER);
  let r=await command(row,'MARK_RESOLVED',{resolution:{code:'FALSE_POSITIVE',summary:'Inspection found no fault',evidence:'Recorded manual inspection'}},users.ENGINEER);expect(r.status).toBe(200);row=r.body.data.incident;
  const verification={resolution_code:'FALSE_POSITIVE',note:'Independent check complete'};
  expect((await command(row,'CLOSE',{verification},users.ENGINEER)).status).toBe(409);
  r=await command(row,'CLOSE',{verification});expect(r.status).toBe(200);row=r.body.data.incident;
  const events=await http(`/incidents/${row.id}/events`);expect(events.body.data.map(e=>e.command)).toEqual(['REPORT','ASSIGN','ACKNOWLEDGE','START_INVESTIGATION','MARK_RESOLVED','CLOSE']);
  r=await command(row,'REOPEN',{reason:'Additional evidence'});expect(r.status).toBe(200);expect(r.body.data.incident.status).toBe('OPEN');expect(r.body.data.resolution.report.code).toBe('FALSE_POSITIVE');
  expect((await http(`/incidents/${row.id}`)).body.data.incident.status).toBe('OPEN');
  expect(await db.operationsHead.findUnique({where:{factoryId:factoryA}})).toEqual(before);
});
test('authorization is fresh: viewer, nonowner, inactive/revoked replay and cross factory',async()=>{
  expect((await http('/incidents',{method:'POST',body:report(),user:users.VIEWER})).status).toBe(403);
  const body=report(),key=randomUUID();let r=await http('/incidents',{method:'POST',body,key,user:users.OPERATOR});expect(r.status).toBe(201);const row=r.body.data.incident;
  expect((await http(`/incidents/${row.id}`,{user:users.OUTSIDER})).status).toBe(404);
  expect((await command(row,'ACKNOWLEDGE',{},users.OPERATOR)).status).toBe(403);
  expect((await http(`/factories/${factoryA}/members/${users.OPERATOR.id}`,{method:'DELETE'})).status).toBe(200);
  try {expect((await http('/incidents',{method:'POST',body,key,user:users.OPERATOR})).status).toBe(404);}finally{expect((await http(`/factories/${factoryA}/members/${users.OPERATOR.id}`,{method:'PUT'})).status).toBe(200);}
  await db.user.update({where:{id:users.OPERATOR.id},data:{active:false}});
  try {expect((await http('/incidents',{method:'POST',body,key,user:users.OPERATOR})).status).toBe(401);}finally{await db.user.update({where:{id:users.OPERATOR.id},data:{active:true}});}
  expect((await http('/incidents',{method:'POST',body:report({severity:'CRITICAL'}),user:users.OPERATOR})).status).toBe(403);
});
test('stale concurrent commands have one winner and no losing receipt/event',async()=>{
  const row=await create();
  const responses=await Promise.all([command(row,'CHANGE_SEVERITY',{severity:'WARNING',reason:'Reviewed'}),command(row,'CHANGE_SEVERITY',{severity:'INFO',reason:'Reviewed'})]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  const events=await http(`/incidents/${row.id}/events`);expect(events.body.data).toHaveLength(2);
  const receipts=await db.$queryRaw`SELECT count(*)::int AS count FROM incident_command_receipts WHERE incident_id=${row.id}::uuid`;expect(receipts[0].count).toBe(2);
});
test('new manual recurrence appends once without duplicate revision or count',async()=>{
  let row=await create();const source={type:'manual',source_event_id:randomUUID()};
  let r=await command(row,'APPEND_OCCURRENCE',{source,reason:'New human-confirmed observation'});expect(r.status).toBe(200);row=r.body.data.incident;expect(row.occurrence_count).toBe(2);
  r=await command(row,'APPEND_OCCURRENCE',{source,reason:'Same observation'});expect(r.status).toBe(200);expect(r.body.data.incident.revision).toBe(row.revision);expect(r.body.data.incident.occurrence_count).toBe(2);
});

test('closed source remains deduplicated and a new source does not reopen it', async () => {
  const body = report({ severity: 'WARNING' });
  const created = await http('/incidents', { method: 'POST', body });
  expect(created.status).toBe(201);
  let row = created.body.data.incident;
  for (const [action, fields, actor] of [
    ['ASSIGN', { owner_user_id: users.ENGINEER.id }, users.ADMIN],
    ['ACKNOWLEDGE', {}, users.ENGINEER],
    ['START_INVESTIGATION', {}, users.ENGINEER],
    ['MARK_RESOLVED', { resolution: { code: 'FIXED', summary: 'Inspection complete', evidence: 'Human inspection' } }, users.ENGINEER],
    ['CLOSE', { verification: { resolution_code: 'FIXED', note: 'Independent inspection' } }, users.ADMIN],
  ]) {
    const response = await command(row, action, fields, actor);
    expect(response.status).toBe(200);
    row = response.body.data.incident;
  }
  const events = await db.incidentEvent.count({ where: { incidentId: row.id } });
  const duplicate = await http('/incidents', { method: 'POST', body });
  expect(duplicate.status).toBe(200);
  expect(duplicate.body.data.incident).toMatchObject({ id: row.id, status: 'CLOSED', revision: row.revision, occurrence_count: 1 });
  expect(await db.incidentEvent.count({ where: { incidentId: row.id } })).toBe(events);
  const changed = await http('/incidents', { method: 'POST', body: { ...body, description: 'Different report with reused source' } });
  expect(changed.status).toBe(409);
  const next = await create({ severity: 'WARNING' });
  expect(next.id).not.toBe(row.id);
  expect((await http(`/incidents/${row.id}`)).body.data.incident).toMatchObject({ status: 'CLOSED', revision: row.revision });
  const conflict = await command(next, 'APPEND_OCCURRENCE', { source: body.source, reason: 'Source belongs to closed incident' });
  expect(conflict.status).toBe(409);
  expect((await http(`/incidents/${next.id}`)).body.data.incident.occurrence_count).toBe(1);
});
test('summary spans more than one page; search/filter/cursor scope are server-side and reads no-store',async()=>{
  for(let n=0;n<4;n++)await create({title:`Needle-${n}`});
  const page=await http(`/incidents?factory_id=${factoryA}&q=Needle&limit=2`);expect(page.cache).toBe('no-store');expect(page.body.data).toHaveLength(2);expect(page.body.meta.has_more).toBe(true);
  const second=await http(`/incidents?factory_id=${factoryA}&q=Needle&limit=2&cursor=${encodeURIComponent(page.body.meta.next_cursor)}`);expect(second.body.data).toHaveLength(2);expect(new Set([...page.body.data,...second.body.data].map(r=>r.id)).size).toBe(4);
  expect((await http(`/incidents?factory_id=${factoryB}&q=Needle&cursor=${encodeURIComponent(page.body.meta.next_cursor)}`)).status).toBe(400);
  const counts=await http(`/incidents/summary?factory_id=${factoryA}`);const total=await db.$queryRaw`SELECT count(*)::int AS count FROM factory_incidents WHERE factory_id=${factoryA}`;expect(counts.body.data.total).toBe(total[0].count);
});
test('case health source is verified server-side, simulation rejected and no raw request leakage',async()=>{
  async function caseCreate(mode,trigger) {
    const h=await db.operationsHead.findUnique({where:{factoryId:factoryA}});
    const r=await http('/decision-cases',{method:'POST',body:{factory_id:factoryA,schema_version:'3.0',expected_snapshot_id:h.snapshotId,expected_plan_version:h.planVersion,request:{mode,trigger,planning_config:{horizon_minutes:720}}}});
    expect(r.status).toBe(202);return r.body.data.decision_case_id;
  }
  const caseId=await caseCreate('LIVE',{type:'HEALTH_ALERT',machine_id:'M03',failure_probability:0.42,alert_threshold:0.3});
  const body=report({source:{type:'case_health_alert',case_id:caseId}});const r=await http('/incidents',{method:'POST',body});expect(r.status).toBe(201);
  const history=await http(`/incidents/${r.body.data.incident.id}/occurrences`);expect(history.body.data[0].evidence.health_samples[0].source_model_version).toBe('rul-demo-v1');expect(JSON.stringify(history.body)).not.toContain('planning_config');
  expect((await http('/incidents',{method:'POST',body})).body.data.incident.occurrence_count).toBe(1);
  const simulation=await caseCreate('SIMULATION_ONLY',{type:'WHAT_IF',scenario_id:'incident-negative',assumptions:{}});
  expect((await http('/incidents',{method:'POST',body:report({source:{type:'case_health_alert',case_id:simulation}})})).status).toBe(409);
  expect((await http('/incidents',{method:'POST',body:report({factory_id:factoryB,source:{type:'case_health_alert',case_id:caseId}})})).status).toBe(404);
});
test('unavailable Work Orders cannot create fake links; occurrence/event immutability enforced in database',async()=>{
  const row=await create();
  const response=await http(`/incidents/${row.id}/links`,{method:'POST',body:{expected_revision:row.revision,target:{type:'work_order',id:randomUUID()}}});expect(response.status).toBe(503);
  expect((await http(`/incidents/${row.id}`)).body.data.incident.revision).toBe(row.revision);
  await expect(db.$executeRaw`UPDATE incident_events SET command='FORGED' WHERE incident_id=${row.id}::uuid`).rejects.toThrow();
  await expect(db.$executeRaw`DELETE FROM incident_occurrences WHERE incident_id=${row.id}::uuid`).rejects.toThrow();
});

test('revoked owner recovery, actor downgrade replay and reassignment are enforced from current DB state', async () => {
  let row = await investigate(users.OPERATOR);
  const key = randomUUID();
  const body = { command: 'MARK_RESOLVED', expected_revision: row.revision,
    resolution: { code: 'FIXED', summary: 'Inspected', evidence: 'Human report' } };
  const accepted = await http(`/incidents/${row.id}/commands`, { method: 'POST', body, key, user: users.OPERATOR });
  expect(accepted.status).toBe(200);
  row = accepted.body.data.incident;
  expect((await http(`/users/${users.OPERATOR.id}`, { method: 'PATCH', body: { role: 'VIEWER' } })).status).toBe(200);
  try {
    expect((await http(`/incidents/${row.id}/commands`, { method: 'POST', body, key, user: users.OPERATOR })).status).toBe(403);
    const reopened = await command(row, 'REOPEN', { reason: 'Owner no longer eligible' });
    expect(reopened.status).toBe(200);
    row = reopened.body.data.incident;
    expect((await command(row, 'MARK_RESOLVED', { resolution: body.resolution }, users.OPERATOR)).status).toBe(403);
    const assigned = await command(row, 'REASSIGN', { owner_user_id: users.ENGINEER.id, reason: 'Eligible replacement' });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.incident).toMatchObject({ status: 'OPEN', owner_user_id: users.ENGINEER.id });
  } finally {
    expect((await http(`/users/${users.OPERATOR.id}`, { method: 'PATCH', body: { role: 'OPERATOR' } })).status).toBe(200);
  }
});

test('concurrent append and reopen each advance once; losing requests leave no receipt', async () => {
  let row = await create();
  const source = { type: 'manual', source_event_id: randomUUID() };
  const attempts = await Promise.all([1, 2].map(() => command(row, 'APPEND_OCCURRENCE', { source, reason: 'Observed once' })));
  expect(attempts.map(r => r.status).sort()).toEqual([200, 409]);
  row = attempts.find(r => r.status === 200).body.data.incident;
  expect(row.occurrence_count).toBe(2);
  const dedup = await command(row, 'APPEND_OCCURRENCE', { source, reason: 'Explicit duplicate check' });
  expect(dedup.status).toBe(200);
  expect(dedup.body.data.incident.revision).toBe(row.revision);
  const rows = await db.$queryRaw`SELECT count(*)::int AS count FROM incident_events WHERE incident_id=${row.id}::uuid`;
  expect(rows[0].count).toBe(2);
  row = await investigate(users.ENGINEER);
  row = (await command(row, 'MARK_RESOLVED', { resolution: { code: 'FIXED', summary: 'Done', evidence: 'Report' } }, users.ENGINEER)).body.data.incident;
  const reopen = await Promise.all([1, 2].map(() => command(row, 'REOPEN', { reason: 'New observation' })));
  expect(reopen.map(r => r.status).sort()).toEqual([200, 409]);
  const events = await http(`/incidents/${row.id}/events`);
  expect(events.body.data.filter(e => e.command === 'REOPEN')).toHaveLength(1);
});

test('receipt insertion failure rolls back incident, occurrence, event and audit atomically', async () => {
  // Fault injection is confined to this disposable test schema; production code
  // is not given a test-only bypass or an alternate persistence implementation.
  await db.$executeRawUnsafe("CREATE FUNCTION incident_test_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test receipt failure'; END $$");
  await db.$executeRawUnsafe("CREATE TRIGGER incident_test_receipt BEFORE INSERT ON incident_command_receipts FOR EACH ROW EXECUTE FUNCTION incident_test_fail_receipt()");
  const body = report({ title: 'Rollback-' + randomUUID() });
  const before = { events: await db.incidentEvent.count(), receipts: await db.incidentCommandReceipt.count(),
    audit: await db.auditLog.count({ where: { factoryId: factoryA } }) };
  try {
    expect((await http('/incidents', { method: 'POST', body })).status).toBe(500);
    expect(await db.factoryIncident.count({ where: { title: body.title } })).toBe(0);
    expect(await db.incidentOccurrence.count({ where: { sourceId: body.source.source_event_id } })).toBe(0);
    expect({ events: await db.incidentEvent.count(), receipts: await db.incidentCommandReceipt.count(),
      audit: await db.auditLog.count({ where: { factoryId: factoryA } }) }).toEqual(before);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER incident_test_receipt ON incident_command_receipts');
    await db.$executeRawUnsafe('DROP FUNCTION incident_test_fail_receipt()');
  }
});
