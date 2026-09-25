require('dotenv').config();
const db = require('../config/prisma');
const { OperationsPlanningClient } = require('../services/operations-planning.client');
const { DecisionCaseWorker } = require('./decision-case-worker');

async function main() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const worker = new DecisionCaseWorker({ db, planningClient: new OperationsPlanningClient() });
    await worker.start({ signal: controller.signal });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await db.$disconnect();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ level: 'error', message: 'Decision Case worker stopped', code: error.code || 'WORKER_FAILED' }));
  process.exitCode = 1;
});
