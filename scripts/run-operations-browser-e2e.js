#!/usr/bin/env node
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');
const { deepStrictEqual, strictEqual } = require('node:assert');

const root = path.resolve(__dirname, '..');
const backendRoot = path.join(root, 'backend');
const frontendRoot = path.join(root, 'frontend');
const aiRoot = path.join(root, 'ai_services');
const prisma = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');
const next = path.join(frontendRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const playwright = path.join(frontendRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const schemaPattern = /^product_api_it_browser_[a-zA-Z0-9_]+$/;
const children = new Set();
const controller = new AbortController();
let interruptedSignal = 0;

function onInterrupt(code) {
  return () => {
    interruptedSignal ||= code;
    controller.abort(new Error(`Interrupted by signal ${code}`));
  };
}
const onSigint = onInterrupt(130);
const onSigterm = onInterrupt(143);
process.on('SIGINT', onSigint);
process.on('SIGTERM', onSigterm);

function testDatabase() {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL is required');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !/_(test|ci)$/.test(decodeURIComponent(url.pathname))) {
    throw new Error('TEST_DATABASE_URL must name a dedicated PostgreSQL database ending in _test or _ci');
  }
  return url;
}

function gitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Could not determine the current Git SHA');
  return result.stdout.trim();
}

function repeatCount() {
  const argument = process.argv.find(value => value.startsWith('--repeat='));
  const value = Number(argument?.slice('--repeat='.length) || process.env.OPERATIONS_E2E_REPEAT || 1);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10) {
    throw new Error('--repeat must be an integer between 1 and 10');
  }
  return value;
}

function journalEntries(journal) {
  if (!fs.existsSync(journal)) return [];
  return fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function appendJournal(journal, entry) {
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  fs.appendFileSync(journal, `${JSON.stringify(entry)}\n`);
}

function forgetSchema(journal, schema) {
  if (!fs.existsSync(journal)) return;
  const remaining = journalEntries(journal).filter(entry => entry.schema !== schema);
  fs.writeFileSync(journal, remaining.map(entry => `${JSON.stringify(entry)}\n`).join(''));
}

function tee(stream, destination, consoleStream) {
  stream.on('data', chunk => {
    destination.write(chunk);
    consoleStream.write(chunk);
  });
}

async function command(commandName, args, {
  cwd = root,
  env = process.env,
  input,
  logFile,
  signal = controller.signal,
  treeOnAbort = false,
} = {}) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const options = {
    cwd,
    env,
    windowsHide: true,
    detached: treeOnAbort && process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  };
  if (signal && !treeOnAbort) options.signal = signal;
  const child = spawn(commandName, args, options);
  const abortTree = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  };
  if (signal && treeOnAbort) {
    if (signal.aborted) abortTree();
    else signal.addEventListener('abort', abortTree, { once: true });
  }
  tee(child.stdout, log, process.stdout);
  tee(child.stderr, log, process.stderr);
  if (input === undefined) child.stdin.end();
  else child.stdin.end(input);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (code !== 0) throw new Error(`${commandName} ${args.join(' ')} exited with code ${code}`);
  } finally {
    signal?.removeEventListener('abort', abortTree);
    await new Promise(resolve => log.end(resolve));
  }
}

function startProcess(name, commandName, args, { cwd, env, logFile, stdin = 'ignore' }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const child = spawn(commandName, args, {
    cwd,
    env,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: [stdin, 'pipe', 'pipe'],
  });
  console.log(`[operations browser e2e] started ${name} pid=${child.pid}`);
  child.e2eName = name;
  child.e2eLog = log;
  tee(child.stdout, log, process.stdout);
  tee(child.stderr, log, process.stderr);
  children.add(child);
  child.once('close', () => children.delete(child));
  return child;
}

