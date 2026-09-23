const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const { OperationsPlanningClient } = require('../../src/services/operations-planning.client');
const { planPersistedSnapshot } = require('../../src/services/operations-planning.service');
const { seedOperations, readOperations } = require('../../src/services/operations-context.service');
const { ingestFactorySnapshot } = require('../../src/services/operations-snapshot.service');
const { loadCanonicalSeedPlan, validatePayload } = require('../../src/services/operations-contract.service');
const { command } = require('../../../scripts/check-migration-paths');

const root = path.resolve(__dirname, '../..');
const db = new PrismaClient();
const baseUrl = process.env.AI_SERVICE_URL;
const user = { id: 'planning-integration-admin', role: 'ADMIN' };
let plan, request;
const calls = async () => (await fetch(`${baseUrl}/test/requests`)).json();
const client = (mode, options = {}) => new OperationsPlanningClient({
  baseUrl: mode ? `${baseUrl}/faults/${mode}` : baseUrl, ...options,
});

beforeAll(async () => {
  if (!/^product_api_it_planning_\w+$/.test(new URL(process.env.DATABASE_URL).searchParams.get('schema'))) {
    throw new Error('Use npm run test:operations-planning to isolate PostgreSQL and start FastAPI');
  }
  plan = await loadCanonicalSeedPlan();
  await seedOperations(db, plan, { factoryId: plan.factory_id });
  const context = await readOperations(db, user, plan.factory_id);
  request = { ...plan.run_request, factory_snapshot: context.snapshot.snapshot };
});
afterAll(async () => db.$disconnect());
afterEach(async () => {
  let active;
  for (let i = 0; i < 100; i++) {
    active = (await (await fetch(`${baseUrl}/test/active`)).json()).active;
    if (active === 0) break;
    await delay(20);
  }
  expect(active).toBe(0);
});

test('persisted canonical snapshot -> real planner -> validated deterministic recommendation, without writes', async () => {
  const state = async () => ({
    snapshots: await db.factorySnapshot.findMany(), schedules: await db.operationSchedule.findMany(),
    heads: await db.operationsHead.findMany(), audits: await db.auditLog.findMany(),
  });
  const before = await state();
  const input = { factoryId: plan.factory_id, decisionCaseId: 'case-real-planner' };
  const options = { requestId: 'request-planning-integration', correlationId: 'correlation-planning-integration' };
  const first = await planPersistedSnapshot(db, user, input, options);
  const second = await planPersistedSnapshot(db, user, input, options);
  expect(second).toEqual(first);
  expect(first).toEqual(await validatePayload(first, 'recommendation'));
  expect(first.decision_case_id).toBe(input.decisionCaseId);
  expect(first.snapshot_id).toBe(request.factory_snapshot.snapshot_id);
  expect(first.candidate_plans.length).toBeGreaterThanOrEqual(1);
  expect(first.candidate_plans.length).toBeLessThanOrEqual(3);
  for (const candidate of first.candidate_plans) {
    expect(candidate.schedule.factory_id).toBe(plan.factory_id);
    expect(candidate.snapshot_id).toBe(first.snapshot_id);
    expect(candidate.decision_case_id).toBe(first.decision_case_id);
    expect(candidate.validation.verdict).toBe('VALID');
  }
  const forwarded = (await calls()).filter(item => item.request_id === options.requestId);
  expect(forwarded).toHaveLength(2);
  expect(forwarded[0].correlation_id).toBe(options.correlationId);
  expect(forwarded[0].body.factory_snapshot).toEqual(request.factory_snapshot);
  expect(await state()).toEqual(before);
});

