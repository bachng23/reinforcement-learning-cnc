require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
async function main() {
  const target = process.argv[2];
  if (!target || process.argv.length !== 3 || !process.env.DATABASE_URL)
    throw new Error('Explicit DATABASE_URL and output filename required');
  const db = new PrismaClient();
  try {
    const rows = await db.factoryMembership.findMany({
      where: { active: true },
      orderBy: [{ factoryId: 'asc' }, { userId: 'asc' }],
      select: { factoryId: true, userId: true },
    });
    const map = Object.create(null);
    for (const r of rows) (map[r.factoryId] ??= []).push(r.userId);
    fs.writeFileSync(target, JSON.stringify(map, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(
      JSON.stringify({ exported: true, factories: Object.keys(map).length, memberships: rows.length }),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error('FACTORY_ACCESS_EXPORT_FAILED: explicit database and new output path required');
  process.exitCode = 1;
});
