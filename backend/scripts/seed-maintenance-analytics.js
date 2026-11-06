// Trusted test/demo setup, isolated schema; deterministic event times, real HTTP writes.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
async function main() {
  const output = process.argv[2];
  if (!output || process.argv.length !== 3 || fs.existsSync(output))
    throw Error('Supply a NEW manifest filename');
  const url = new URL(process.env.DATABASE_URL || ''),
    schema = url.searchParams.get('schema');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !/_(test|ci)$/.test(url.pathname) ||
    !/^analytics_demo_[a-f0-9]{32}$/.test(schema || '')
  )
    throw Error('Use explicit test database and new analytics_demo_<32 hex> schema');
  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32 ||
    !process.env.ANALYTICS_DEMO_PASSWORD ||
    process.env.ANALYTICS_DEMO_PASSWORD.length < 12
  )
    throw Error('Dedicated JWT_SECRET and ANALYTICS_DEMO_PASSWORD required');
  process.env.NODE_ENV = 'test';
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  const db = require('../src/config/prisma');
  let owned = false,
    f,
    keep = false;
  const cleanup = async () => {
    await f?.close();
    f = null;
    if (owned && !keep) {
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
    if (result.status !== 0) throw Error('Demo migration failed');
    f = await require('../tests/helpers/work-order-fixtures').fixture(db, require('../src/app'));
    const { publication, order } = await require('../tests/helpers/maintenance-analytics-golden').seedGolden(
      f,
    );
    const other = await f.publish(await f.factory());
    await f.create(other);
    await f.member(publication.body.factory_id, f.users.OUTSIDER, 'DELETE');
    await f.member(other.body.factory_id, f.users.OUTSIDER);
    const hash = await require('bcrypt').hash(process.env.ANALYTICS_DEMO_PASSWORD, 10);
    for (const user of Object.values(f.users))
      await db.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    const golden = require('../examples/maintenance-analytics-golden.json');
    const query = { factory_id: publication.body.factory_id, ...golden.period };
    const examples = {};
    for (const [endpoint, extra] of [
      ['overview', {}],
      ['trends', { metric_key: 'active_execution_time' }],
      ['machines', {}],
      ['drilldown', { metric_key: 'active_execution_time' }],
    ]) {
      const r = await f.http(
        '/maintenance-analytics/' + endpoint + '?' + new URLSearchParams({ ...query, ...extra }),
        { user: f.users.VIEWER },
      );
      if (r.status !== 200) throw Error('Demo analytics read failed');
      examples[endpoint] = r.body;
    }
    fs.writeFileSync(
      output,
      JSON.stringify(
        {
          schema,
          query,
          other_factory_id: other.body.factory_id,
          work_order_id: order.id,
          users: Object.fromEntries(
            Object.entries(f.users).map(([name, u]) => [
              name,
              { id: u.id, username: u.username, role: u.role },
            ]),
          ),
          examples,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    keep = true;
    console.log('Golden seed retained in ' + schema + '; manifest ' + output);
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
