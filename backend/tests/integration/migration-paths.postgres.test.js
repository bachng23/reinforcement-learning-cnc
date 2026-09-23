const { PrismaClient } = require('@prisma/client');
const { checkHistory } = require('../../../scripts/check-migration-history');
const { checkPaths, command } = require('../../../scripts/check-migration-paths');
const { migrationRepository } = require('../helpers/migration-repository');

// Real PostgreSQL regression for the fresh-pass/upgrade-fail class of bug.
// Histories are synthetic repositories, not edits to business migrations.
describe('migration gate on PostgreSQL', () => {
  jest.setTimeout(90_000);
  let repo;
  const db = new PrismaClient();
  beforeEach(() => { repo = migrationRepository(); });
  afterEach(() => repo.dispose());
  afterAll(async () => db.$disconnect());

  async function exercise(history, expectedFailure) {
    const messages = [];
    const failureLogs = [];
    const promise = checkPaths({ history, log: message => messages.push(message),
      run: async (args, context) => {
        try { await command(args, context); }
        catch (error) {
          if (args.includes('deploy')) {
            const schema = new URL(context.env.DATABASE_URL).searchParams.get('schema');
            if (!/^product_api_it_(fresh|upgrade)_\w+$/.test(schema)) throw new Error('Unexpected test schema');
            const rows = await db.$queryRawUnsafe(`SELECT logs FROM "${schema}"._prisma_migrations WHERE finished_at IS NULL`);
            failureLogs.push(...rows.map(row => row.logs));
          }
          throw error;
        }
      },
    });
    if (expectedFailure) await expect(promise).rejects.toThrow(expectedFailure);
    else await promise;
    const schemas = messages.filter(message => message.startsWith('[migration paths] Dropping '))
      .map(message => message.split(' ').at(-1));
    expect(schemas).toHaveLength(2);
    const remaining = await db.$queryRaw`SELECT schema_name FROM information_schema.schemata
      WHERE schema_name IN (${schemas[0]}, ${schemas[1]})`;
    expect(remaining).toEqual([]);
    if (expectedFailure) expect(failureLogs.join('\n')).toContain('column "existing_column" of relation "example" already exists');
    return messages;
  }

  test('append-only migration passes fresh and upgrade', async () => {
    repo.write('migrations/20260102000000_new/migration.sql', 'ALTER TABLE example ADD COLUMN new_column TEXT;');
    repo.commit();
    const messages = await exercise(checkHistory({ root: repo.root, base: repo.base }));
    expect(messages).toContain('[migration paths] PASS: fresh candidate');
    expect(messages).toContain('[migration paths] PASS: upgrade candidate');
  });

  test('rewriting an old migration then re-adding its column passes fresh but fails upgrade', async () => {
    repo.write('migrations/20260101000000_initial/migration.sql', 'CREATE TABLE example (id INTEGER PRIMARY KEY);');
    repo.write('migrations/20260102000000_duplicate/migration.sql', 'ALTER TABLE example ADD COLUMN existing_column TEXT;');
    repo.commit();
    expect(() => checkHistory({ root: repo.root, base: repo.base }))
      .toThrow('modified: backend/prisma/migrations/20260101000000_initial/migration.sql');
    // Test the DB layer independently of the history precheck, which would
    // already reject this candidate in the production gate.
    const messages = await exercise(repo.history(), 'upgrade candidate failed');
    expect(messages).toContain('[migration paths] PASS: fresh candidate');
    expect(messages).toContain('[migration paths] PASS: upgrade base');
    expect(messages).not.toContain('[migration paths] PASS: upgrade candidate');
  });
});
