const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { loadCanonicalSeedPlan, validatePayload, contentHash } = require('../../src/services/operations-contract.service');
const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');

// Pin the deployed main baseline so this test remains reproducible after merge.
const baseline = 'b8f716efff200d3058b17d1c1b7203c3b5da9618';
const root = path.resolve(__dirname, '../..');
const git = (...args) => execFileSync('git', args, { cwd: path.dirname(root) });

test('upgrades populated main without checksum drift, version backfill or schedule loss', async () => {
  const schema = `operations_upgrade_${randomBytes(8).toString('hex')}`;
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-upgrade-'));
  const deploy = () => execFileSync(process.execPath,
    [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(temp, 'schema.prisma')],
    { cwd: temp, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
  try {
    const files = git('ls-tree', '-r', '--name-only', baseline, '--', 'backend/prisma/migrations').toString().trim().split('\n');
    expect(files).toContain('backend/prisma/migrations/20260922000000_operations_context/migration.sql');
    for (const file of files) {
      const bytes = git('show', `${baseline}:${file}`);
      const relative = file.replace('backend/prisma/', '');
      // Ignore checkout-only CRLF conversion on Windows, but no SQL edits.
      expect(fs.readFileSync(path.join(root, 'prisma', relative), 'utf8').replace(/\r\n/g, '\n')).toBe(bytes.toString().replace(/\r\n/g, '\n'));
      const target = path.join(temp, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    fs.writeFileSync(path.join(temp, 'schema.prisma'), git('show', `${baseline}:backend/prisma/schema.prisma`));
    deploy();
    const snapshot = await validatePayload(await loadCanonicalSeedPlan(), 'seed');
    const schedule = snapshot.current_schedule;
    const factoryId = snapshot.factory_id;
    // Raw insertion uses only the baseline columns (source_id does not exist yet).
    await db.$executeRaw`INSERT INTO factory_snapshots
      (factory_id,snapshot_id,schema_version,content_hash,payload_json,captured_at)
      VALUES (${factoryId},${snapshot.snapshot_id},'3.0',${contentHash(snapshot)},${JSON.stringify(snapshot)}::jsonb,${new Date(snapshot.captured_at)})`;
    await db.operationSchedule.create({ data: { factoryId, snapshotId: snapshot.snapshot_id,
      scheduleId: schedule.schedule_id, revision: schedule.revision, schemaVersion: '3.0',
      contentHash: contentHash(schedule), payloadJson: schedule } });
    await db.operationsHead.create({ data: { factoryId, snapshotId: snapshot.snapshot_id,
      scheduleId: schedule.schedule_id, scheduleRevision: schedule.revision, planVersion: 7, revision: 9 } });
    const beforeHead = await db.operationsHead.findUnique({ where: { factoryId } });
    const beforeSchedule = await db.operationSchedule.findMany();
    const beforeSnapshot = await db.$queryRaw`SELECT * FROM factory_snapshots`;
    const beforeMigrations = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
    // Restart runtime connections across DDL; discard pre-upgrade prepared plans.
    await db.$disconnect();

    for (const name of fs.readdirSync(path.join(root, 'prisma/migrations'))) {
      const target = path.join(temp, 'migrations', name);
      if (!fs.existsSync(target)) fs.cpSync(path.join(root, 'prisma/migrations', name), target, { recursive: true });
    }
    fs.copyFileSync(path.join(root, 'prisma/schema.prisma'), path.join(temp, 'schema.prisma'));
    deploy();
    deploy(); // No pending migrations on replay.
    expect(await db.operationsHead.findUnique({ where: { factoryId } })).toEqual(beforeHead);
    expect(await db.operationSchedule.findMany()).toEqual(beforeSchedule);
    const stored = await db.$queryRaw`SELECT * FROM factory_snapshots`;
    expect(stored).toEqual(beforeSnapshot.map(row => ({ ...row, source_id: null })));
    const migrations = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
    expect(migrations).toHaveLength(beforeMigrations.length + 1);
    expect(migrations.slice(0, -1)).toEqual(beforeMigrations);
    for (const row of migrations) {
      expect(row.checksum).toBe(createHash('sha256').update(fs.readFileSync(path.join(temp, 'migrations', row.migration_name, 'migration.sql'))).digest('hex'));
    }
    const next = { ...snapshot, snapshot_id: 'upgrade-S2', current_schedule: null };
    const result = await ingestFactorySnapshot({ factoryId, expectedHeadRevision: 9, snapshot: next, sourceId: 'upgrade-test' }, db);
    expect(result.head).toMatchObject({ snapshotId: 'upgrade-S2', revision: 10,
      scheduleId: schedule.schedule_id, scheduleRevision: schedule.revision, planVersion: 7 });
    expect(await db.factorySnapshot.count()).toBe(2);
    await expect(db.factorySnapshot.deleteMany()).rejects.toThrow('immutable');
  } finally {
    try {
      if (!/^operations_upgrade_[a-f0-9]{16}$/.test(schema)) throw new Error('Unexpected schema');
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await db.$disconnect();
      if (path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir())
        || !path.basename(temp).startsWith('operations-upgrade-')) throw new Error('Unexpected temporary directory');
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
}, 120_000);
