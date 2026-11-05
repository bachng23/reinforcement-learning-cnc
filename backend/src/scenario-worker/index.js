require('dotenv').config();
const db = require('../config/prisma');
const { ScenarioEngineClient } = require('../services/scenario-engine.client');
const { ScenarioWorker } = require('./worker');

async function main() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { await new ScenarioWorker({ db, client: new ScenarioEngineClient() }).start({ signal: controller.signal }); }
  finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await db.$disconnect();
  }
}
main().catch(error => { console.error(JSON.stringify({ code: error.code || 'SCENARIO_WORKER_FAILED' })); process.exitCode = 1; });
