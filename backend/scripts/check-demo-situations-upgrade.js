const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const BASE = '30a27f820e511567f7fad8199f123f75646cd9f3';
async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/_(test|ci)$/.test(url.pathname)) throw Error('Dedicated test DB required');
  const schema = 'product_api_it_situ_' + randomUUID().replaceAll('-', '');
  url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.toString();
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  const db = require('../src/config/prisma');
  const root = path.resolve(__dirname, '..'), repo = path.dirname(root);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jcst-situations-upgrade-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo });
  const deploy = dir => execFileSync(process.execPath,
    [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(dir, 'schema.prisma')],
    { cwd: root, env: process.env, encoding: 'utf8', stdio: 'pipe' });
  const journal = process.env.OPERATIONS_SCHEMA_JOURNAL;
  const target = new URL(process.env.TEST_DATABASE_URL).toString();
  if (journal) fs.appendFileSync(journal, JSON.stringify({ schema, target: createHash('sha256').update(target).digest('hex') }) + '\n');
  let owned = false, fixture;
  try {
    const files = git('ls-tree', '-r', '--name-only', BASE, '--', 'backend/prisma').toString().trim().split('\n')
      .filter(f => f.endsWith('schema.prisma') || f.includes('/migrations/'));
    for (const file of files) {
      const out = path.join(temp, file.replace('backend/prisma/', ''));
      fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, git('show', BASE + ':' + file));
    }
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); owned = true; deploy(temp);
    fixture = await require('../tests/helpers/work-order-fixtures').fixture(db, require('../src/app'));
    await require('../tests/helpers/maintenance-analytics-golden').seedGolden(fixture);
    await fixture.factory();
    const actor = await db.user.findFirst();
    const p = require('../examples/demo-work-orders-trace.json').snapshots.inProgress;
    const id = randomUUID(), hash = 'a'.repeat(64);
    await db.$executeRaw`INSERT INTO demo_sessions (id,owner_id,request_key,request_hash,revision,payload_json,work_orders_json)
      VALUES (${id}::uuid,${actor.id}::uuid,${randomUUID()},${hash},6,${JSON.stringify(p)}::jsonb,${JSON.stringify(require('../src/research/demo-work-orders').project(id, p))}::jsonb)`;
    const fingerprint = async () => {
      const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname=${schema} AND tablename <> '_prisma_migrations' ORDER BY tablename`;
      const result = {};
      for (const { tablename } of tables) {
        if (!/^[a-z_]+$/.test(tablename)) throw Error('Unsafe table');
        const projection = tablename === 'demo_sessions' ? "to_jsonb(t) - 'source_snapshot_id'" : 'to_jsonb(t)';
        const rows = await db.$queryRawUnsafe(`SELECT (${projection})::text AS row FROM "${schema}"."${tablename}" t ORDER BY (${projection})::text`);
        result[tablename] = { count: rows.length, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
      }
      return result;
    };
    const before = await fingerprint();
    const history = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
    deploy(path.join(root, 'prisma'));
    const after = await fingerprint();
    for (const [table, value] of Object.entries(before)) if (JSON.stringify(value) !== JSON.stringify(after[table])) throw Error('History changed: ' + table);
    const newHistory = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
    for (const row of history) if (!newHistory.some(h => h.migration_name === row.migration_name && h.checksum === row.checksum)) throw Error('Migration history changed');
    if (after.demo_snapshots.count || after.demo_write_receipts.count || after.demo_sessions.count !== 1) throw Error('Unexpected backfill');
    console.log(JSON.stringify({ base: BASE, unchanged: true, migrationHistoryUnchanged: true, tables: after }));
  } finally {
    await fixture?.close();
    if (!/^product_api_it_situ_[a-f0-9]{32}$/.test(schema)) throw Error('Unsafe schema cleanup');
    if (owned) await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    if (journal && fs.existsSync(journal)) fs.writeFileSync(journal, fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(e => e.schema !== schema).map(e => JSON.stringify(e) + '\n').join(''));
    await db.$disconnect();
    if (path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('jcst-situations-upgrade-')) throw Error('Unsafe temp cleanup');
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
main().catch(e => { console.error(e.stdout?.toString() || e.message); process.exitCode = 1; });
