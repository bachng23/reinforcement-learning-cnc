const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ quiet: true });

const backendRoot = path.resolve(__dirname, '../..');
const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');
const jestCli = path.join(backendRoot, 'node_modules', 'jest', 'bin', 'jest.js');

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

const run = (command, args, { env, input } = {}) => {
  const result = spawnSync(command, args, {
    cwd: backendRoot,
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

    testStatus = run(
      process.execPath,
      [jestCli, '--config', 'jest.integration.config.js', '--runInBand'],
      { env: testEnv },
    );
  } finally {
    if (!/^product_api_it_[a-zA-Z0-9_]+$/.test(schema)) {
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
    }
  }

  process.exitCode = cleanupFailed ? 1 : testStatus;
};

try {
  main();
} catch (error) {
  fail(error.message);
}