async function stopProcess(child) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    if (child.e2eName === 'fastapi' && child.stdin?.writable) child.stdin.end();
    else if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    const closed = new Promise(resolve => child.once('close', resolve));
    const graceful = await Promise.race([closed.then(() => true), delay(5_000).then(() => false)]);
    if (!graceful && child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        const killed = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
        if (killed.error || killed.status !== 0) throw new Error(`Cannot stop owned ${child.e2eName} PID ${child.pid}; cleanup needs process termination permission`);
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      await Promise.race([closed, delay(2_000)]);
    }
    if (child.exitCode === null && child.signalCode === null) throw new Error(`Owned ${child.e2eName} PID ${child.pid} did not stop`);
  }
  if (child.e2eLog && !child.e2eLog.closed) {
    await Promise.race([new Promise(resolve => child.e2eLog.end(resolve)), delay(2000).then(() => {
      if (!child.e2eLog.writableFinished) throw new Error(`Log stream for ${child.e2eName} did not finish`);
    })]);
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForHttp(url, child, label) {
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
  while (true) {
    signal.throwIfAborted();
    if (child && child.exitCode !== null) throw new Error(`${label} exited before readiness`);
    try {
      const response = await fetch(url, { signal });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    await delay(100, undefined, { signal });
  }
}

async function waitForPortClosed(port) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const open = await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    });
    if (!open) return;
    await delay(100);
  }
  throw new Error(`Port ${port} remained open after cleanup`);
}

