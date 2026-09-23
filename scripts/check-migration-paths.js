const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const { checkHistory, git, repoRoot } = require('./check-migration-history');

function testDatabase(raw = process.env.TEST_DATABASE_URL) {
  if (!raw) throw new Error('TEST_DATABASE_URL is required; DATABASE_URL is never used as a fallback');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !/_(test|ci)$/.test(decodeURIComponent(url.pathname))) {
    throw new Error('TEST_DATABASE_URL must name a dedicated PostgreSQL database ending in _test or _ci');
  }
  return url;
}

function materialize(history, files, destination) {
  for (const file of files) {
    const relative = file.name.slice('backend/prisma/'.length);
    const target = path.resolve(destination, relative);
    if (!target.startsWith(destination + path.sep)) throw new Error('Unsafe Prisma file path');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, git(history.root, ['cat-file', 'blob', file.oid]));
  }
}

// Async subprocesses let SIGINT/SIGTERM terminate the active migration before
// finally drops schemas. A journal also covers SIGKILL/runner termination.
function command(args, { env, input, signal, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, signal,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'] });
    let failure;
    child.on('error', error => { failure = error; });
    child.on('close', (code, killedBy) => {
      if (failure || code !== 0) reject(failure || new Error(`Prisma exited with ${killedBy || code}`));
      else resolve();
    });
    if (input !== undefined) {
      child.stdin.on('error', () => {}); // EPIPE is reported by the child exit.
      child.stdin.end(input);
    }
  });
}

async function checkPaths({ history, databaseUrl, journalPath, run = command,
  signal, log = console.log } = {}) {
  const baseUrl = testDatabase(databaseUrl);
  history ||= checkHistory();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-migrations-'));
  journalPath ||= process.env.OPERATIONS_SCHEMA_JOURNAL || path.join(temporary, 'schemas.jsonl');
  const suffix = `${process.pid}_${randomBytes(6).toString('hex')}`;
  const schemas = [`product_api_it_fresh_${suffix}`, `product_api_it_upgrade_${suffix}`];
  const target = createHash('sha256').update(baseUrl.toString()).digest('hex');
  const cli = path.join(repoRoot, 'backend/node_modules/prisma/build/index.js');
  const candidateDir = path.join(temporary, 'candidate');
  const baseDir = path.join(temporary, 'base');
  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: baseUrl.toString() };
  const errors = [];
  const forget = schema => fs.writeFileSync(journalPath,
    fs.readFileSync(journalPath, 'utf8').split('\n').filter(Boolean)
      .map(line => JSON.parse(line)).filter(entry => entry.schema !== schema)
      .map(entry => JSON.stringify(entry) + '\n').join(''));
  let recorded = false;
  log(`[migration paths] base=${history.baseSha} candidate=${history.candidateSha}`);
  log(`[migration paths] Cleanup journal: ${journalPath}`);
  try {
    materialize(history, history.baseFiles, baseDir);
    materialize(history, history.candidateFiles, candidateDir);
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    // Record BOTH names before the first DDL; fallback cleanup shares the
    // existing integration runner's prefix, target hash and journal format.
    fs.appendFileSync(journalPath, schemas.map(schema => JSON.stringify({ schema, target }) + '\n').join(''));
    recorded = true;
    const deploy = async (label, directory, schema) => {
      signal?.throwIfAborted();
      const url = new URL(baseUrl);
      url.searchParams.set('schema', schema);
      log(`[migration paths] ${label}: ${schema}`);
      try {
        await run([cli, 'migrate', 'deploy', '--schema', path.join(directory, 'schema.prisma')],
          { cwd: temporary, env: { ...env, DATABASE_URL: url.toString() }, signal });
      } catch (error) { throw new Error(`${label} failed: ${error.message}`); }
      log(`[migration paths] PASS: ${label}`);
    };
    // Prisma deploy creates each selected empty schema. It then uses the same
    // _prisma_migrations history for base -> candidate, with no reset/db push.
    await deploy('fresh candidate', candidateDir, schemas[0]);
    await deploy('upgrade base', baseDir, schemas[1]);
    await deploy('upgrade candidate', candidateDir, schemas[1]);
    signal?.throwIfAborted();
  } catch (error) { errors.push(error); }
  finally {
    if (recorded) {
      for (const schema of schemas) {
        try {
          log(`[migration paths] Dropping ${schema}`);
          // Never reuse the aborted signal during cleanup. Attempt both even
          // when dropping the first fails; retain failed entries for retry.
          await run([cli, 'db', 'execute', '--stdin', '--schema', path.join(candidateDir, 'schema.prisma')], {
            cwd: temporary, env, input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE;\n`,
          });
          forget(schema);
        } catch (error) { errors.push(new Error(`Cleanup ${schema} failed: ${error.message}`)); }
      }
    }
    // Preserve a local fallback journal if connectivity prevented cleanup.
    if (!recorded || !fs.readFileSync(journalPath, 'utf8').trim() || !journalPath.startsWith(temporary + path.sep)) {
      try {
        await fs.promises.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch (error) { errors.push(new Error(`Temporary files cleanup failed: ${error.message}`)); }
    }
  }
  if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('\n'));
}

if (require.main === module) {
  const controller = new AbortController();
  let interrupted;
  const stop = signal => { interrupted ||= signal; controller.abort(); };
  const onInt = () => stop('SIGINT');
  const onTerm = () => stop('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  checkPaths({ signal: controller.signal }).catch(error => {
    console.error(`[migration paths] ${error.message}`);
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    if (interrupted) process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
  });
}
module.exports = { checkPaths, testDatabase, command };