test('reads another persisted snapshot and never silently falls back to canonical data', async () => {
  const snapshot = { ...structuredClone(request.factory_snapshot), factory_id: 'factory-planning-other',
    snapshot_id: 'snapshot-planning-other', current_schedule: null };
  await ingestFactorySnapshot({ factoryId: snapshot.factory_id, snapshot, expectedHeadRevision: 0,
    sourceId: 'planning-test' }, db);
  const result = await planPersistedSnapshot(db, user, { factoryId: snapshot.factory_id, decisionCaseId: 'case-other-planning' });
  expect(result.snapshot_id).toBe(snapshot.snapshot_id);
  expect(result.candidate_plans.every(candidate => candidate.schedule.factory_id === snapshot.factory_id)).toBe(true);
  const count = (await calls()).length;
  await expect(planPersistedSnapshot(db, user, { factoryId: 'missing', decisionCaseId: 'case-missing' }))
    .rejects.toMatchObject({ code: 'FACTORY_NOT_FOUND' });
  await expect(planPersistedSnapshot(db, { id: 'outsider', role: 'VIEWER' }, { factoryId: plan.factory_id, decisionCaseId: 'case-forbidden' }))
    .rejects.toMatchObject({ code: 'FACTORY_NOT_FOUND' });
  expect((await calls()).length).toBe(count);
});