function pythonExecutable() {
  if (process.env.OPERATIONS_PYTHON) return process.env.OPERATIONS_PYTHON;
  const result = spawnSync('uv', ['run', '--no-sync', '--project', aiRoot, 'python', '-c', 'import sys; print(sys.executable)'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Could not resolve the ai_services Python interpreter: ${result.stderr}`);
  return result.stdout.trim();
}

async function startFastApi(env, runDir) {
  const child = startProcess('fastapi', pythonExecutable(), [path.join(backendRoot, 'tests', 'helpers', 'serve-planning.py')], {
    cwd: root,
    env,
    logFile: path.join(runDir, 'fastapi.log'),
    stdin: 'pipe',
  });
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise((resolve, reject) => {
    lines.on('line', line => {
      try {
        const payload = JSON.parse(line);
        if (Number.isInteger(payload.port) && payload.port > 0) resolve(payload.port);
      } catch { /* normal server output */ }
    });
    child.once('close', code => reject(new Error(`FastAPI exited before readiness (${code})`)));
    child.once('error', reject);
  });
  const timeout = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
  const aborted = new Promise((_, reject) => timeout.addEventListener('abort', () => reject(timeout.reason), { once: true }));
  const port = await Promise.race([ready, aborted]);
  await waitForHttp(`http://127.0.0.1:${port}/health`, child, 'FastAPI');
  return { child, port, lines };
}

async function dropSchema(baseUrl, schema, env, journal, runDir) {
  if (!schemaPattern.test(schema)) throw new Error(`Refusing to drop unexpected schema ${schema}`);
  await command(process.execPath, [prisma, 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], {
    cwd: backendRoot,
    env: { ...env, DATABASE_URL: baseUrl.toString() },
    input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE;\n`,
    logFile: path.join(runDir, 'cleanup.log'),
    signal: null,
  });
  forgetSchema(journal, schema);
}

async function runOnce({ baseUrl, sha, sourceDirty, run, artifactRoot, journal, operationsPython }) {
  const runDir = path.join(artifactRoot, `run-${run}`);
  fs.mkdirSync(runDir, { recursive: true });
  const schema = `product_api_it_browser_${process.pid}_${run}_${randomBytes(5).toString('hex')}`;
  const isolatedUrl = new URL(baseUrl);
  isolatedUrl.searchParams.set('schema', schema);
  const target = createHash('sha256').update(baseUrl.toString()).digest('hex');
  appendJournal(journal, { schema, target });
  const adminPassword = `operations-e2e-${randomBytes(12).toString('hex')}`;
  const rolePassword = `operations-role-e2e-${randomBytes(12).toString('hex')}`;
  const usersFile = path.join(runDir, 'test-users.json');
  const commonEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: isolatedUrl.toString(),
    JWT_SECRET: 'operations-browser-e2e-test-secret-at-least-32-characters',
    OPERATIONS_FACTORY_ACCESS: '{}',
    ADMIN_PASSWORD: adminPassword,
    OPERATIONS_PYTHON: operationsPython,
  };
  let fastapi;
  let api;
  let worker;
  let scenarioWorker;
  let frontend;
  let apiPort;
  let frontendPort;
  const cleanupErrors = [];
  console.log(`[operations browser e2e] run=${run}; schema=${schema}; artifacts=${runDir}`);
  try {
    await command(process.execPath, [prisma, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      cwd: backendRoot,
      env: commonEnv,
      logFile: path.join(runDir, 'migration.log'),
    });
    await command(process.execPath, ['prisma/seed.js'], {
      cwd: backendRoot,
      env: commonEnv,
      logFile: path.join(runDir, 'platform-seed.log'),
    });
    await command(process.execPath, ['scripts/seed-operations.js', 'factory-demo-01'], {
      cwd: backendRoot,
      env: { ...commonEnv, OPERATIONS_DEMO_DATABASE_URL: isolatedUrl.toString() },
      logFile: path.join(runDir, 'operations-seed.log'),
    });
    await command(process.execPath, ['tests/helpers/seed-browser-users.js'], {
      cwd: backendRoot,
      env: { ...commonEnv, OPERATIONS_E2E_USERS_FILE: usersFile, OPERATIONS_E2E_ROLE_PASSWORD: rolePassword },
      logFile: path.join(runDir, 'test-users.log'),
    });
    const testUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    commonEnv.OPERATIONS_FACTORY_ACCESS = JSON.stringify({
      'factory-demo-01': [testUsers.viewer.id, testUsers.operator.id, testUsers.replacement.id, testUsers.engineer.id],
      'factory-incident-demo': [testUsers.viewer.id, testUsers.incidentEngineer.id, testUsers.incidentOperator.id],
    });

    fastapi = await startFastApi(commonEnv, runDir);
    frontendPort = await freePort();
    apiPort = await freePort();
    const webUrl = `http://127.0.0.1:${frontendPort}`;
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    const serviceEnv = {
      ...commonEnv,
      PORT: String(apiPort),
      CLIENT_URL: webUrl,
      AI_SERVICE_URL: `http://127.0.0.1:${fastapi.port}`,
      DECISION_CASE_POLL_MS: '50',
      DECISION_CASE_LEASE_MS: '10000',
      DECISION_CASE_HEARTBEAT_MS: '2000',
      SCENARIO_ENGINE_VERSION: 'scenario-evaluator:1.0.0',
      SCENARIO_CONTRACT_VERSION: 'scenario-engine:1.0',
      SCENARIO_SAMPLING_VERSION: 'scenario-crn:1',
    };
    api = startProcess('backend-api', process.execPath, ['src/server.js'], {
      cwd: backendRoot,
      env: serviceEnv,
      logFile: path.join(runDir, 'backend-api.log'),
    });
    await waitForHttp(`${apiUrl}/api/health`, api, 'Backend API');
    worker = startProcess('decision-worker', process.execPath, ['src/decision-worker/index.js'], {
      cwd: backendRoot,
      env: serviceEnv,
      logFile: path.join(runDir, 'decision-worker.log'),
    });
    scenarioWorker = startProcess('scenario-worker', process.execPath, ['src/scenario-worker/index.js'], {
      cwd: backendRoot, env: serviceEnv, logFile: path.join(runDir, 'scenario-worker.log'),
    });
    frontend = startProcess('frontend', process.execPath, [next, 'dev', '--hostname', '127.0.0.1', '--port', String(frontendPort)], {
      cwd: frontendRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_API_BASE_URL: apiUrl,
        NEXT_PUBLIC_OPERATIONS_API_MODE: 'real',
        NEXT_PUBLIC_OPERATIONS_FACTORY_ID: 'factory-demo-01',
      },
      logFile: path.join(runDir, 'frontend.log'),
    });
    await waitForHttp(`${webUrl}/api/health`, frontend, 'Frontend');

    await command(process.execPath, [playwright, 'test', '--config', 'playwright.e2e.config.ts',
      ...(process.argv.includes('--scenarios') ? ['scenario-planning.spec.ts'] : process.argv.includes('--incidents') ? ['incidents.spec.ts'] : [])], {
      cwd: frontendRoot,
      env: {
        ...process.env,
        OPERATIONS_E2E_WEB_URL: webUrl,
        OPERATIONS_E2E_DATABASE_URL: isolatedUrl.toString(),
        OPERATIONS_E2E_API_URL: apiUrl,
        OPERATIONS_E2E_AI_URL: serviceEnv.AI_SERVICE_URL,
        OPERATIONS_E2E_ADMIN_PASSWORD: adminPassword,
        OPERATIONS_E2E_ROLE_PASSWORD: rolePassword,
        OPERATIONS_E2E_VIEWER_USERNAME: testUsers.viewer.username,
        OPERATIONS_E2E_OUTSIDER_USERNAME: testUsers.outsider.username,
        OPERATIONS_E2E_FACTORY_ID: 'factory-demo-01',
        OPERATIONS_E2E_GIT_SHA: sha,
        OPERATIONS_E2E_SOURCE_DIRTY: String(sourceDirty),
        OPERATIONS_E2E_RUN: String(run),
        OPERATIONS_E2E_USERS_FILE: usersFile,
        INCIDENT_E2E_FACTORY_ID: 'factory-incident-demo',
        OPERATIONS_E2E_EVIDENCE_FILE: path.join(runDir, 'evidence.json'),
        OPERATIONS_E2E_RUN_ARTIFACT_DIR: path.join(runDir, 'playwright'),
      },
      logFile: path.join(runDir, 'playwright.log'),
      treeOnAbort: true,
    });
    if (process.argv.includes('--scenarios')) {
      const evidence = JSON.parse(fs.readFileSync(path.join(runDir, 'scenario-evidence.json'), 'utf8'));
      if (evidence.git_sha !== sha || evidence.assertions_passed.length < 6) throw new Error('Scenario evidence is incomplete');
      return evidence;
    }
    const incidentEvidence = JSON.parse(fs.readFileSync(path.join(runDir, 'incident-evidence.json'), 'utf8'));
    // Verify durable state through a new authenticated API process, not merely a
    // browser reload against the same process. Do not save session cookies.
    async function readIncidentHistory() {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
      const login = await fetch(`${apiUrl}/api/v1/auth/login`, { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: adminPassword }) });
      strictEqual(login.status, 200, 'Restart verification login must succeed');
      const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      if (!cookie) throw new Error('Restart verification requires a real login cookie');
      const result = {};
      for (const id of [incidentEvidence.incident_id, incidentEvidence.linked_incident_id]) {
        for (const suffix of ['', '/events', '/occurrences']) {
          const response = await fetch(`${apiUrl}/api/v1/incidents/${id}${suffix}`, { signal, headers: { Cookie: cookie } });
          strictEqual(response.status, 200, 'Incident remains readable after API restart');
          const body = await response.json();
          strictEqual(body.success, true);
          if (body.meta?.has_more) throw new Error('Restart check must compare complete incident history');
          result[id + suffix] = body.data;
        }
      }
      return result;
    }
    const beforeRestart = await readIncidentHistory();
    await stopProcess(api);
    await waitForPortClosed(apiPort);
    api = startProcess('backend-api-restarted', process.execPath, ['src/server.js'], {
      cwd: backendRoot, env: serviceEnv, logFile: path.join(runDir, 'backend-api-restarted.log'),
    });
    await waitForHttp(`${apiUrl}/api/health`, api, 'Restarted backend API');
    deepStrictEqual(await readIncidentHistory(), beforeRestart, 'Incident detail, evidence and audit must survive process restart');
    incidentEvidence.assertions_passed.push('incident_detail_occurrences_audit_survive_api_restart');
    fs.writeFileSync(path.join(runDir, 'incident-evidence.json'), JSON.stringify(incidentEvidence, null, 2) + '\n');
    if (process.argv.includes('--incidents')) return incidentEvidence;
    const evidence = JSON.parse(fs.readFileSync(path.join(runDir, 'evidence.json'), 'utf8'));
    evidence.maintenance_lifecycle = JSON.parse(fs.readFileSync(path.join(runDir, 'maintenance-lifecycle.json'), 'utf8'));
    if (evidence.maintenance_lifecycle.git_sha !== sha || evidence.maintenance_lifecycle.orders.length !== 3) throw new Error('Maintenance lifecycle evidence does not match this integration SHA');
    evidence.work_orders_workspace.complete_lifecycle_recovery = 'passed';
    evidence.work_orders_workspace.pending = [];
    evidence.work_orders_workspace.milestone = 'Full maintenance UI lifecycle run';
    fs.writeFileSync(path.join(runDir, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    return { ...evidence, incidents: incidentEvidence };
  } finally {
    let ownedProcessesStopped = true;
    let ownedPortsClosed = true;
    let schemaRemoved = true;
    for (const child of [frontend, scenarioWorker, worker, api, fastapi?.child]) {
      try { await stopProcess(child); } catch (error) { ownedProcessesStopped = false; cleanupErrors.push(error); }
    }
    fastapi?.lines?.close();
    for (const port of [frontendPort, apiPort, fastapi?.port].filter(Boolean)) {
      try { await waitForPortClosed(port); } catch (error) { ownedPortsClosed = false; cleanupErrors.push(error); }
    }
    try {
      if (!ownedProcessesStopped || !ownedPortsClosed) throw new Error('Schema retained in cleanup journal because owned services have not stopped');
      await dropSchema(baseUrl, schema, commonEnv, journal, runDir);
    }
    catch (error) { schemaRemoved = false; cleanupErrors.push(error); }
    fs.writeFileSync(path.join(runDir, 'cleanup-result.json'), JSON.stringify({
      result: cleanupErrors.length ? 'failed' : 'passed',
      schema_removed: schemaRemoved, owned_processes_stopped: ownedProcessesStopped,
      owned_ports_closed: ownedPortsClosed,
      recovery_required: cleanupErrors.length > 0, schema_journal: journal,
    }, null, 2) + '\n');
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, cleanupErrors.map(error => error.message).join('\n'));
    }
  }
}

