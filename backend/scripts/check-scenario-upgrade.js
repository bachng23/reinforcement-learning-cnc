const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const BASE = 'c926d5d24566834850cf4a16af0792af9c7d50fd';
async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/_(test|ci)$/.test(url.pathname))
    throw Error('Explicit test database required');
  const baseUrl = new URL(url);
  // PostgreSQL identifiers are limited to 63 bytes. The full scenario_upgrade prefix + UUID is 64.
  const schema = 'product_api_it_scu_' + randomUUID().replaceAll('-', '');
  url.searchParams.set('schema', schema);
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = 'test';
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  process.env.JWT_SECRET ||= 'scenario-upgrade-test-only-secret-32-plus';
  const db = require('../src/config/prisma');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-upgrade-'));
  const root = path.resolve(__dirname, '..'),
    repo = path.dirname(root);
  const git = (...args) =>
    execFileSync('git', ['-c', 'safe.directory=' + repo.replaceAll('\\', '/'), ...args], { cwd: repo });
  const deploy = (directory) => {
    try { return execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        path.join(directory, 'schema.prisma'),
      ],
      { cwd: root, env: process.env, stdio: 'pipe' },
    ); } catch (error) {
      console.error(error.stdout?.toString() ?? '');
      throw error;
    }
  };
  const journal = process.env.OPERATIONS_SCHEMA_JOURNAL;
  const readJournal = () => journal && fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  if (journal) fs.appendFileSync(journal, JSON.stringify({ schema, target: createHash('sha256').update(baseUrl.toString()).digest('hex') }) + '\n');
  let owned = false,
    f;
  try {
    const files = git('ls-tree', '-r', '--name-only', BASE, '--', 'backend/prisma')
      .toString()
      .trim()
      .split('\n')
      .filter((p) => p.endsWith('schema.prisma') || p.includes('/migrations/'));
    for (const file of files) {
      const out = path.join(temp, file.replace('backend/prisma/', ''));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, git('show', BASE + ':' + file));
    }
    await db.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
    owned = true;
    deploy(temp);
    f = await require('../tests/helpers/work-order-fixtures').fixture(db, require('../src/app'));
    await require('../tests/helpers/maintenance-analytics-golden').seedGolden(f);
    await f.factory(); // A second independent factory must survive the same upgrade.
    const published = await db.operationsHead.findFirst({ where: { planVersion: { gt: 0 } }, include: { snapshot: true, schedule: true } });
    if (!published?.schedule) throw Error('Populated upgrade requires a real published schedule');
    const observed = structuredClone(published.snapshot.payloadJson);
    observed.snapshot_id = 'upgrade-S2-' + randomUUID();
    observed.captured_at = new Date(Date.parse(observed.captured_at) + 60000).toISOString();
    observed.current_schedule = structuredClone(published.schedule.payloadJson);
    await require('../src/services/operations-snapshot.service').ingestFactorySnapshot({ factoryId: published.factoryId,
      expectedHeadRevision: published.revision, snapshot: observed, sourceId: 'scenario-upgrade-observation' }, db);
    const fingerprint = async () => {
      const tables =
        await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname=${schema} AND tablename<>'_prisma_migrations' ORDER BY tablename`;
      const result = {};
      for (const { tablename } of tables) {
        if (!/^[a-z_]+$/.test(tablename)) throw Error('Unexpected table identifier');
        const rows = await db.$queryRawUnsafe(
          'SELECT to_jsonb(t)::text AS row FROM "' +
            schema +
            '"."' +
            tablename +
            '" t ORDER BY to_jsonb(t)::text',
        );
        result[tablename] = {
          count: rows.length,
          sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
        };
      }
      return result;
    };
    const before = await fingerprint();
    if (before.factories.count < 2 || before.factory_snapshots.count < 3 || before.decision_commits.count < 1)
      throw Error('Upgrade fixture did not populate both factories and S2/P1 historical basis');
    deploy(path.join(root, 'prisma'));
    const after = await fingerprint();
    for (const [table, fingerprint] of Object.entries(before)) {
      if (JSON.stringify(fingerprint) !== JSON.stringify(after[table]))
        throw Error('Populated upgrade changed source/history table: ' + table);
    }
    // New additive modules can create empty tables without changing history.
    for (const [table, fingerprint] of Object.entries(after)) {
      if (!(table in before) && fingerprint.count !== 0)
        throw Error('Populated upgrade unexpectedly populated new table: ' + table);
    }
    console.log(JSON.stringify({ base: BASE, schema, unchanged: true, tables: after }));
  } catch (error) {
    console.error('Upgrade failed before cleanup: ' + error.message);
    throw error;
  } finally {
    await f?.close();
    if (!/^product_api_it_scu_[a-f0-9]{32}$/.test(schema)) throw Error('Unexpected cleanup target');
    if (owned) await db.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
    if (journal) fs.writeFileSync(journal, readJournal().filter(entry => entry.schema !== schema).map(entry => JSON.stringify(entry) + '\n').join(''));
    await db.$disconnect();
    // Only the exact directory created by mkdtemp above is removed.
    const resolved = path.resolve(temp);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('scenario-upgrade-')) throw Error('Unexpected temporary directory');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
