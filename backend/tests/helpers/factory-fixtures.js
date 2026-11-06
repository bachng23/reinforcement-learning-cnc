const { bootstrapFactory } = require('../../src/services/factory-registry.service');
const { ingestFactorySnapshot: ingest } = require('../../src/services/operations-snapshot.service');
// Test harness explicitly registers fixtures. Production ingest never auto-creates.
async function ingestFactorySnapshot(input, db) {
  await bootstrapFactory(db, input.factoryId, 'test-fixture');
  return ingest(input, db);
}
module.exports = { ingestFactorySnapshot };
