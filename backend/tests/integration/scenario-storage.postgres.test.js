const { randomUUID } = require('node:crypto');
const db = require('../../src/config/prisma');
const { contentHash } = require('../../src/services/operations-contract.service');
let actor, factoryA, factoryB;
const snapshots = new Map();
const hash = contentHash({ storage_fixture: true });
beforeAll(async () => {
  actor = await db.user.create({ data: { username: randomUUID(), passwordHash: 'test-only', role: 'ADMIN' } });
  for (const factoryId of [factoryA = `scenario-${randomUUID()}`, factoryB = `scenario-${randomUUID()}`]) {
    await db.factory.create({ data: { factoryId, name: factoryId } });
    const payload = structuredClone(require('../../../contracts/v3/examples/demo-scenario.json').factory_snapshot);
    payload.factory_id = factoryId;
    payload.snapshot_id = 'S1';
    payload.current_schedule = null;
    snapshots.set(factoryId, payload);
    await db.factorySnapshot.create({ data: { factoryId, snapshotId: 'S1', schemaVersion: '3.0',
      contentHash: contentHash(payload), payloadJson: payload, capturedAt: new Date(payload.captured_at) } });
  }
});
afterAll(() => db.$disconnect());
async function workspace(factoryId = factoryA) {
  const id = randomUUID();
  await db.$executeRaw`INSERT INTO scenario_workspaces
    (id,factory_id,name,snapshot_id,snapshot_hash,plan_version,baseline_json,config_json,sampling_json,engine_version,contract_version,actor_id)
    VALUES(${id}::uuid,${factoryId},'Storage invariant test','S1',${contentHash(snapshots.get(factoryId))},0,
      ${JSON.stringify(snapshots.get(factoryId))}::jsonb,'{}','{}','test','test',${actor.id}::uuid)`;
  return id;
}
async function job(id, factoryId = factoryA) {
  const jobId = randomUUID();
  await db.$executeRaw`INSERT INTO scenario_jobs
    (id,factory_id,workspace_id,kind,input_json,input_hash,engine_version,contract_version,deadline_at,actor_id)
    VALUES(${jobId}::uuid,${factoryId},${id}::uuid,'RUN','{}',${hash},'test','test',clock_timestamp()+interval '290 seconds',${actor.id}::uuid)`;
  return jobId;
}
test('composite factory/workspace scope rejects foreign children', async () => {
  const a = await workspace();
  await expect(job(a, factoryB)).rejects.toThrow();
  expect(await db.$queryRaw`SELECT id FROM scenario_jobs WHERE workspace_id=${a}::uuid`).toHaveLength(0);
});
test('immutable baseline and original Operations rows survive rejected writes', async () => {
  const a = await workspace();
  const before = await db.factorySnapshot.findUnique({ where: { factoryId_snapshotId: { factoryId: factoryA, snapshotId: 'S1' } } });
  await expect(db.$executeRaw`UPDATE scenario_workspaces SET snapshot_hash=${'f'.repeat(64)} WHERE id=${a}::uuid`).rejects.toThrow();
  await expect(db.$executeRaw`DELETE FROM scenario_workspaces WHERE id=${a}::uuid`).rejects.toThrow();
  expect(await db.factorySnapshot.findUnique({ where: { factoryId_snapshotId: { factoryId: factoryA, snapshotId: 'S1' } } })).toEqual(before);
});
test('draft pointer must resolve to an append-only revision at transaction commit', async () => {
  const a = await workspace(), draft = randomUUID();
  await expect(db.$transaction(tx => tx.$executeRaw`INSERT INTO scenario_drafts(id,factory_id,workspace_id,actor_id)
    VALUES(${draft}::uuid,${factoryA},${a}::uuid,${actor.id}::uuid)`)).rejects.toThrow();
  await db.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO scenario_drafts(id,factory_id,workspace_id,actor_id)
      VALUES(${draft}::uuid,${factoryA},${a}::uuid,${actor.id}::uuid)`;
    await tx.$executeRaw`INSERT INTO scenario_draft_revisions(factory_id,workspace_id,scenario_id,revision,payload_json,content_hash,actor_id)
      VALUES(${factoryA},${a}::uuid,${draft}::uuid,1,'{}',${hash},${actor.id}::uuid)`;
  });
  await expect(db.$executeRaw`UPDATE scenario_draft_revisions SET payload_json='{"tampered":true}' WHERE scenario_id=${draft}::uuid`).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE scenario_drafts SET revision=3 WHERE id=${draft}::uuid`).rejects.toThrow();
});
test('one running job per factory, frozen input and immutable accepted result', async () => {
  const a = await workspace(), first = await job(a), second = await job(a), lease = randomUUID();
  await db.$executeRaw`UPDATE scenario_jobs SET status='RUNNING',attempt=1,lease_token=${lease}::uuid,
    lease_expires_at=clock_timestamp()+interval '30 seconds',worker_id='test',started_at=clock_timestamp() WHERE id=${first}::uuid`;
  await expect(db.$executeRaw`UPDATE scenario_jobs SET status='RUNNING',attempt=1,lease_token=${randomUUID()}::uuid,
    lease_expires_at=clock_timestamp()+interval '30 seconds',worker_id='test' WHERE id=${second}::uuid`).rejects.toThrow();
  await expect(db.$executeRaw`UPDATE scenario_jobs SET input_json='{"modified":true}' WHERE id=${first}::uuid`).rejects.toThrow();
  await db.$executeRaw`UPDATE scenario_jobs SET status='SUCCEEDED',result_json='{}',result_hash=${hash},
    completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,worker_id=NULL WHERE id=${first}::uuid`;
  await expect(db.$executeRaw`UPDATE scenario_jobs SET result_json='{"late":true}' WHERE id=${first}::uuid`).rejects.toThrow();
});
test('atomic audit/receipt writes roll back together and history cannot be overwritten', async () => {
  const a = await workspace(), key = randomUUID();
  await expect(db.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO scenario_events(factory_id,workspace_id,type,actor_id,source,payload_json)
      VALUES(${factoryA},${a}::uuid,'TEST',${actor.id}::uuid,'HTTP','{}')`;
    await tx.$executeRaw`INSERT INTO scenario_command_receipts(factory_id,workspace_id,actor_id,key,request_hash,response_json,response_status)
      VALUES(${factoryA},${a}::uuid,${actor.id}::uuid,${key},${hash},'{}',201)`;
    throw Error('forced failure');
  })).rejects.toThrow('forced failure');
  expect(await db.$queryRaw`SELECT sequence FROM scenario_events WHERE workspace_id=${a}::uuid`).toHaveLength(0);
  expect(await db.$queryRaw`SELECT key FROM scenario_command_receipts WHERE key=${key}`).toHaveLength(0);
});
