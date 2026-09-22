require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const { PrismaClient } = require('@prisma/client');
const { loadCanonicalSeedPlan, validatePayload } = require('../src/services/operations-contract.service');
const { ingestFactorySnapshot } = require('../src/services/operations-snapshot.service');

async function main() {
  const [factoryId, revision, sourceId, snapshotFile, ...extra] = process.argv.slice(2);
  if (process.env.NODE_ENV !== 'development' || !process.env.OPERATIONS_DEMO_DATABASE_URL) {
    throw new Error('Development mode and an explicit OPERATIONS_DEMO_DATABASE_URL are required');
  }
  if (!factoryId || !/^(0|[1-9][0-9]*)$/.test(revision || '') || !sourceId || extra.length) {
    throw new Error('Usage: operations:ingest -- <factoryId> <expectedHeadRevision> <sourceId> [snapshot.json]');
  }
  // No file means ingest the exact canonical scenario, without rewriting its ID.
  const snapshot = snapshotFile ? JSON.parse(await fs.readFile(snapshotFile, 'utf8'))
    : await validatePayload(await loadCanonicalSeedPlan(), 'seed');
  const db = new PrismaClient({ datasources: { db: { url: process.env.OPERATIONS_DEMO_DATABASE_URL } } });
  try { console.log(JSON.stringify(await ingestFactorySnapshot({ factoryId,
    expectedHeadRevision: Number(revision), snapshot, sourceId }, db))); }
  finally { await db.$disconnect(); }
}
if (require.main === module) main().catch((error) => {
  console.error(error.code || 'OPERATIONS_INGEST_FAILED', error.statusCode ? error.message : 'Check development mode, explicit demo database, arguments and canonical snapshot file');
  process.exitCode = 1;
});
