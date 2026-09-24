const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { randomBytes, createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { testDatabase, command } = require('../../../scripts/check-migration-paths');
const { pythonExecutable } = require('../../src/services/operations-contract.service');

const root = path.resolve(__dirname, '../..');
const prisma = path.join(root, 'node_modules/prisma/build/index.js');

async function main() {
  const url = testDatabase(); // Never loads .env or falls back to a dev database.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-planning-'));
  const journal = process.env.OPERATIONS_SCHEMA_JOURNAL || path.join(temporary, 'schemas.jsonl');
  const schema = `product_api_it_planning_${process.pid}_${randomBytes(6).toString('hex')}`;
  const isolated = new URL(url);
  isolated.searchParams.set('schema', schema);
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: isolated.toString(),
    JWT_SECRET: 'planning-integration-test-only-secret', OPERATIONS_FACTORY_ACCESS: '{}' };
  const controller = new AbortController();
  const lifecycleProbe = process.argv.includes('--lifecycle-probe');
  const abort = () => {
    controller.abort();
    // A resumed stdin pipe keeps Node alive on POSIX after SIGTERM. Release it
    // here so the probe can finish cleanup and the parent can observe exit.
    if (lifecycleProbe) process.stdin.pause();
  };
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  // Test probes can exercise graceful interruption on Windows via pipe EOF.
  if (lifecycleProbe) { process.stdin.resume(); process.stdin.once('end', abort); }
  let child, closed, lines, recorded = false;
  const errors = [];
  console.log(`[planning integration] schema=${schema}; journal=${journal}`);
  try {
    fs.mkdirSync(path.dirname(journal), { recursive: true });
    fs.appendFileSync(journal, JSON.stringify({ schema,
      target: createHash('sha256').update(url.toString()).digest('hex') }) + '\n');
    recorded = true;
    const setup = lifecycleProbe ? [['migrate', 'deploy']] : [['generate'], ['migrate', 'deploy']];
    for (const args of setup) {
      await command([prisma, ...args, '--schema', 'prisma/schema.prisma'],
        { cwd: root, env, signal: controller.signal });
    }
    controller.signal.throwIfAborted();
    child = spawn(pythonExecutable(), [path.join(root, 'tests/helpers/serve-planning.py')], {
      cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {});
    child.stderr.on('data', data => process.stderr.write(data));
    closed = new Promise(resolve => child.once('close', resolve));
    let childError;
    child.on('error', error => { childError = error; });
    const portReady = new Promise((resolve, reject) => {
      lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        try {
          const info = JSON.parse(line);
          if (Number.isInteger(info.port) && info.port > 0 && info.port <= 65535) resolve(info.port);
        } catch { /* only readiness JSON is consumed */ }
      });
      child.once('close', () => reject(childError || new Error('FastAPI exited before readiness')));
    });
    const startup = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    const waitForStartupAbort = new Promise((_, reject) => startup.addEventListener('abort', () => reject(startup.reason), { once: true }));
    const port = await Promise.race([portReady, waitForStartupAbort]);
    env.AI_SERVICE_URL = `http://127.0.0.1:${port}`;
    while (true) {
      startup.throwIfAborted();
      try {
        const response = await fetch(`${env.AI_SERVICE_URL}/health`, { signal: startup });
        if (response.ok) { await response.arrayBuffer(); break; }
        await response.body?.cancel();
      } catch (error) { if (startup.aborted) throw error; }
      await delay(50, undefined, { signal: startup });
    }
    console.log(`[planning integration] FastAPI ready: ${env.AI_SERVICE_URL}`);
    if (lifecycleProbe) {
      await delay(60000, undefined, { signal: controller.signal });
    } else {
      await command([path.join(root, 'node_modules/jest/bin/jest.js'), '--config',
        'tests/planning/jest.config.js', '--runInBand'], { cwd: root, env, signal: controller.signal });
    }
  } catch (error) { errors.push(error); }
  finally {
    if (child) {
      child.stdin.end(); // Parent-pipe watchdog owns process/port lifetime.
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await closed;
      clearTimeout(timer);
      lines?.close();
      console.log('[planning integration] FastAPI stopped');
    }
    if (recorded) {
      try {
        await command([prisma, 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], {
          cwd: root, env: { ...env, DATABASE_URL: url.toString() },
          input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE;\n`,
        });
        const entries = fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
        fs.writeFileSync(journal, entries.filter(entry => entry.schema !== schema).map(entry => JSON.stringify(entry) + '\n').join(''));
        console.log(`[planning integration] Dropped ${schema}`);
      } catch (error) { errors.push(error); }
    }
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    if (lifecycleProbe) {
      process.stdin.removeListener('end', abort);
      process.stdin.pause();
    }
    if (!recorded || !fs.readFileSync(journal, 'utf8').trim() || !journal.startsWith(temporary + path.sep)) {
      await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
  if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('\n'));
}
main().catch(error => { console.error(`[planning integration] ${error.message}`); process.exitCode = 1; });
