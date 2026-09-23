const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (!process.argv.includes('--cleanup')) require('dotenv').config({ quiet: true });

const backendRoot = path.resolve(__dirname, '../..');
const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');
const jestCli = path.join(backendRoot, 'node_modules', 'jest', 'bin', 'jest.js');
const journalPath = process.env.OPERATIONS_SCHEMA_JOURNAL;
const schemaPattern = /^product_api_it_[a-zA-Z0-9_]+$/;
const targetHash = (url) => createHash('sha256').update(url.toString()).digest('hex');
const readJournal = () => journalPath && fs.existsSync(journalPath)
  ? fs.readFileSync(journalPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const forgetSchema = (schema) => {
  if (journalPath) fs.writeFileSync(journalPath, readJournal().filter(entry => entry.schema !== schema).map(entry => JSON.stringify(entry) + '\n').join(''));
};

const fail = (message) => {
  console.error(`[integration] ${message}`);
  process.exitCode = 1;
};

const parseTestDatabaseUrl = () => {
  const rawUrl = process.env.TEST_DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      'TEST_DATABASE_URL is required (example: postgresql://user:password@localhost:5432/cnc_research_test)',
    );
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('TEST_DATABASE_URL must use the postgres:// or postgresql:// protocol');
  }
  if (!url.pathname || url.pathname === '/') {
    throw new Error('TEST_DATABASE_URL must name a database');
  }
  return url;
};

const run = (command, args, { env, input, cwd = backendRoot } = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: 'utf8',
    stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
  });

  if (result.error) throw result.error;
  return result.status ?? 1;
};

const main = () => {
  const baseUrl = parseTestDatabaseUrl();
  const schema = `product_api_it_${process.pid}_${randomBytes(6).toString('hex')}`;
  const isolatedUrl = new URL(baseUrl.toString());
  isolatedUrl.searchParams.set('schema', schema);

  const sharedEnv = {
    ...process.env,
    NODE_ENV: 'test',
    JWT_SECRET: process.env.JWT_SECRET || 'integration-test-secret-at-least-32-characters',
  };
  const testEnv = { ...sharedEnv, DATABASE_URL: isolatedUrl.toString() };
  const cleanupEnv = { ...sharedEnv, DATABASE_URL: baseUrl.toString() };

  // Persist ownership before any DDL so a workflow always() step can recover
  // after interruption. Never sweep schemas belonging to other local/CI runs.
  if (journalPath) {
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    fs.appendFileSync(journalPath, JSON.stringify({ schema, target: targetHash(baseUrl) }) + '\n');
  }

  console.log(`[integration] Creating isolated PostgreSQL schema ${schema}`);
  let testStatus = 1;
  let cleanupFailed = false;
  try {
    const generateStatus = run(
      process.execPath,
      [prismaCli, 'generate', '--schema', 'prisma/schema.prisma'],
      { env: testEnv },
    );
    if (generateStatus !== 0) {
      throw new Error(`Prisma client generation failed with exit code ${generateStatus}`);
    }

    const migrationStatus = run(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      { env: testEnv },
    );
    if (migrationStatus !== 0) {
      throw new Error(`Prisma migrations failed with exit code ${migrationStatus}`);
    }

    if (process.argv.includes('--operations-flow')) {
      const frontendRoot = path.resolve(backendRoot, '../frontend');
      testStatus = run(process.execPath, [path.join(frontendRoot, 'node_modules/vitest/vitest.mjs'),
        'run', '--config', 'vitest.operations.config.ts'], { env: testEnv, cwd: frontendRoot });
    } else testStatus = run(
      process.execPath,
      [jestCli, '--config', 'jest.integration.config.js', '--runInBand'],
      { env: testEnv },
    );
  } finally {
    if (!schemaPattern.test(schema)) {
      throw new Error('Refusing to clean an unexpected integration-test schema name');
    }

    console.log(`[integration] Dropping isolated PostgreSQL schema ${schema}`);
    const cleanupStatus = run(
      process.execPath,
      [prismaCli, 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'],
      {
        env: cleanupEnv,
        input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE;\n`,
      },
    );
    if (cleanupStatus !== 0) {
      fail(`Schema cleanup failed with exit code ${cleanupStatus}`);
      cleanupFailed = true;
    } else {
      forgetSchema(schema);
    }
  }

  process.exitCode = cleanupFailed ? 1 : testStatus;
};

function cleanupJournal() {
  const entries = readJournal();
  if (!entries.length) return;
  const baseUrl = parseTestDatabaseUrl();
  // Validate the entire journal before touching the explicitly supplied target.
  if (entries.some(entry => !schemaPattern.test(entry.schema) || entry.target !== targetHash(baseUrl))) {
    throw new Error('Refusing cleanup: journal schema or explicit test database does not match');
  }
  const failures = [];
  for (const { schema } of entries) {
    console.log(`[integration] Cleaning recorded schema ${schema}`);
    try {
      const status = run(process.execPath, [prismaCli, 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], {
        env: { ...process.env, DATABASE_URL: baseUrl.toString() },
        input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE;\n`,
      });
      if (status !== 0) throw new Error(`Schema cleanup failed with exit code ${status}`);
      forgetSchema(schema);
    } catch (error) { failures.push(`${schema}: ${error.message}`); }
  }
  if (failures.length) throw new Error(failures.join('\n'));
}

try {
  if (process.argv.includes('--cleanup')) cleanupJournal();
  else main();
} catch (error) {
  fail(error.message);
}
