require('dotenv').config();
const prisma = require('../config/prisma');
const { FakeEngineRunner } = require('../engine/fake-engine');
const { EpisodeRepository } = require('./repository');
const { EpisodeWorker } = require('./episode-worker');
const { createLogger } = require('./logger');

const positiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

async function main() {
  const logger = createLogger();
  const pollMs = positiveInt(process.env.WORKER_POLL_MS, 1000);
  const worker = new EpisodeWorker({
    repository: new EpisodeRepository(prisma),
    runner: new FakeEngineRunner(),
    timeoutMs: positiveInt(process.env.ENGINE_TIMEOUT_MS, 30000),
    staleAfterMs: positiveInt(process.env.WORKER_STALE_MS, 120000),
    logger,
  });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await worker.recoverStale();
  logger.info('worker_started', { pollMs, health: worker.health.snapshot() });
  while (!stopping) {
    const processed = await worker.processNext();
    if (!processed) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  logger.info('worker_stopped', { health: worker.health.snapshot() });
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(JSON.stringify({ level: 'error', component: 'episode-worker', event: 'worker_crashed', message: error.message }));
    await prisma.$disconnect();
    process.exitCode = 1;
  });
}

module.exports = { main };
