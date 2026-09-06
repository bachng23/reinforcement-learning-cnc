require('dotenv').config();
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const BUILT_IN_POLICIES = [
  {
    policyKey: 'fixed-schedule',
    version: '1.0.0',
    name: 'Fixed Schedule Baseline',
    description: 'Deterministic replacement schedule for baseline experiment comparisons.',
    configJson: {
      strategy: 'FIXED_SCHEDULE',
      replacement_interval_steps: 50,
    },
  },
  {
    policyKey: 'threshold-uncertainty',
    version: '1.0.0',
    name: 'Uncertainty-Aware Threshold',
    description: 'Uses observable posterior uncertainty to recommend continue or replace actions.',
    configJson: {
      strategy: 'THRESHOLD_UNCERTAINTY',
      decision_signal: 'POSTERIOR_RUL',
    },
  },
  {
    policyKey: 'shared-spare-priority',
    version: '1.0.0',
    name: 'Shared Spare Priority',
    description: 'Prioritizes the most urgent observable replacement need when spares are constrained.',
    configJson: {
      strategy: 'SHARED_SPARE_PRIORITY',
      priority_signal: 'LOWEST_EXPECTED_RUL',
    },
  },
];

async function main({ client = prisma, hashPassword = bcrypt.hash, logger = console } = {}) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD is required; refusing to seed a default password');
  }

  const passwordHash = await hashPassword(adminPassword, 12);
  const admin = await client.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash, active: true, role: 'ADMIN' },
    create: {
      username: 'admin',
      fullName: 'System Administrator',
      email: 'admin@example.com',
      passwordHash,
      role: 'ADMIN',
      active: true,
    },
  });

  const policies = [];
  for (const policy of BUILT_IN_POLICIES) {
    const seededPolicy = await client.policy.upsert({
      where: {
        policyKey_version: {
          policyKey: policy.policyKey,
          version: policy.version,
        },
      },
      update: {
        name: policy.name,
        description: policy.description,
        configJson: policy.configJson,
        active: true,
      },
      create: {
        ...policy,
        active: true,
      },
    });
    policies.push(seededPolicy);
  }

  logger.log(`Seeded platform administrator: ${admin.username}`);
  logger.log(`Seeded ${policies.length} active research policies.`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { BUILT_IN_POLICIES, main };
