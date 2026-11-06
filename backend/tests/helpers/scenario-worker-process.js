// Owned-process crash/restart probe. Accepted output always uses the real client.
const db = require('../../src/config/prisma');
const { ScenarioWorker } = require('../../src/scenario-worker/worker');
const { ScenarioEngineClient } = require('../../src/services/scenario-engine.client');
const keepAlive = setInterval(() => {}, 1000);
const report = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
async function main() {
  const client = process.argv[2] === 'pause-after-claim' ? { execute: async request => {
    await report({ phase: 'claimed', jobId: request.identity.run_id, inputHash: request.identity.frozen_input_hash });
    return new Promise(() => {});
  } } : new ScenarioEngineClient();
  try {
    const result = await new ScenarioWorker({ db, client, leaseMs: 1000 }).runOnce();
    await report({ phase: 'done', result });
  } finally { clearInterval(keepAlive); await db.$disconnect(); process.disconnect(); }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
