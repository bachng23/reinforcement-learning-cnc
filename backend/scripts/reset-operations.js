require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { loadCanonicalSeedPlan, validatePayload } = require('../src/services/operations-contract.service');
const canonical = require('../../contracts/v3/fixtures/demo-health-alert.json');

// Administrative demo-only operation. Never expose through an HTTP route.
async function resetDemoScope(db, plan, { factoryId, databaseUrl } = {}) {
  if (!['development', 'test'].includes(process.env.NODE_ENV) || !databaseUrl) {
    throw new Error('Reset requires development/test and an explicit OPERATIONS_DEMO_DATABASE_URL');
  }
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname.length < 2) throw new Error('Expected an explicit PostgreSQL database');
  const payload = await validatePayload(plan, 'seed');
  if (plan.scenario_id !== 'demo-health-alert' || factoryId !== canonical.factory_snapshot.factory_id || factoryId !== payload.factory_id) {
    throw new Error('Reset factory must match the canonical demo scope');
  }
  return db.$transaction(async tx => {
    const [target] = await tx.$queryRaw`SELECT current_database() AS database, current_schema() AS schema`;
    if (target.database !== decodeURIComponent(url.pathname.slice(1)) || target.schema !== (url.searchParams.get('schema') || 'public')) {
      throw new Error('Reset connection does not match the explicitly selected demo database/schema');
    }
    // Same factory lock as seed, then table locks: no concurrent reader/writer can
    // observe disabled triggers. PostgreSQL rolls back DDL too on any failure.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${factoryId}, 0))::text`;
    await tx.$executeRawUnsafe('LOCK TABLE operations_heads, operation_schedules, factory_snapshots IN ACCESS EXCLUSIVE MODE');
    await tx.$executeRawUnsafe('ALTER TABLE operation_schedules DISABLE TRIGGER operation_schedules_immutable');
    await tx.$executeRawUnsafe('ALTER TABLE factory_snapshots DISABLE TRIGGER factory_snapshots_immutable');
    const heads = await tx.operationsHead.deleteMany({ where: { factoryId } });
    const schedules = await tx.operationSchedule.deleteMany({ where: { factoryId } });
    const snapshots = await tx.factorySnapshot.deleteMany({ where: { factoryId } });
    await tx.$executeRawUnsafe('ALTER TABLE factory_snapshots ENABLE TRIGGER factory_snapshots_immutable');
    await tx.$executeRawUnsafe('ALTER TABLE operation_schedules ENABLE TRIGGER operation_schedules_immutable');
    return { factory_id: factoryId, deleted: { heads: heads.count, schedules: schedules.count, snapshots: snapshots.count } };
  }, { timeout: 15000 });
}

async function main() {
  const databaseUrl = process.env.OPERATIONS_DEMO_DATABASE_URL;
  if (!databaseUrl || !['development', 'test'].includes(process.env.NODE_ENV)) throw new Error('Set NODE_ENV=development and OPERATIONS_DEMO_DATABASE_URL explicitly');
  const plan = await loadCanonicalSeedPlan();
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try { console.log(JSON.stringify(await resetDemoScope(db, plan, { factoryId: process.argv[2], databaseUrl }))); }
  finally { await db.$disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.code || 'OPERATIONS_RESET_FAILED', 'Check canonical factory scope, explicit demo target and database owner permissions'); process.exitCode = 1; });
module.exports = { resetDemoScope };
