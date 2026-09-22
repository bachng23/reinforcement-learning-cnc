const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');
const { loadCanonicalSeedPlan, validatePayload, contentHash } = require('../../src/services/operations-contract.service');
const { readOperations } = require('../../src/services/operations-context.service');

describe('Snapshot ingestion — isolated PostgreSQL schema', () => {
  let db, canonical;
  beforeAll(async () => { db = new PrismaClient(); canonical = await validatePayload(await loadCanonicalSeedPlan(), 'seed'); });
  afterAll(async () => { await db.$disconnect(); });
  const factory = () => `ingest-${randomUUID()}`;
  function snapshot(factoryId, snapshotId = 'S1') {
    const value = structuredClone(canonical);
    value.factory_id = factoryId;
    value.snapshot_id = snapshotId;
    if (value.current_schedule) value.current_schedule.factory_id = factoryId;
    return value;
  }
  const ingest = (factoryId, value, expectedHeadRevision = 0, client = db) => ingestFactorySnapshot({
    factoryId, expectedHeadRevision, snapshot: value, sourceId: 'simulator-v1',
  }, client);
  const head = (factoryId) => db.operationsHead.findUnique({ where: { factoryId } });
  const auditCount = (factoryId) => db.auditLog.count({ where: { entityId: factoryId, action: 'OPERATIONS_SNAPSHOT_INGESTED' } });
  async function baseline(factoryId) {
    const first = await ingest(factoryId, snapshot(factoryId));
    const stored = await db.factorySnapshot.findUnique({ where: { factoryId_snapshotId: { factoryId, snapshotId: 'S1' } } });
    const schedule = stored.payloadJson.current_schedule;
    // Arrange an already-published schedule, not an ingestion/approval operation.
    await db.operationSchedule.create({ data: { factoryId, snapshotId: 'S1', scheduleId: schedule.schedule_id,
      revision: schedule.revision, schemaVersion: '3.0', contentHash: contentHash(schedule), payloadJson: schedule } });
    await db.operationsHead.update({ where: { factoryId }, data: { scheduleId: schedule.schedule_id, scheduleRevision: schedule.revision, planVersion: 1 } });
    return first;
  }
  test('first snapshot creates revision 1, no schedule publication, with provenance/audit', async () => {
    const id = factory();
    const result = await ingest(id, snapshot(id));
    expect(result).toMatchObject({ snapshotId: 'S1', sourceId: 'simulator-v1', replayed: false,
      head: { revision: 1, snapshotId: 'S1', scheduleId: null, scheduleRevision: null, planVersion: 0 } });
    expect(await db.operationSchedule.count({ where: { factoryId: id } })).toBe(0);
    const audit = await db.auditLog.findFirst({ where: { entityId: id } });
    expect(audit).toMatchObject({ action: 'OPERATIONS_SNAPSHOT_INGESTED', actorUserId: null,
      payloadJson: { sourceId: 'simulator-v1', previousHeadRevision: 0, headRevision: 1, contentHash: result.contentHash } });
    expect(audit.createdAt).toBeInstanceOf(Date);
  });
  test('S2 preserves P1, basis S1 and plan version; both read APIs remain consistent', async () => {
    const id = factory();
    await baseline(id);
    const before = await head(id);
    const priorSnapshot = await db.factorySnapshot.findUnique({ where: { factoryId_snapshotId: { factoryId: id, snapshotId: 'S1' } } });
    const next = snapshot(id, 'S2');
    next.current_schedule = null; // Observation does not replace the published schedule.
    next.machines[0].status = 'WARNING';
    const result = await ingest(id, next, before.revision);
    expect(result.head).toEqual({ snapshotId: 'S2', revision: before.revision + 1,
      scheduleId: before.scheduleId, scheduleRevision: before.scheduleRevision, planVersion: 1 });
    expect(await db.factorySnapshot.findUnique({ where: { factoryId_snapshotId: { factoryId: id, snapshotId: 'S1' } } })).toEqual(priorSnapshot);
    const read = await readOperations(db, { role: 'ADMIN' }, id);
    expect(read.snapshot.snapshot_id).toBe('S2');
    expect(read.schedule.schedule_id).toBe(before.scheduleId);
    expect(read.meta).toMatchObject({ snapshot_id: 'S2', schedule_basis_snapshot_id: 'S1', plan_version: 1, head_revision: 2 });
    await expect(db.factorySnapshot.update({ where: { factoryId_snapshotId: { factoryId: id, snapshotId: 'S1' } }, data: { sourceId: 'rewritten' } })).rejects.toThrow('immutable');
    await expect(db.factorySnapshot.delete({ where: { factoryId_snapshotId: { factoryId: id, snapshotId: 'S1' } } })).rejects.toThrow();
    await expect(db.operationSchedule.updateMany({ where: { factoryId: id }, data: { contentHash: '0'.repeat(64) } })).rejects.toThrow('immutable');
  });
  test('replay after S2 does not duplicate audit, change timestamps or repoint head to S1', async () => {
    const id = factory();
    const s1 = snapshot(id);
    await ingest(id, s1);
    await ingest(id, snapshot(id, 'S2'), 1);
    const before = await head(id);
    expect((await ingest(id, s1, 0)).replayed).toBe(true);
    expect(await head(id)).toEqual(before);
    expect(await db.factorySnapshot.count({ where: { factoryId: id } })).toBe(2);
    expect(await auditCount(id)).toBe(2);
  });
  test('same ID with different valid content returns SNAPSHOT_CONTENT_CONFLICT before stale CAS', async () => {
    const id = factory();
    await ingest(id, snapshot(id));
    const changed = snapshot(id);
    changed.machines[0].display_name = 'Changed machine name';
    await expect(ingest(id, changed, 0)).rejects.toMatchObject({ statusCode: 409, code: 'SNAPSHOT_CONTENT_CONFLICT' });
    expect((await head(id)).revision).toBe(1);
    expect(await auditCount(id)).toBe(1);
  });
  test('stale revision, including nonexistent-head expectation, rejects without rows', async () => {
    const id = factory();
    await expect(ingest(id, snapshot(id), 1)).rejects.toMatchObject({ code: 'HEAD_REVISION_CONFLICT', statusCode: 409 });
    expect(await head(id)).toBeNull();
    await ingest(id, snapshot(id));
    await expect(ingest(id, snapshot(id, 'S2'), 0)).rejects.toMatchObject({ code: 'HEAD_REVISION_CONFLICT', statusCode: 409 });
    expect(await db.factorySnapshot.count({ where: { factoryId: id } })).toBe(1);
    expect(await auditCount(id)).toBe(1);
  });
  test.each([0, 1])('two competing new IDs against revision %i have exactly one winner', async (expected) => {
    const id = factory();
    if (expected) await ingest(id, snapshot(id));
    const results = await Promise.allSettled([ingest(id, snapshot(id, 'S2'), expected), ingest(id, snapshot(id, 'S3'), expected)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({ code: 'HEAD_REVISION_CONFLICT', statusCode: 409 });
    expect((await head(id)).revision).toBe(expected + 1);
    expect(await db.factorySnapshot.count({ where: { factoryId: id } })).toBe(expected + 1);
    expect(await auditCount(id)).toBe(expected + 1);
  });
  test('simultaneous identical snapshot retries produce one audit and one replay', async () => {
    const id = factory();
    const results = await Promise.all([ingest(id, snapshot(id)), ingest(id, snapshot(id))]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(await auditCount(id)).toBe(1);
  });
  test('invalid contract and cross-factory payloads fail before opening a transaction', async () => {
    const id = factory();
    const txSpy = jest.fn();
    for (const mutate of [
      (s) => { s.schema_version = '2.0'; },
      (s) => { s.current_schedule.factory_id = 'another-factory'; },
      (s) => { s.jobs[0].operations[0].machine_options[0].machine_id = 'foreign-machine'; },
      (s) => { s.factory_id = 'another-factory'; s.current_schedule.factory_id = 'another-factory'; },
    ]) {
      const value = snapshot(id); mutate(value);
      await expect(ingest(id, value, 0, { $transaction: txSpy })).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(txSpy).not.toHaveBeenCalled();
    expect(await db.factorySnapshot.count({ where: { factoryId: id } })).toBe(0);
    expect(await head(id)).toBeNull();
    expect(await auditCount(id)).toBe(0);
  });
  test('DB still rejects cross-factory schedule references after relaxing basis FK', async () => {
    const a = factory(), b = factory();
    await baseline(a);
    await ingest(b, snapshot(b));
    const current = await head(a);
    await expect(db.operationsHead.update({ where: { factoryId: b }, data: { scheduleId: current.scheduleId, scheduleRevision: current.scheduleRevision } })).rejects.toMatchObject({ code: 'P2003' });
  });
  test.each([false, true])('audit failure rolls back snapshot and head (existing=%s)', async (exists) => {
    const id = factory();
    if (exists) await baseline(id);
    const before = await head(id);
    const injected = { $transaction: (fn, options) => db.$transaction((tx) => fn({
      $queryRaw: tx.$queryRaw.bind(tx), factorySnapshot: tx.factorySnapshot, operationsHead: tx.operationsHead,
      auditLog: { create: async () => { throw new Error('injected audit failure'); } },
    }), options) };
    await expect(ingest(id, snapshot(id, 'S2'), exists ? 1 : 0, injected)).rejects.toThrow('injected audit failure');
    expect(await head(id)).toEqual(before);
    expect(await db.factorySnapshot.count({ where: { factoryId: id, snapshotId: 'S2' } })).toBe(0);
    expect(await auditCount(id)).toBe(exists ? 1 : 0);
  });
  test('CLI rejects non-development mode and missing explicit DB; development ingestion succeeds', async () => {
    const id = factory();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-ingest-'));
    const file = path.join(dir, 'snapshot.json');
    fs.writeFileSync(file, JSON.stringify(snapshot(id)));
    const command = path.resolve(__dirname, '../../scripts/ingest-operations-snapshot.js');
    const run = (extraEnv) => spawnSync(process.execPath, [command, id, '0', 'cli-test', file], {
      env: { ...process.env, OPERATIONS_DEMO_DATABASE_URL: process.env.DATABASE_URL, ...extraEnv },
      encoding: 'utf8', timeout: 20000, windowsHide: true,
    });
    try {
      expect(run({ NODE_ENV: 'production' }).status).toBe(1);
      expect(run({ NODE_ENV: 'test' }).status).toBe(1);
      expect(run({ NODE_ENV: 'development', OPERATIONS_DEMO_DATABASE_URL: '' }).status).toBe(1);
      expect(await head(id)).toBeNull();
      const success = run({ NODE_ENV: 'development' });
      expect(success.status).toBe(0);
      expect(JSON.parse(success.stdout)).toMatchObject({ replayed: false, head: { revision: 1, planVersion: 0 } });
      expect(JSON.parse(run({ NODE_ENV: 'development' }).stdout).replayed).toBe(true);
      expect(await auditCount(id)).toBe(1);
    } finally {
      fs.unlinkSync(file);
      fs.rmdirSync(dir);
    }
  });
});
