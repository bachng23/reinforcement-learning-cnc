require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { importFactoryAccess } = require('../src/services/factory-access-import.service');
async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--apply') || args.length > 1)
    throw new Error('Usage: import-factory-access.js [--apply]');
  if (!process.env.DATABASE_URL || process.env.OPERATIONS_FACTORY_ACCESS === undefined)
    throw new Error('Explicit DATABASE_URL and OPERATIONS_FACTORY_ACCESS required');
  const db = new PrismaClient();
  try {
    console.log(
      JSON.stringify(
        await importFactoryAccess(db, process.env.OPERATIONS_FACTORY_ACCESS, {
          apply: args.includes('--apply'),
        }),
      ),
    );
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(
      e.code || 'FACTORY_ACCESS_IMPORT_FAILED',
      'Validate configuration and registry/user references; no partial import',
    );
    process.exitCode = 1;
  });
