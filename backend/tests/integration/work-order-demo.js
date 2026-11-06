// Trusted local demonstration only. Never targets a development/production schema.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
async function main() {
  const output = process.argv[2];
  const withOrders = process.argv[3] === '--with-work-orders';
  if (!output || process.argv.length > 4 || (process.argv[3] && !withOrders))
    throw Error('Usage: node tests/integration/work-order-demo.js NEW_MANIFEST [--with-work-orders]');
  if (fs.existsSync(output)) throw Error('Manifest already exists; choose a new output filename');
  const url = new URL(process.env.DATABASE_URL || '');
  const schema = url.searchParams.get('schema');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !/_(test|ci)$/.test(url.pathname) ||
    !/^work_order_demo_[a-f0-9]{32}$/.test(schema || '')
  )
    throw Error('Use an explicit test database and a unique work_order_demo_<32 hex> schema');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
    throw Error('Set a dedicated demo JWT_SECRET (at least 32 characters)');
  if (!process.env.WORK_ORDER_DEMO_PASSWORD || process.env.WORK_ORDER_DEMO_PASSWORD.length < 12)
    throw Error('Set WORK_ORDER_DEMO_PASSWORD (at least 12 characters)');
  process.env.NODE_ENV = 'test';
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  const db = require('../../src/config/prisma');
  let f;
  let owned = false;
  try {
    // CREATE, not IF NOT EXISTS: refuse to adopt another run's schema.
    await db.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
    owned = true;
    const r = spawnSync(
      process.execPath,
      [path.resolve(__dirname, '../../node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
      { cwd: path.resolve(__dirname, '../..'), env: process.env, stdio: 'pipe' },
    );
    if (r.status !== 0) throw Error('Demo migration failed; no application data retained');
    f = await require('../helpers/work-order-fixtures').fixture(db, require('../../src/app'));
    const a = await f.publish(await f.factory());
    const b = await f.publish(await f.factory());
    // Scope contrast: OPERATOR sees A, OUTSIDER sees B, VIEWER sees both.
    await f.member(b.body.factory_id, f.users.OPERATOR, 'DELETE');
    await f.member(b.body.factory_id, f.users.OUTSIDER);
    const passwordHash = await require('bcrypt').hash(process.env.WORK_ORDER_DEMO_PASSWORD, 10);
    for (const user of Object.values(f.users))
      await db.user.update({ where: { id: user.id }, data: { passwordHash } });
    const manifest = {
      schema,
      users: Object.fromEntries(
        Object.entries(f.users).map(([key, u]) => [
          key,
          { id: u.id, username: u.username, role: u.role, active: u.active },
        ]),
      ),
      factories: [a.body, b.body],
      work_orders: [],
    };
    // Explicit opt-in for cross-module handoff; publications never dispatch orders.
    if (withOrders) {
      for (const publication of [a, b]) {
        const order = await f.create(publication);
        if (order.status !== 201) throw Error('Work Order HTTP handoff creation failed');
        const summary = await f.http(
          `/work-orders/summaries?factory_id=${publication.body.factory_id}&ids=${order.body.data.id}`,
        );
        if (summary.status !== 200) throw Error('Work Order HTTP summary handoff failed');
        manifest.work_orders.push(summary.body.data[0]);
      }
    }
    fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    console.log(
      `Two committed publications ready; ${manifest.work_orders.length} explicitly requested handoff orders. Manifest: ${output}`,
    );
  } catch (error) {
    if (owned) await db.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
    throw error;
  } finally {
    await f?.close();
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
