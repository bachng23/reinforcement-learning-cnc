require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { loadCanonicalSeedPlan } = require('../src/services/operations-contract.service');
const { seedOperations } = require('../src/services/operations-context.service');

async function main() {
  const factoryId = process.argv[2];
  // No implicit fallback to the application's production DATABASE_URL.
  if (!process.env.OPERATIONS_DEMO_DATABASE_URL || !factoryId || !['development', 'test'].includes(process.env.NODE_ENV)) {
    throw new Error('Set NODE_ENV=development, OPERATIONS_DEMO_DATABASE_URL and pass the canonical factory ID explicitly');
  }
  const plan = await loadCanonicalSeedPlan();
  if (plan.scenario_id !== 'demo-health-alert' || plan.run_request.factory_snapshot.machines.length !== 6) throw new Error('Expected canonical six-machine demo');
  const db = new PrismaClient({ datasources: { db: { url: process.env.OPERATIONS_DEMO_DATABASE_URL } } });
  try { console.log(JSON.stringify(await seedOperations(db, plan, { factoryId }))); }
  finally { await db.$disconnect(); }
}
if (require.main === module) main().catch((error) => { console.error(error.code || 'OPERATIONS_SEED_FAILED', error.statusCode ? error.message : 'Check canonical fixtures, validator and explicit demo database configuration'); process.exitCode = 1; });
