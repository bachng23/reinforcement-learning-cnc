require('dotenv').config();
const prisma = require('../config/prisma');
const { createEngineRunner } = require('../engine/runner');
const { EpisodeRepository } = require('./repository');
const { EpisodeWorker } = require('./episode-worker');
const { createLogger } = require('./logger');
const positiveInt = (value, fallback) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('Worker timing values must be positive integers');
  return parsed;
};
async function main({ adapter } = {}) {
  const logger = createLogger();
  const pollMs = positiveInt(process.env.WORKER_POLL_MS, 1000);
  const leaseMs = positiveInt(process.env.WORKER_LEASE_MS, 120000);
  const worker = new EpisodeWorker({ repository: new EpisodeRepository(prisma), runner: createEngineRunner(process.env, adapter),
    timeoutMs: positiveInt(process.env.ENGINE_TIMEOUT_MS, 30000), staleAfterMs: leaseMs,
    heartbeatMs: positiveInt(process.env.WORKER_HEARTBEAT_MS, Math.floor(leaseMs / 3)),
    shutdownMs: positiveInt(process.env.WORKER_SHUTDOWN_MS, 30000), logger });
  let wake;
  const stop = () => { worker.stop(); wake?.(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    logger.info('worker_started', { pollMs, engineVersion: worker.runner.version });
    while (!worker.stopping) {
      await worker.recoverStale();
      const processed = await worker.processNext();
      if (!processed && !worker.stopping) await new Promise((resolve) => {
        const timer = setTimeout(resolve, pollMs);
        wake = () => { clearTimeout(timer); resolve(); };
      });
    }
  } finally {
    await worker.stop();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await prisma.$disconnect();
    logger.info('worker_stopped', { health: worker.health.snapshot() });
  }
}
if (require.main === module) main().catch(async (error) => {
  console.error(JSON.stringify({ level: 'error', component: 'episode-worker', event: 'worker_crashed', message: error.message }));
  await prisma.$disconnect();
  process.exitCode = 1;
});
module.exports = { main };