async function main() {
  const baseUrl = testDatabase();
  const sha = gitSha();
  const sourceStatus = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (sourceStatus.status !== 0) throw new Error('Cannot determine source worktree state');
  const sourceDirty = Boolean(sourceStatus.stdout.trim());
  if (process.argv.includes('--acceptance') && sourceDirty) throw new Error('Acceptance requires a clean committed source tree');
  const repeat = repeatCount();
  if (process.argv.includes('--acceptance')) {
    if (repeat !== 3) throw new Error('Acceptance requires exactly three consecutive clean-schema runs');
    const status = spawnSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8', windowsHide: true});
    if (status.status !== 0 || status.stdout.trim()) throw new Error('Acceptance requires a clean committed integration SHA');
  }
  const artifactRoot = path.resolve(process.env.OPERATIONS_E2E_ARTIFACT_DIR
    || path.join(root, 'artifacts', process.argv.includes('--scenarios') ? 'scenario-e2e' : 'operations-e2e', sha));
  const journal = path.resolve(process.env.OPERATIONS_SCHEMA_JOURNAL
    || path.join(os.tmpdir(), `operations-browser-e2e-${process.pid}.jsonl`));
  const operationsPython = pythonExecutable();
  fs.mkdirSync(artifactRoot, { recursive: true });

  await command(process.execPath, [prisma, 'generate', '--schema', 'prisma/schema.prisma'], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: baseUrl.toString() },
    logFile: path.join(artifactRoot, 'prisma-generate.log'),
  });

  const evidence = [];
  for (let run = 1; run <= repeat; run += 1) {
    controller.signal.throwIfAborted();
    evidence.push(await runOnce({ baseUrl, sha, sourceDirty, run, artifactRoot, journal, operationsPython }));
  }
  if (process.argv.includes('--scenarios')) {
    const hashes = new Set(evidence.map(item => item.semantic_input_hash));
    if (hashes.size !== 1 || !/^[a-f0-9]{64}$/.test(evidence[0].semantic_input_hash)) throw new Error('Scenario replay differs between clean schemas');
    fs.writeFileSync(path.join(artifactRoot, 'summary.json'), JSON.stringify({git_sha: sha, source_tree_dirty: sourceDirty,
      run_count: repeat, acceptance: repeat === 3 && !sourceDirty ? 'THREE_BROWSER_RUNS_PASSED' : 'IN_PROGRESS', runs: evidence}, null, 2) + '\n');
    return;
  }
  const incidentFingerprints = evidence.map(item => (process.argv.includes('--incidents') ? item : item.incidents).recommendation_fingerprint);
  if (incidentFingerprints.some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) throw new Error('Incident linked planner fingerprint was not asserted');
  if (repeat > 1 && new Set(incidentFingerprints).size !== 1) throw new Error('Incident planner deterministic replay failed');
  if (process.argv.includes('--incidents')) {
    fs.writeFileSync(path.join(artifactRoot, 'incident-summary.json'), JSON.stringify({
      git_sha: sha, source_tree_dirty: sourceDirty, run_count: repeat, runs: evidence,
      acceptance: 'IN_PROGRESS', deterministic_planner_replay: repeat > 1 ? 'passed' : 'single_run_only',
    }, null, 2) + '\n');
    console.log('[incident browser e2e] Targeted assertions passed; full acceptance remains pending.');
    return;
  }
  const fingerprints = [...new Set(evidence.map(item => item.recommendation_fingerprint))];
  if (repeat > 1 && fingerprints.length !== 1) {
    throw new Error(`Deterministic replay failed: ${fingerprints.length} recommendation fingerprints were produced`);
  }
  const summary = {
    schema_version: '1.0',
    git_sha: sha,
    source_tree_dirty: sourceDirty,
    incident_deterministic_replay: repeat > 1 ? 'passed' : 'single_run_only',
    completed_at: new Date().toISOString(),
    run_count: repeat,
    maintenance_lifecycle_three_runs: repeat === 3 && evidence.every(item => item.maintenance_lifecycle?.git_sha === sha && item.work_orders_workspace.complete_lifecycle_recovery === 'passed'),
    deterministic_replay: fingerprints.length === 1,
    recommendation_fingerprint: fingerprints[0],
    runs: evidence,
  };
  fs.writeFileSync(path.join(artifactRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(artifactRoot, 'summary.md'), [
    `# Operations browser E2E evidence — ${sha}`,
    '',
    `- Runs from isolated reset: ${repeat}`,
    `- Deterministic recommendation: ${summary.deterministic_replay ? 'PASS' : 'FAIL'}`,
    `- Recommendation fingerprint: \`${summary.recommendation_fingerprint}\``,
    '',
    ...evidence.map(item => `- Run ${item.run}: case \`${item.decision_case_id}\`, ${item.candidate_count} candidates, events ${item.event_sequences.join(', ')}`),
    '',
  ].join('\n'));
  console.log(`[operations browser e2e] PASS (${repeat} run${repeat === 1 ? '' : 's'}); evidence=${artifactRoot}`);
}

main().catch(error => {
  console.error(`[operations browser e2e] ${error.stack || error.message}`);
  process.exitCode = interruptedSignal || 1;
}).finally(() => {
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
});
