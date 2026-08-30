require('dotenv').config();
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD is required; refusing to seed a default password');
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
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

  console.log(`Seeded platform administrator: ${admin.username}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
