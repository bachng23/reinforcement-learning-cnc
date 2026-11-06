const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const BASE = 'ff9a3aeec7d6f3b19e655a326cea214a968764c0';
async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/_(test|ci)$/.test(url.pathname))
    throw Error('Explicit test database required');
  const schema = 'analytics_upgrade_' + randomUUID().replaceAll('-', '');
  url.searchParams.set('schema', schema);
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = 'test';
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  process.env.JWT_SECRET ||= 'analytics-upgrade-test-only-secret-32-plus';
  const db = require('../src/config/prisma');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-upgrade-'));
  const root = path.resolve(__dirname, '..'),
    repo = path.dirname(root);
  const git = (...args) =>
    execFileSync('git', ['-c', 'safe.directory=' + repo.replaceAll('\\', '/'), ...args], { cwd: repo });
  const deploy = (directory) =>
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        path.join(directory, 'schema.prisma'),
      ],
      { cwd: directory, env: process.env, stdio: 'pipe' },
    );
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
  } finally {
    await f?.close();
    if (owned) await db.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
    await db.$disconnect();
    // Only the exact directory created by mkdtemp above is removed.
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
