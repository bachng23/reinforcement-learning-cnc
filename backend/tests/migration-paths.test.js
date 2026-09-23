const fs = require('node:fs');
const path = require('node:path');
const { checkHistory } = require('../../scripts/check-migration-history');
const { checkPaths, testDatabase, command } = require('../../scripts/check-migration-paths');
const { migrationRepository } = require('./helpers/migration-repository');

const databaseUrl = 'postgresql://test:test@localhost:5432/operations_test?schema=public';
let repo;
beforeEach(() => { repo = migrationRepository(); });
afterEach(() => repo.dispose());

test('accepts new migrations and schema changes without modifying old history', () => {
  repo.write('schema.prisma', 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n// candidate schema\n');
  repo.write('migrations/20260102000000_new/migration.sql', 'ALTER TABLE example ADD COLUMN new_column TEXT;');
  repo.commit();
  expect(checkHistory({ root: repo.root, base: repo.base }).baseSha).toBe(repo.base);
});

test.each(['modify', 'delete', 'rename', 'add-to-existing', 'lock'])('rejects %s of existing migration with the offending path', operation => {
  const migration = 'backend/prisma/migrations/20260101000000_initial/migration.sql';
  const absolute = path.join(repo.root, migration);
  let expected = migration;
  if (operation === 'modify') fs.appendFileSync(absolute, '-- edited');
  if (operation === 'delete') fs.unlinkSync(absolute);
  if (operation === 'rename') fs.renameSync(absolute, absolute + '.renamed');
  if (operation === 'add-to-existing') {
    repo.write('migrations/20260101000000_initial/extra.sql', '-- changed migration directory');
    expected = 'backend/prisma/migrations/20260101000000_initial/extra.sql';
  }
  if (operation === 'lock') {
    repo.write('migrations/migration_lock.toml', 'provider = "mysql"');
    expected = 'backend/prisma/migrations/migration_lock.toml';
  }
  repo.commit();
  expect(() => checkHistory({ root: repo.root, base: repo.base })).toThrow(expected);
  expect(() => checkHistory({ root: repo.root, base: repo.base })).toThrow('immutable');
});

test('requires an explicit available base SHA and never silently uses HEAD/main', () => {
  for (const base of ['', 'main', 'HEAD', '0'.repeat(40)]) {
    expect(() => checkHistory({ root: repo.root, base })).toThrow();
  }
});

test.each([undefined, 'postgresql://test:test@localhost:5432/development',
  'postgresql://test:test@localhost:5432/operations', 'https://localhost/operations_test'])('rejects non-test database %s', url => {
  const previous = process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
  try { expect(() => testDatabase(url)).toThrow(); }
  finally { if (previous !== undefined) process.env.TEST_DATABASE_URL = previous; }
});

function options(run, signal) {
  return { history: checkHistory({ root: repo.root, base: repo.base }), databaseUrl,
    journalPath: path.join(repo.root, 'journal.jsonl'), run, signal, log: () => {} };
}

test('fresh candidate, base then candidate use two schemas and the actual Git snapshots', async () => {
  repo.write('migrations/20260102000000_new/migration.sql', 'ALTER TABLE example ADD COLUMN new_column TEXT;');
  repo.commit();
  const calls = [];
  const settings = options(async (args, context) => {
    const journal = fs.readFileSync(settings.journalPath, 'utf8');
    if (calls.length === 0) expect(journal.trim().split('\n')).toHaveLength(2);
    expect(journal).not.toContain('postgresql://');
    const schemaFile = args[args.indexOf('--schema') + 1];
    const migrations = fs.readdirSync(path.join(path.dirname(schemaFile), 'migrations'));
    calls.push({ args, context, migrations });
  });
  await checkPaths(settings);
  expect(calls.slice(0, 3).map(call => call.args.slice(1, 3))).toEqual([
    ['migrate', 'deploy'], ['migrate', 'deploy'], ['migrate', 'deploy'],
  ]);
  expect(calls.slice(0, 3).map(call => call.migrations.includes('20260102000000_new'))).toEqual([true, false, true]);
  const urls = calls.slice(0, 3).map(call => new URL(call.context.env.DATABASE_URL));
  expect(urls[0].searchParams.get('schema')).not.toBe(urls[1].searchParams.get('schema'));
  expect(urls[1].toString()).toBe(urls[2].toString());
  expect(calls.slice(3).map(call => call.context.input)).toEqual(urls.slice(0, 2)
    .map(url => `DROP SCHEMA IF EXISTS "${url.searchParams.get('schema')}" CASCADE;\n`));
  expect(fs.readFileSync(settings.journalPath, 'utf8')).toBe('');
});

test.each([0, 1, 2])('cleans both schemas on failure of deployment %i', async phase => {
  let deployment = 0;
  const run = jest.fn(async args => {
    if (args.includes('deploy') && deployment++ === phase) throw new Error('database rejected migration');
  });
  const settings = options(run);
  await expect(checkPaths(settings)).rejects.toThrow('failed: database rejected migration');
  expect(run.mock.calls.filter(([args]) => args.includes('execute'))).toHaveLength(2);
  expect(fs.readFileSync(settings.journalPath, 'utf8')).toBe('');
});

test('aborting an active deployment still cleans both schemas without an aborted signal', async () => {
  const controller = new AbortController();
  const run = jest.fn(async (args, context) => {
    if (args.includes('deploy')) {
      controller.abort();
      context.signal.throwIfAborted();
    } else expect(context.signal).toBeUndefined();
  });
  const settings = options(run, controller.signal);
  await expect(checkPaths(settings)).rejects.toThrow();
  expect(run.mock.calls.filter(([args]) => args.includes('execute'))).toHaveLength(2);
  expect(fs.readFileSync(settings.journalPath, 'utf8')).toBe('');
});

test('cleanup failure retains ownership for fallback but still attempts the other schema', async () => {
  let cleanup = 0;
  const settings = options(async args => {
    if (args.includes('execute') && cleanup++ === 0) throw new Error('connection interrupted');
  });
  await expect(checkPaths(settings)).rejects.toThrow('Cleanup product_api_it_fresh_');
  expect(cleanup).toBe(2);
  const entries = fs.readFileSync(settings.journalPath, 'utf8').trim().split('\n').map(JSON.parse);
  expect(entries).toHaveLength(1);
  expect(entries[0].schema).toMatch(/^product_api_it_fresh_/);
});

test('interrupting a real subprocess waits for termination before rejecting', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await expect(command(['-e', 'setInterval(() => {}, 1000)'], {
      cwd: repo.root, env: process.env, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  } finally { clearTimeout(timer); }
});

test('workflow uses event base SHA, fetches history and always retries cleanup', () => {
  const yaml = require('js-yaml');
  const workflow = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/operations-integration.yml'), 'utf8'));
  const job = workflow.jobs['operations-integration'];
  expect(job.env.MIGRATION_BASE_SHA).toBe('${{ github.event.pull_request.base.sha || github.event.before }}');
  expect(job.steps.find(step => step.uses?.startsWith('actions/checkout@')).with['fetch-depth']).toBe(0);
  expect(job.steps.find(step => step.run?.includes('run-integration-tests.js --cleanup')).if).toBe('${{ always() }}');
});
