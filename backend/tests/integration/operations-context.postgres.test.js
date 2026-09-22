const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../../src/config/prisma');
const app = require('../../src/app');
const { loadCanonicalSeedPlan, contentHash, validatePayload } = require('../../src/services/operations-contract.service');
const { seedOperations } = require('../../src/services/operations-context.service');

describe('Operations Context — canonical seed, PostgreSQL persistence and authenticated HTTP', () => {
  let server, base, plan, admin, viewer, outsider, factoryId;
  const originalAccess = process.env.OPERATIONS_FACTORY_ACCESS;
  beforeAll(async () => {
    plan = await loadCanonicalSeedPlan();
    factoryId = plan.factory_id;
    for (const role of ['ADMIN', 'VIEWER', 'OPERATOR']) {
      const user = await prisma.user.create({ data: { username: `ops-${randomUUID()}`, passwordHash: 'test-only', role } });
      if (role === 'ADMIN') admin = user;
      else if (role === 'VIEWER') viewer = user;
      else outsider = user;
    }
    process.env.OPERATIONS_FACTORY_ACCESS = JSON.stringify({ [factoryId]: [viewer.id] });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });
  afterAll(async () => {
    if (originalAccess === undefined) delete process.env.OPERATIONS_FACTORY_ACCESS;
    else process.env.OPERATIONS_FACTORY_ACCESS = originalAccess;
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect(); // Runner drops isolated schema; no disabling immutability triggers.
  });
  async function get(path, user = admin) {
    const response = await fetch(base + path, { headers: user ? { Authorization: `Bearer ${jwt.sign({ id: user.id }, process.env.JWT_SECRET)}` } : {} });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  test('canonical six-machine seed is atomic and idempotent, including concurrent replay', async () => {
    const results = await Promise.all([seedOperations(prisma, plan, { factoryId }), seedOperations(prisma, plan, { factoryId })]);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    expect(results[0].machines).toBe(6);
    const before = await prisma.operationsHead.findUnique({ where: { factoryId } });
    await seedOperations(prisma, plan, { factoryId });
    expect(await prisma.operationsHead.findUnique({ where: { factoryId } })).toEqual(before);
    expect(await prisma.factorySnapshot.count({ where: { factoryId } })).toBe(1);
    expect(await prisma.operationSchedule.count({ where: { factoryId } })).toBe(1);
  });
  test('API client reads real canonical snapshot and current schedule with independently verifiable hashes', async () => {
    const expected = await validatePayload(plan, 'seed');
    const snapshot = await get(`/operations/snapshot?factory_id=${factoryId}`, viewer);
    const schedule = await get(`/schedules/current?factory_id=${factoryId}`, viewer);
    expect(snapshot.status).toBe(200);
    expect(schedule.status).toBe(200);
    expect(snapshot.body.data.snapshot).toEqual(expected);
    expect(snapshot.body.data.snapshot.machines).toHaveLength(6);
    expect(snapshot.body.data.plan_version).toBe(1);
    expect(snapshot.body.data.current_schedule_id).toBe(expected.current_schedule.schedule_id);
    expect(schedule.body.data.schedule).toEqual(expected.current_schedule);
    expect(schedule.body.data.plan_version).toBe(1);
    expect(snapshot.body.meta.snapshot_hash).toBe(contentHash(snapshot.body.data.snapshot));
    expect(schedule.body.meta.schedule_hash).toBe(contentHash(schedule.body.data.schedule));
    expect(snapshot.headers.get('cache-control')).toBe('no-store');
  });
  test.each(['/operations/snapshot', '/schedules/current'])('%s authenticates and scopes reads', async (route) => {
    expect((await get(`${route}?factory_id=${factoryId}`, null)).status).toBe(401);
    expect((await get(`${route}?factory_id=${factoryId}`, outsider)).status).toBe(404);
    const unknown = await get(`${route}?factory_id=unknown-factory`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('FACTORY_NOT_FOUND');
    expect(unknown.body.schema_version).toBe('3.0');
    expect((await get(route)).status).toBe(400);
    expect((await get(`${route}?factory_id=${factoryId}&unexpected=1`)).status).toBe(400);
  });
  test('invalid schema version, invalid references and bad source hash cause no persistence', async () => {
    const count = await prisma.factorySnapshot.count();
    for (const mutate of [
      (p) => { p.run_request.factory_snapshot.schema_version = '2.0'; },
      (p) => { delete p.run_request.factory_snapshot.schema_version; },
      (p) => { p.run_request.factory_snapshot.machines[0].extra_field = true; },
      (p) => { p.run_request.factory_snapshot.current_schedule.assignments[0].machine_id = 'missing'; },
      (p) => { p.fixture_sha256 = '0'.repeat(64); },
      (p) => { p.steps.find((s) => s.entity === 'machines').records.pop(); },
    ]) {
      const invalid = structuredClone(plan);
      mutate(invalid);
      await expect(seedOperations(prisma, invalid, { factoryId })).rejects.toMatchObject({ code: 'INVALID_OPERATIONS_SCHEMA' });
    }
    await expect(seedOperations(prisma, plan, { factoryId: 'other' })).rejects.toMatchObject({ code: 'FACTORY_SCOPE_MISMATCH' });
    expect(await prisma.factorySnapshot.count()).toBe(count);
  });
  test('PostgreSQL forbids snapshot/schedule edits, deletes and truncation', async () => {
    for (const table of ['factory_snapshots', 'operation_schedules']) {
      await expect(prisma.$executeRawUnsafe(`UPDATE ${table} SET content_hash = '${'0'.repeat(64)}' WHERE factory_id = $1`, factoryId)).rejects.toThrow('immutable');
      await expect(prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE factory_id = $1`, factoryId)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`TRUNCATE TABLE ${table} CASCADE`)).rejects.toThrow('immutable');
    }
    expect((await get(`/operations/snapshot?factory_id=${factoryId}`)).status).toBe(200);
  });
  test('changed head is not reset by reseeding; any seed writes roll back', async () => {
    // Demonstrate the adapter does not undo a later operational head.
    await prisma.operationsHead.update({ where: { factoryId }, data: { scheduleId: null, scheduleRevision: null } });
    try {
      await expect(seedOperations(prisma, plan, { factoryId })).rejects.toMatchObject({ code: 'OPERATIONS_SEED_CONFLICT' });
      expect((await prisma.operationsHead.findUnique({ where: { factoryId } })).scheduleId).toBeNull();
      // The API refuses a head that disagrees with the immutable snapshot.
      expect((await get(`/schedules/current?factory_id=${factoryId}`)).body.code).toBe('OPERATIONS_INTEGRITY_ERROR');
    } finally {
      const s = plan.run_request.factory_snapshot.current_schedule;
      await prisma.operationsHead.update({ where: { factoryId }, data: { scheduleId: s.schedule_id, scheduleRevision: s.revision } });
    }
  });
  test('a fresh snapshot can retain a schedule based on the previous snapshot', async () => {
    const canonical = await validatePayload(plan, 'seed');
    const previousSnapshotId = canonical.snapshot_id;
    const draft = structuredClone(canonical);
    draft.snapshot_id = 'snapshot-demo-fresh-observation';
    draft.captured_at = new Date(new Date(draft.captured_at).getTime() + 60_000).toISOString();
    const fresh = await validatePayload(draft);
    await prisma.factorySnapshot.create({ data: { factoryId, snapshotId: fresh.snapshot_id, schemaVersion: '3.0',
      payloadJson: fresh, contentHash: contentHash(fresh), capturedAt: new Date(fresh.captured_at) } });
    await prisma.operationsHead.update({ where: { factoryId }, data: { snapshotId: fresh.snapshot_id, revision: { increment: 1 } } });
    try {
      const response = await get(`/schedules/current?factory_id=${factoryId}`);
      expect(response.status).toBe(200);
      expect(response.body.data.snapshot_id).toBe(fresh.snapshot_id);
      expect(response.body.data.schedule).toEqual(canonical.current_schedule);
      expect(response.body.meta.schedule_basis_snapshot_id).toBe(previousSnapshotId);
    } finally {
      await prisma.operationsHead.update({ where: { factoryId }, data: { snapshotId: previousSnapshotId, revision: { increment: 1 } } });
    }
  });
  test('API rejects stored invalid schema/content hash, and nullable schedule works', async () => {
    const canonical = await validatePayload(plan, 'seed');
    for (const scenario of ['hash', 'schema', 'empty']) {
      const id = `factory-${scenario}`;
      const payload = { ...structuredClone(canonical), factory_id: id, snapshot_id: `snapshot-${scenario}`, current_schedule: null };
      if (scenario === 'schema') payload.machines[0] = { ...payload.machines[0], status: 'INVALID_STATUS' };
      await prisma.factorySnapshot.create({ data: { factoryId: id, snapshotId: payload.snapshot_id, schemaVersion: '3.0',
        payloadJson: payload, contentHash: scenario === 'hash' ? '0'.repeat(64) : contentHash(payload), capturedAt: new Date(payload.captured_at) } });
      await prisma.operationsHead.create({ data: { factoryId: id, snapshotId: payload.snapshot_id } });
      const result = await get(`/schedules/current?factory_id=${id}`);
      expect(result.status).toBe(scenario === 'empty' ? 200 : 500);
      if (scenario === 'empty') {
        expect(result.body.data.schedule).toBeNull();
        expect(result.body.data.plan_version).toBe(0);
      }
      else expect(result.body.code).toBe('OPERATIONS_INTEGRITY_ERROR');
    }
  });
  test('cross-factory head references cannot be persisted', async () => {
    const s = plan.run_request.factory_snapshot.current_schedule;
    await expect(prisma.operationsHead.create({ data: { factoryId: 'foreign', snapshotId: plan.run_request.factory_snapshot.snapshot_id,
      scheduleId: s.schedule_id, scheduleRevision: s.revision } })).rejects.toMatchObject({ code: 'P2003' });
  });
});
