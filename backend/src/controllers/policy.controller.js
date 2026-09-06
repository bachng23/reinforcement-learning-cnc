const prisma = require('../config/prisma');
const { policyToDto } = require('../serializers/research.serializer');

const listPolicies = async (_req, res) => {
  const policies = await prisma.policy.findMany({
    where: { active: true },
    orderBy: [{ policyKey: 'asc' }, { version: 'asc' }, { id: 'asc' }],
  });

  res.json({
    success: true,
    data: policies.map(policyToDto),
    meta: { total: policies.length },
  });
};

module.exports = { listPolicies };
