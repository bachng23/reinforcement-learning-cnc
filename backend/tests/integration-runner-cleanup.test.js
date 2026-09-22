const { createHash } = require('node:crypto');
const path = require('node:path');

const databaseUrl = 'postgresql://test:test@localhost:5432/operations_test?schema=public';
const journal = path.resolve(__dirname, 'test-schema-journal.jsonl');
const schema = 'product_api_it_123_abc';
const target = createHash('sha256').update(databaseUrl).digest('hex');
const originalEnv = { ...process.env };
const originalArgv = process.argv;
let files, spawnSync;

beforeEach(() => {
  jest.resetModules();
  files = new Map();
  spawnSync = jest.fn(() => ({ status: 0 }));
  process.env.TEST_DATABASE_URL = databaseUrl;
  process.env.OPERATIONS_SCHEMA_JOURNAL = journal;
  process.argv = ['node', 'run-integration-tests.js'];
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.doMock('node:child_process', () => ({ spawnSync }));
  jest.doMock('dotenv', () => ({ config: jest.fn() }));
  jest.doMock('node:fs', () => ({
    existsSync: file => files.has(file),
    readFileSync: file => files.get(file),
    writeFileSync: (file, data) => files.set(file, data),
    appendFileSync: (file, data) => files.set(file, (files.get(file) || '') + data),
    mkdirSync: jest.fn(),
  }));
});
afterEach(() => {
  process.env = { ...originalEnv };
  process.argv = originalArgv;
  process.exitCode = 0;
  jest.restoreAllMocks();
  jest.dontMock('node:child_process');
  jest.dontMock('node:fs');
  jest.dontMock('dotenv');
});
const run = () => require('./integration/run-integration-tests');
const record = (entry = { schema, target }) => files.set(journal, JSON.stringify(entry) + '\n');

test.each(['migration', 'tests'])('cleans the recorded schema after %s failure and keeps a failing exit code', phase => {
  spawnSync.mockImplementation((_command, args) => ({ status: args.includes(phase === 'migration' ? 'deploy' : '--runInBand') ? 1 : 0 }));
  run();
  expect(process.exitCode).toBe(1);
  const cleanup = spawnSync.mock.calls.find(([, args]) => args.includes('execute'));
  expect(cleanup[2].input).toMatch(/^DROP SCHEMA IF EXISTS "product_api_it_\w+" CASCADE;\n$/);
  expect(cleanup[2].env.DATABASE_URL).toBe(databaseUrl);
  expect(files.get(journal)).toBe('');
});

test('records schema before migration and retains it when cleanup fails', () => {
  spawnSync.mockImplementation((_command, args) => {
    expect(files.get(journal)).toContain('product_api_it_');
    return { status: args.includes('execute') ? 1 : 0 };
  });
  run();
  expect(process.exitCode).toBe(1);
  expect(JSON.parse(files.get(journal)).target).toBe(target);
  expect(files.get(journal)).not.toContain('postgresql://');
});

test('fallback cleanup retries only this journal and is idempotent', () => {
  process.argv.push('--cleanup');
  record();
  run();
  expect(spawnSync).toHaveBeenCalledTimes(1);
  expect(spawnSync.mock.calls[0][2].input).toBe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;\n`);
  expect(files.get(journal)).toBe('');
  jest.resetModules();
  run();
  expect(spawnSync).toHaveBeenCalledTimes(1);
});

test.each([
  { schema: 'public', target },
  { schema: 'product_api_it_x"; DROP DATABASE operations_test; --', target },
  { schema, target: 'wrong-database' },
])('rejects unsafe or mismatched cleanup journal: %j', entry => {
  process.argv.push('--cleanup');
  record(entry);
  run();
  expect(process.exitCode).toBe(1);
  expect(spawnSync).not.toHaveBeenCalled();
  expect(files.get(journal)).toBeTruthy();
});

test('missing journal is a no-op, including before dependency installation', () => {
  process.argv.push('--cleanup');
  delete process.env.TEST_DATABASE_URL;
  run();
  expect(spawnSync).not.toHaveBeenCalled();
});
