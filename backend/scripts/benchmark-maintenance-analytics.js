// Isolated local benchmark only. Never adopts or sweeps an existing schema.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
async function main() {
  const output = process.argv[2];
  if (!output || process.argv.length !== 3 || fs.existsSync(output))
    throw Error('Supply a NEW report filename');
  const url = new URL(process.env.DATABASE_URL || '');
  const schema = url.searchParams.get('schema');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !/_(test|ci)$/.test(url.pathname) ||
    !/^analytics_bench_[a-f0-9]{32}$/.test(schema || '')
  )
    throw Error('Use explicit test database and new analytics_bench_<32 hex> schema');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
    throw Error('Dedicated test JWT_SECRET required');
  process.env.NODE_ENV = 'test';
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  const db = require('../src/config/prisma');
  let owned = false,
    f;
  const cleanup = async () => {
    await f?.close();
    f = null;
    if (owned) {
      await db.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
      owned = false;
    }
    await db.$disconnect();
  };
  const interrupted = () => {
    cleanup().finally(() => process.exit(130));
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    await db.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
    owned = true;
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
      { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'pipe' },
    );
    if (result.status !== 0) throw Error('Benchmark migration failed');
    f = await require('../tests/helpers/work-order-fixtures').fixture(db, require('../src/app'));
    const { seed, benchmark } = require('../tests/helpers/maintenance-analytics-benchmark');
    const dataset = await seed(db, f);
    const report = await benchmark(db, f, dataset);
    report.sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    report.dirty = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim().length > 0;
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    if (report.results.some((r) => !r.pass)) process.exitCode = 1;
    console.log('Benchmark report written: ' + output);
  } finally {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    await cleanup();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
