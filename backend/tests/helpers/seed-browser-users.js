const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const target = new URL(process.env.DATABASE_URL);
  if (process.env.NODE_ENV !== 'test' || !/_(test|ci)$/.test(target.pathname)
    || !/^product_api_it_browser_/.test(target.searchParams.get('schema') ?? '')) {
    throw new Error('Browser seed requires a harness-owned schema in a dedicated test database');
  }
  const output = process.env.OPERATIONS_E2E_USERS_FILE;
  const password = process.env.OPERATIONS_E2E_ROLE_PASSWORD;
  if (!output || !password) throw new Error('OPERATIONS_E2E_USERS_FILE and OPERATIONS_E2E_ROLE_PASSWORD are required');
  const passwordHash = await bcrypt.hash(password, 12);
  const users = {};
  for (const [key, username] of [['viewer', 'operations_e2e_viewer'], ['outsider', 'operations_e2e_outsider'], ['operator', 'maintenance_e2e_operator'], ['replacement', 'maintenance_e2e_replacement'], ['engineer', 'maintenance_e2e_engineer'], ['incidentEngineer', 'incidents_e2e_engineer'], ['incidentOperator', 'incidents_e2e_operator']]) {
    users[key] = await prisma.user.create({ data: {
      username,
      fullName: `Operations E2E ${key}`,
      email: `${username}@example.test`,
      passwordHash,
      role: ['engineer', 'incidentEngineer'].includes(key) ? 'ENGINEER' : ['operator', 'replacement', 'incidentOperator'].includes(key) ? 'OPERATOR' : 'VIEWER',
      active: true,
    }, select: { id: true, username: true, role: true } });
  }
  // Incident flow gets its own canonical factory so the Operations and Incident
  // suites cannot depend on one another's published head or case ordering.
  const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');
  const snapshot = structuredClone(require('../../../contracts/v3/fixtures/demo-health-alert.json').factory_snapshot);
  snapshot.factory_id = 'factory-incident-demo';
  snapshot.current_schedule.factory_id = snapshot.factory_id;
  await prisma.factory.create({ data: { factoryId: snapshot.factory_id, name: 'Incident integration factory' } });
  await ingestFactorySnapshot({ factoryId: snapshot.factory_id, expectedHeadRevision: 0, snapshot, sourceId: 'incident-browser-seed' }, prisma);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(users, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
