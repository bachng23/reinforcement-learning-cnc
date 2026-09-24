require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { OperationsPlanningClient } = require('../src/services/operations-planning.client');
const { planPersistedSnapshot } = require('../src/services/operations-planning.service');

async function main() {
  if (!['development', 'test'].includes(process.env.NODE_ENV) || !process.env.OPERATIONS_DEMO_DATABASE_URL) {
    throw new Error('Set NODE_ENV=development and OPERATIONS_DEMO_DATABASE_URL explicitly');
  }
  const client = new OperationsPlanningClient(); // Fail closed if AI_SERVICE_URL is missing.
  const db = new PrismaClient({ datasources: { db: { url: process.env.OPERATIONS_DEMO_DATABASE_URL } } });
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  try {
    const recommendation = await planPersistedSnapshot(db, { id: 'operations-demo-cli', role: 'ADMIN' }, {
      factoryId: process.argv[2] || 'factory-demo-01',
      decisionCaseId: process.argv[3] || 'case-demo-planning',
    }, { client, signal: controller.signal, requestId: process.env.OPERATIONS_REQUEST_ID });
    console.log(JSON.stringify(recommendation));
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    await db.$disconnect();
  }
}
if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ code: error.code || 'OPERATIONS_PLAN_DEMO_FAILED',
    message: error.statusCode ? error.message : 'Check explicit demo database, AI URL and validator configuration' }));
  process.exitCode = 1;
});
module.exports = { main };
