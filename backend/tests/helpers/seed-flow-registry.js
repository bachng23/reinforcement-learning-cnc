// Registry-only prerequisite for the existing cross-stack snapshot-flow fixture.
// The frontend fixture inserts factory-integration-preserve directly; production
// ingestion must continue to reject unregistered factories.
const { PrismaClient } = require('@prisma/client');
const { bootstrapFactory } = require('../../src/services/factory-registry.service');
async function main() {
  const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema');
  if (process.env.NODE_ENV !== 'test' || !/^product_api_it_[a-zA-Z0-9_]+$/.test(schema || ''))
    throw new Error('Snapshot-flow bootstrap requires a runner-owned test schema');
  const db = new PrismaClient();
  try {
    await bootstrapFactory(db, 'factory-integration-preserve', 'snapshot-flow-test');
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => { console.error('Snapshot-flow registry bootstrap failed'); process.exitCode = 1; });