test('development command calls the real planner and prints only canonical recommendation JSON', async () => {
  const child = spawn(process.execPath, ['scripts/plan-operations-demo.js', plan.factory_id, 'case-cli-planning'], {
    cwd: root, env: { ...process.env, OPERATIONS_DEMO_DATABASE_URL: process.env.DATABASE_URL },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', error = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { error += data; });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    expect({ status, error }).toEqual({ status: 0, error: '' });
    const value = JSON.parse(output);
    expect(value.decision_case_id).toBe('case-cli-planning');
    expect(value).toEqual(await validatePayload(value, 'recommendation'));
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill(); }
});

test('validates outbound contract including semantic references before any network request', async () => {
  const count = (await calls()).length;
  const invalid = structuredClone(request);
  invalid.trigger.machine_id = 'unknown-machine';
  await expect(client().plan(invalid)).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_PLANNING_REQUEST' });
  await expect(client().plan({})).rejects.toMatchObject({ code: 'INVALID_PLANNING_REQUEST' });
  expect((await calls()).length).toBe(count);
});

test('real infeasible snapshot maps HTTP 409 and is never retried', async () => {
  const input = structuredClone(request);
  input.factory_snapshot.technicians = [];
  input.factory_snapshot.current_schedule = null;
  const count = (await calls()).length;
  await expect(client().plan(input)).rejects.toMatchObject({ statusCode: 409, code: 'NO_FEASIBLE_PLAN', retryable: false });
  expect((await calls()).length - count).toBe(1);
});

test.each([
  ['422', 422, 'INVALID_PLANNING_REQUEST', 1],
  ['504', 504, 'PLANNING_TIMEOUT', 1],
  ['401', 503, 'AI_UNAVAILABLE', 1],
  ['429', 503, 'AI_UNAVAILABLE', 1],
  ['500', 503, 'AI_UNAVAILABLE', 2],
  ['503', 503, 'AI_UNAVAILABLE', 2],
  ['503-no-retry', 503, 'AI_UNAVAILABLE', 1],
  ['malformed', 502, 'INVALID_AI_RESPONSE', 1],
  ['schema-invalid', 502, 'INVALID_AI_RESPONSE', 1],
  ['json-null', 502, 'INVALID_AI_RESPONSE', 1],
  ['invalid-candidate', 502, 'INVALID_AI_RESPONSE', 1],
  ['wrong-factory', 502, 'INVALID_AI_RESPONSE', 1],
  ['wrong-snapshot', 502, 'INVALID_AI_RESPONSE', 1],
  ['wrong-case', 502, 'INVALID_AI_RESPONSE', 1],
])('%s maps to HTTP %i with a bounded attempt count', async (mode, statusCode, code, attempts) => {
  const count = (await calls()).length;
  await expect(client(mode).plan(request, { requestId: 'error-request', correlationId: 'error-correlation' }))
    .rejects.toMatchObject({ statusCode, code, requestId: 'error-request', correlationId: 'error-correlation' });
  expect((await calls()).length - count).toBe(attempts);
});

test('retries a transient 503 only once with identical body and forwarded IDs', async () => {
  const count = (await calls()).length;
  const result = await client('retry-once').plan(request, { requestId: 'retry-request', correlationId: 'retry-correlation' });
  expect(result.recommended_plan_id).toBeTruthy();
  const attempts = (await calls()).slice(count);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
});

test('connection refused becomes AI_UNAVAILABLE after at most one retry', async () => {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const fetcher = jest.fn(fetch);
  const unavailable = new OperationsPlanningClient({ baseUrl: `http://127.0.0.1:${port}`, fetcher });
  await expect(unavailable.plan(request)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', retryable: true });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test.each(['timeout', 'slow-body'])('%s is bounded by one deadline and is not retried', async mode => {
  const count = (await calls()).length;
  const started = Date.now();
  await expect(client(mode, { timeoutMs: 1500 }).plan(request)).rejects.toMatchObject({ code: 'PLANNING_TIMEOUT' });
  expect(Date.now() - started).toBeLessThan(4000);
  expect((await calls()).length - count).toBe(1);
});

test('cancellation aborts a real in-flight request without retry; pre-abort makes no HTTP request', async () => {
  const count = (await calls()).length;
  const controller = new AbortController();
  const pending = client('timeout').plan(request, { signal: controller.signal });
  const assertion = expect(pending).rejects.toMatchObject({ code: 'PLANNING_CANCELLED' });
  try {
    for (let i = 0; i < 100 && (await calls()).length === count; i++) await delay(25);
    controller.abort();
    await assertion;
    expect((await calls()).length - count).toBe(1);
    await expect(client().plan(request, { signal: controller.signal })).rejects.toMatchObject({ code: 'PLANNING_CANCELLED' });
    expect((await calls()).length - count).toBe(1);
  } finally { controller.abort(); }
});

test.each(['graceful', 'forced'])('%s runner interruption removes its schema, FastAPI process and port', async interruption => {
  // A second runner exercises actual process cancellation without interrupting
  // this suite. Its private journal is independent of the outer schema.
  const env = { ...process.env };
  delete env.OPERATIONS_SCHEMA_JOURNAL;
  const child = spawn(process.execPath, ['tests/planning/run-planning-tests.js', '--lifecycle-probe'], {
    cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.resume();
  const exited = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  let schema, url, journal;
  const deadline = Date.now() + 15000;
  try {
    while (!output.includes('FastAPI ready:')) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Probe did not start: ${output}`);
      await delay(25);
    }
    schema = output.match(/schema=(product_api_it_planning_\w+)/)[1];
    url = output.match(/FastAPI ready: (http:\/\/127\.0\.0\.1:\d+)/)[1];
    journal = output.match(/journal=([^\r\n]+)/)[1];
    // stdin EOF works on Windows too, where Node cannot send POSIX SIGTERM.
    if (interruption === 'forced') child.kill('SIGKILL');
    else if (process.platform === 'win32') child.stdin.end();
    else child.kill('SIGTERM');
    expect(await exited).not.toBe(0);
    if (interruption === 'forced') {
      // Same journal fallback as the workflow always() step after SIGKILL.
      await command([path.join(root, 'tests/integration/run-integration-tests.js'), '--cleanup'], {
        cwd: root, env: { ...env, OPERATIONS_SCHEMA_JOURNAL: journal },
      });
      expect(fs.readFileSync(journal, 'utf8')).toBe('');
      const directory = path.dirname(journal);
      if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('operations-planning-')) throw new Error('Unexpected probe temp directory');
      await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } else expect(output).toContain(`Dropped ${schema}`);
    expect(await db.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${schema}`).toEqual([]);
    for (let i = 0; i < 100; i++) {
      try { await fetch(`${url}/health`, { signal: AbortSignal.timeout(100) }); }
      catch { break; }
      await delay(50);
    }
    await expect(fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
  } finally { if (child.exitCode === null) { child.stdin.end(); child.kill(); await exited; } }
}, 30000);
