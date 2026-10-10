#!/usr/bin/env node
const path = require('node:path');
const { PrismaClient } = require(path.resolve(__dirname, '../backend/node_modules/@prisma/client'));

function target() {
  const raw = process.env.OPERATIONS_DEMO_DATABASE_URL;
  if (!raw) throw new Error('OPERATIONS_DEMO_DATABASE_URL is required');
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.slice(1));
  const schema = url.searchParams.get('schema');
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !/_(demo|test|ci)$/.test(database)
    || !schema
    || !/^operations_demo_[a-z0-9_]+$/.test(schema)) {
    throw new Error('Reset requires a *_demo, *_test or *_ci PostgreSQL database and an operations_demo_* schema');
  }
  return { url, database, schema };
}

async function main() {
  if (!['development', 'test'].includes(process.env.NODE_ENV)) {
    throw new Error('Reset is allowed only with NODE_ENV=development or NODE_ENV=test');
  }
  const { url, database, schema } = target();
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const [actual] = await db.$queryRaw`SELECT current_database() AS database`;
    if (actual.database !== database) throw new Error('Connected database does not match the explicit reset target');
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    console.log(JSON.stringify({ reset: true, database, schema }));
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(`[operations e2e reset] ${error.message}`);
  process.exitCode = 1;
});
