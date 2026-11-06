const { randomUUID } = require('node:crypto');
const db = require('../../src/config/prisma');
const app = require('../../src/app');
const { fixture } = require('../helpers/work-order-fixtures');
const example = require('../../../contracts/v3/examples/demo-scenario.json');
const { setTimeout: delay } = require('node:timers/promises');
const { contentHash } = require('../../src/services/operations-contract.service');
const saved = Object.fromEntries(['FACTORY_ACCESS_SOURCE', 'SCENARIO_ENGINE_VERSION', 'SCENARIO_CONTRACT_VERSION', 'SCENARIO_SAMPLING_VERSION'].map(key => [key, process.env[key]]));
let f, a, b;
beforeAll(async () => {
  process.env.FACTORY_ACCESS_SOURCE = 'database';
  // This suite verifies HTTP/persistence only; these identities do not claim a real engine run.
  process.env.SCENARIO_ENGINE_VERSION = 'storage-test';
  process.env.SCENARIO_CONTRACT_VERSION = 'storage-test';
  process.env.SCENARIO_SAMPLING_VERSION = 'storage-test';
  f = await fixture(db, app);
  a = await f.factory(); b = await f.factory();
}, 60000);
afterAll(async () => {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (f) await f.close();
  await db.$disconnect();
});
async function request(snapshot = a) {
  const head = await db.operationsHead.findUnique({ where: { factoryId: snapshot.factory_id } });
  return { factory_id: snapshot.factory_id, name: ' Scenario test ',
    expected_head: { snapshot_id: head.snapshotId, plan_version: head.planVersion, revision: head.revision },
    planning_config: { ...example.planning_config, candidate_limit: 3, solver_timeout_seconds: 30, simulation_runs: 100,
      allowed_strategy_ids: ['PRODUCTION_PRIORITY', 'BALANCED', 'RELIABILITY_PRIORITY'] } };
}
async function create(snapshot = a, user = f.users.MANAGER) {
  const response = await f.http('/scenario-workspaces', { method: 'POST', user, body: await request(snapshot) });
  expect(response.status).toBe(201);
  expect(response.cache).toBe('no-store');
  return response.body.data;
}
const path = row => `/scenario-workspaces/${row.workspace_id}`;
function draft(snapshot = a) {
  return { name: 'Duration', note: '', objective_weights: example.planning_config.objective_weights,
    overrides: [{ type: 'MAINTENANCE_DURATION', maintenance_request_id: snapshot.maintenance_requests[0].maintenance_request_id, expected_duration_minutes: 90 }] };
}
test('ADMIN/ENGINEER can write; VIEWER/OPERATOR read but cannot write; inactive/tokenless denied', async () => {
  const w = await create();
  for (const user of [f.users.ADMIN, f.users.MANAGER, f.users.VIEWER, f.users.OPERATOR])
    expect((await f.http(path(w), { user })).status).toBe(200);
  for (const user of [f.users.VIEWER, f.users.OPERATOR])
    expect((await f.http('/scenario-workspaces', { user, method: 'POST', body: await request() })).status).toBe(403);
  for (const user of [f.users.VIEWER, f.users.OPERATOR]) {
    for (const workspaceId of [w.workspace_id, randomUUID()])
      expect((await f.http(`/scenario-workspaces/${workspaceId}/runs`, { user, method: 'POST', body: { kind: 'BASELINE' } })).status).toBe(403);
  }
  for (const user of [f.users.INACTIVE, null]) expect((await f.http(path(w), { user })).status).toBe(401);
});
test('factory-scoped detail/list/draft prevent guessed IDs and unknown query fields', async () => {
  const w = await create();
  const other = await create(b);
  const created = await f.http(`${path(w)}/scenarios`, { method: 'POST', body: draft() });
  expect(created.status).toBe(201);
  const d = created.body.data;
  expect((await f.http(`${path(other)}/scenarios/${d.scenario_id}`)).status).toBe(404);
  expect((await f.http(path(w), { user: f.users.OUTSIDER })).status).toBe(404);
  expect((await f.http(`/scenario-workspaces?factory_id=${a.factory_id}`, { user: f.users.OUTSIDER })).status).toBe(404);
  expect((await f.http(`/scenario-workspaces?factory_id=${a.factory_id}&factory_id=${b.factory_id}`)).status).toBe(400);
  expect((await f.http(`${path(w)}?debug=true`)).status).toBe(400);
});
test('historical baseline entity read stays pinned after ingestion and enforces fresh scope', async () => {
  const source = await f.factory(), w = await create(source);
  const url = `${path(w)}/baseline-entities`;
  const original = await f.http(url, { user: f.users.VIEWER });
  expect(original.status).toBe(200); expect(original.cache).toBe('no-store');
  expect(original.body.data.baseline).toEqual(w.baseline);
  expect(original.body.data.planning_window).toEqual(source.planning_window);
  expect(original.body.data.technicians[0]).toEqual({ technician_id: source.technicians[0].technician_id,
    display_name: source.technicians[0].display_name, availability: source.technicians[0].availability });
  expect(original.body.data.maintenance_requests[0].expected_duration_minutes).toBe(source.maintenance_requests[0].expected_duration_minutes);
  expect(Object.keys(original.body.data).sort()).toEqual(['baseline', 'maintenance_requests', 'planning_window', 'technicians', 'workspace_id']);
  const head = await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } });
  const next = structuredClone(source); next.snapshot_id = 'entities-S2-' + randomUUID();
  next.technicians[0].display_name = 'Changed current name';
  next.maintenance_requests[0].expected_duration_minutes += 1;
  await require('../../src/services/operations-snapshot.service').ingestFactorySnapshot({ factoryId: source.factory_id,
    expectedHeadRevision: head.revision, snapshot: next, sourceId: 'historical-entities-test' }, db);
  const current = await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } });
  for (const user of [f.users.ADMIN, f.users.MANAGER, f.users.OPERATOR, f.users.VIEWER])
    expect((await f.http(url, { user })).body).toEqual(original.body);
  expect((await f.http(url, { user: f.users.OUTSIDER })).status).toBe(404);
  expect((await f.http(url, { user: f.users.INACTIVE })).status).toBe(401);
  expect((await f.http(url + '?factory_id=other')).status).toBe(400);
  expect((await f.http(`/scenario-workspaces/${randomUUID()}/baseline-entities`)).status).toBe(404);
  expect((await f.member(source.factory_id, f.users.VIEWER, 'DELETE')).status).toBe(200);
  expect((await f.http(url, { user: f.users.VIEWER })).status).toBe(404);
  expect(await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } })).toEqual(current);
  expect(await db.decisionCase.count({ where: { factoryId: source.factory_id } })).toBe(0);
});

test('lost-response replay returns original identity, different body conflicts, revoke blocks replay', async () => {
  const key = randomUUID(), body = await request();
  const options = { method: 'POST', user: f.users.OTHER, body, key };
  const first = await f.http('/scenario-workspaces', options);
  expect(first.status).toBe(201);
  const replay = await f.http('/scenario-workspaces', options);
  expect(replay.body).toEqual(first.body);
  expect(replay.replay).toBe('true');
  expect((await f.http('/scenario-workspaces', { ...options, body: { ...body, name: 'different' } })).status).toBe(409);
  expect((await f.member(a.factory_id, f.users.OTHER, 'DELETE')).status).toBe(200);
  expect((await f.http('/scenario-workspaces', options)).status).toBe(404);
  expect((await f.http(path(first.body.data), { user: f.users.OTHER })).status).toBe(404);
});
test('concurrent draft edits serialize one revision winner and rejected write leaves no receipt/event', async () => {
  const w = await create();
  const created = await f.http(`${path(w)}/scenarios`, { method: 'POST', body: draft() });
  const url = `${path(w)}/scenarios/${created.body.data.scenario_id}`;
  const responses = await Promise.all(['A', 'B'].map(name => f.http(url, { method: 'PATCH', body: { ...draft(), name, expected_revision: 1 } })));
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  const after = await f.http(url);
  expect(after.body.data.revision).toBe(2);
  const events = await db.$queryRaw`SELECT type FROM scenario_events WHERE workspace_id=${w.workspace_id}::uuid AND type='DRAFT_REVISED'`;
  expect(events).toHaveLength(1);
  const revisions = await db.$queryRaw`SELECT revision FROM scenario_draft_revisions WHERE scenario_id=${created.body.data.scenario_id}::uuid ORDER BY revision`;
  expect(revisions.map(r => r.revision)).toEqual([1, 2]);
});
test('pagination is complete without duplicates, cursor cannot move between actors or factories', async () => {
  for (let i = 0; i < 3; i++) await create(b);
  const base = `/scenario-workspaces?factory_id=${b.factory_id}&limit=1`;
  const ids = new Set();
  let cursor, firstCursor;
  do {
    const response = await f.http(base + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''));
    expect(response.status).toBe(200);
    for (const row of response.body.data.items) { expect(ids.has(row.workspace_id)).toBe(false); ids.add(row.workspace_id); }
    cursor = response.body.data.next_cursor;
    firstCursor ??= cursor;
  } while (cursor);
  const [{ count }] = await db.$queryRaw`SELECT count(*)::int AS count FROM scenario_workspaces WHERE factory_id=${b.factory_id}`;
  expect(ids.size).toBe(count);
  expect((await f.http(`${base}&cursor=${firstCursor}`, { user: f.users.MANAGER })).status).toBe(400);
  expect((await f.http(`/scenario-workspaces?factory_id=${a.factory_id}&cursor=${firstCursor}`)).status).toBe(400);
  expect((await f.http(`${base}&cursor=invalid`)).status).toBe(400);
});
test('reads do not modify snapshot/head/schedule and stale head creation fails atomically', async () => {
  const w = await create();
  const read = () => Promise.all([db.operationsHead.findUnique({ where: { factoryId: a.factory_id } }),
    db.factorySnapshot.findMany({ where: { factoryId: a.factory_id } }), db.operationSchedule.findMany({ where: { factoryId: a.factory_id } })]);
  const before = await read();
  await f.http(path(w)); await f.http(`/scenario-workspaces?factory_id=${a.factory_id}`);
  const body = await request(); body.expected_head.revision++;
  expect((await f.http('/scenario-workspaces', { method: 'POST', body })).status).toBe(409);
  expect(await read()).toEqual(before);
});
test('duplicate run enqueue is atomic and frozen revision survives draft edits', async () => {
  const w = await create();
  const created = await f.http(`${path(w)}/scenarios`, { method: 'POST', body: draft() });
  const d = created.body.data, key = randomUUID();
  const options = { method: 'POST', key, body: { kind: 'SCENARIO', scenario_id: d.scenario_id, expected_revision: 1 } };
  const responses = await Promise.all([f.http(`${path(w)}/runs`, options), f.http(`${path(w)}/runs`, options)]);
  expect(responses.map(r => r.status)).toEqual([202, 202]);
  expect(responses[0].body).toEqual(responses[1].body);
  const job = responses[0].body.data;
  expect(job.points).toHaveLength(2);
  expect(job.status).toBe('QUEUED');
  const [before] = await db.$queryRaw`SELECT input_json,input_hash FROM scenario_jobs WHERE id=${job.job_id}::uuid`;
  expect(before.input_json.overrides[0].expected_duration_minutes).toBe(90);
  const revised = { ...draft(), expected_revision: 1, overrides: [{ ...draft().overrides[0], expected_duration_minutes: 180 }] };
  expect((await f.http(`${path(w)}/scenarios/${d.scenario_id}`, { method: 'PATCH', body: revised })).status).toBe(200);
  expect((await f.http(`${path(w)}/runs`, { ...options, key: randomUUID() })).status).toBe(409);
  const [after] = await db.$queryRaw`SELECT input_json,input_hash FROM scenario_jobs WHERE id=${job.job_id}::uuid`;
  expect(after).toEqual(before);
  expect((await f.http(`${path(w)}/runs/${job.job_id}`, { user: f.users.VIEWER })).status).toBe(200);
  expect((await f.http(`${path(w)}/runs`, { method: 'POST', user: f.users.OPERATOR, body: { kind: 'BASELINE' } })).status).toBe(403);
  const foreign = await create(b);
  expect((await f.http(`${path(foreign)}/runs/${job.job_id}`)).status).toBe(404);
  const events = await db.$queryRaw`SELECT sequence FROM scenario_events WHERE job_id=${job.job_id}::uuid AND type='RUN_ENQUEUED'`;
  expect(events).toHaveLength(1);
});

test('worker leases serialize factory concurrency, reclaim frozen inputs and reject the old owner', async () => {
  const lease = require('../../src/services/scenario-lease.service');
  const oldEngine = process.env.SCENARIO_ENGINE_VERSION;
  process.env.SCENARIO_ENGINE_VERSION = 'lease-test-' + randomUUID();
  try {
    const w = await create();
    const queued = await f.http(`${path(w)}/runs`, { method: 'POST', body: { kind: 'BASELINE' } });
    expect(queued.status).toBe(202);
    const settings = { workerId: 'worker-a', engineVersion: process.env.SCENARIO_ENGINE_VERSION, contractVersion: 'storage-test', leaseMs: 30000 };
    const attempts = await Promise.all([lease.claimNext(db, settings), lease.claimNext(db, { ...settings, workerId: 'worker-b' })]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const first = attempts.find(Boolean);
    const originalInput = first.input_json;
    // Expire this test-owned lease using DB clock; do not sleep or rewrite input/deadline.
    await db.$executeRaw`UPDATE scenario_jobs SET lease_expires_at=clock_timestamp()-interval '1 millisecond' WHERE id=${first.id}::uuid`;
    const next = await lease.claimNext(db, { ...settings, workerId: 'worker-after-restart', leaseMs: 30000 });
    expect(next.id).toBe(first.id);
    expect(next.attempt).toBe(2);
    expect(next.lease_token).not.toBe(first.lease_token);
    expect(next.input_json).toEqual(originalInput);
    expect(next.input_hash).toBe(first.input_hash);
    await expect(lease.heartbeat(db, first)).rejects.toMatchObject({ code: 'SCENARIO_LEASE_CONFLICT' });
    await expect(lease.fenced(db, first, tx => tx.$executeRaw`UPDATE scenario_points SET status='FAILED',error_code='LATE',completed_at=clock_timestamp() WHERE job_id=${first.id}::uuid`))
      .rejects.toMatchObject({ code: 'SCENARIO_LEASE_CONFLICT' });
    const points = await db.$queryRaw`SELECT status FROM scenario_points WHERE job_id=${first.id}::uuid`;
    expect(points.every(point => point.status === 'QUEUED')).toBe(true);
    const history = await db.$queryRaw`SELECT attempt,status FROM scenario_attempts WHERE job_id=${first.id}::uuid ORDER BY attempt`;
    expect(history).toEqual([{ attempt: 1, status: 'EXPIRED' }, { attempt: 2, status: 'RUNNING' }]);
    await lease.release(db, next);
    const third = await lease.claimNext(db, { ...settings, leaseMs: 30000 });
    expect(third.attempt).toBe(3);
    await lease.release(db, third);
    expect(await lease.claimNext(db, settings)).toBeNull();
    const read = await f.http(`${path(w)}/runs/${first.id}`);
    expect(read.body.data.status).toBe('FAILED');
    expect(read.body.data.error_code).toBe('SCENARIO_ATTEMPTS_EXHAUSTED');
  } finally { process.env.SCENARIO_ENGINE_VERSION = oldEngine; }
});
test('S1/P1 workspace and frozen publication remain historical after ingesting S2', async () => {
  const source = await f.factory();
  const published = await f.publish(source);
  const w = await create(source);
  expect(w.baseline.publication.schedule_id).toBe(published.candidate.schedule.schedule_id);
  const queued = await f.http(`${path(w)}/runs`, { method: 'POST', body: { kind: 'BASELINE' } });
  expect(queued.status).toBe(202);
  const [input] = await db.$queryRaw`SELECT input_json,input_hash FROM scenario_jobs WHERE id=${queued.body.data.job_id}::uuid`;
  expect(input.input_json.reference_publication).toEqual(published.candidate.schedule);
  const head = await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } });
  const observed = structuredClone(source);
  observed.snapshot_id = 'scenario-S2-' + randomUUID();
  observed.captured_at = new Date(Date.parse(source.captured_at) + 60000).toISOString();
  observed.current_schedule = structuredClone(published.candidate.schedule);
  await require('../../src/services/operations-snapshot.service').ingestFactorySnapshot({ factoryId: source.factory_id,
    expectedHeadRevision: head.revision, snapshot: observed, sourceId: 'scenario-history-test' }, db);
  const historical = await f.http(path(w));
  expect(historical.body.data.stale).toBe(true);
  expect(historical.body.data.baseline.snapshot_id).toBe(source.snapshot_id);
  expect(historical.body.data.current_head.snapshot_id).toBe(observed.snapshot_id);
  const again = await f.http(`${path(w)}/runs`, { method: 'POST', body: { kind: 'BASELINE' } });
  expect(again.status).toBe(202);
  const [second] = await db.$queryRaw`SELECT input_json,input_hash FROM scenario_jobs WHERE id=${again.body.data.job_id}::uuid`;
  expect(second).toEqual(input);
  const currentWorkspace = await create(observed);
  expect(currentWorkspace.baseline.snapshot_id).toBe(observed.snapshot_id);
  expect(currentWorkspace.baseline.publication.schedule_id).toBe(w.baseline.publication.schedule_id);
});

async function waitForFactoryWaiters(factoryId, expected) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const [{ count }] = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_locks
      WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND classid::bigint=((hashtextextended(${factoryId},0)>>32)&4294967295)
        AND objid::bigint=(hashtextextended(${factoryId},0)&4294967295)`;
    if (count >= expected) return;
    await delay(20);
  }
  throw Error('Expected HTTP requests did not reach the factory lock queue');
}

test.each([
  ['revoke first', false, false], ['enqueue first', true, false],
  ['revoke before replay', false, true], ['replay before revoke', true, true],
])('coordinated %s honors serialization and authorization before receipts', async (_name, writeFirst, replay) => {
  const source = await f.factory(), w = await create(source), key = randomUUID();
  const options = { method: 'POST', user: f.users.OTHER, key, body: { kind: 'BASELINE' } };
  const enqueue = () => f.http(`${path(w)}/runs`, options);
  const revoke = () => f.member(source.factory_id, f.users.OTHER, 'DELETE');
  if (replay) expect((await enqueue()).status).toBe(202);
  let unlock, ready;
  const released = new Promise(resolve => { unlock = resolve; });
  const acquired = new Promise(resolve => { ready = resolve; });
  const gate = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${source.factory_id},0))::text`;
    ready();
    await released;
  }, { timeout: 20000 });
  let first, second;
  try {
    await Promise.race([acquired, gate]);
    first = writeFirst ? enqueue() : revoke();
    await waitForFactoryWaiters(source.factory_id, 1);
    second = writeFirst ? revoke() : enqueue();
    await waitForFactoryWaiters(source.factory_id, 2);
  } finally { unlock(); await gate; }
  const responses = await Promise.all([first, second]);
  const written = responses[writeFirst ? 0 : 1], revoked = responses[writeFirst ? 1 : 0];
  expect(revoked.status).toBe(200);
  expect(written.status).toBe(writeFirst ? 202 : 404);
  if (writeFirst && replay) expect(written.replay).toBe('true');
  const [{ count }] = await db.$queryRaw`SELECT count(*)::int AS count FROM scenario_jobs WHERE workspace_id=${w.workspace_id}::uuid`;
  expect(count).toBe(replay || writeFirst ? 1 : 0);
  const [{ events }] = await db.$queryRaw`SELECT count(*)::int AS events FROM scenario_events
    WHERE workspace_id=${w.workspace_id}::uuid AND type='RUN_ENQUEUED'`;
  expect(events).toBe(count);
  expect((await enqueue()).status).toBe(404);
}, 30000);

test.each(['VIEWER', 'INACTIVE'])('write boundary rechecks user changed to %s while waiting for row lock', async change => {
  const source = await f.factory(), w = await create(source);
  const target = f.users.OTHER;
  let release, ready;
  const released = new Promise(resolve => { release = resolve; });
  const acquired = new Promise(resolve => { ready = resolve; });
  let pid;
  const administration = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${target.id}::uuid FOR UPDATE`;
    pid = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid;
    ready(); await released;
    await tx.user.update({ where: { id: target.id }, data: change === 'VIEWER' ? { role: 'VIEWER' } : { active: false } });
  }, { timeout: 20000 });
  let request;
  try {
    await Promise.race([acquired, administration]);
    request = f.http(`${path(w)}/runs`, { method: 'POST', user: target, body: { kind: 'BASELINE' } });
    const deadline = Date.now() + 8000;
    let blocked = false;
    while (Date.now() < deadline) {
      const [{ count }] = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE ${pid}::int=ANY(pg_blocking_pids(pid))`;
      if (count > 0) { blocked = true; break; }
      await delay(20);
    }
    expect(blocked).toBe(true);
  } finally { release(); await administration; }
  try {
    expect((await request).status).toBe(change === 'VIEWER' ? 403 : 401);
    expect(await db.$queryRaw`SELECT id FROM scenario_jobs WHERE workspace_id=${w.workspace_id}::uuid`).toHaveLength(0);
  } finally { await db.user.update({ where: { id: target.id }, data: { role: 'ENGINEER', active: true } }); }
}, 30000);

// Authorization/serialization fixture uses the real callable and fenced
// persistence. HTTP engine/worker acceptance is a separate planning suite.
async function completedBoundaryRun(overrides = []) {
  const source = await f.factory(), previousVersion = process.env.SCENARIO_ENGINE_VERSION;
  if (typeof overrides === 'function') overrides = overrides(source);
  process.env.SCENARIO_ENGINE_VERSION = 'boundary-' + randomUUID();
  let w, job;
  try {
    w = await create(source);
    const created = await f.http(`${path(w)}/scenarios`, { method: 'POST', body: { ...draft(source), overrides } });
    expect(created.status).toBe(201);
    const response = await f.http(`${path(w)}/runs`, { method: 'POST', body: { kind: 'SCENARIO',
      scenario_id: created.body.data.scenario_id, expected_revision: 1 } });
    expect(response.status).toBe(202); job = response.body.data;
  } finally { process.env.SCENARIO_ENGINE_VERSION = previousVersion; }
  const leases = require('../../src/services/scenario-lease.service');
  const claim = await leases.claimNext(db, { workerId: 'boundary-fixture', engineVersion: job.engine_version, contractVersion: job.contract_version });
  expect(claim.id).toBe(job.job_id);
  // Preserve the intentionally distinct storage-only version so unrelated
  // queued authorization fixtures cannot be claimed. The callable receives its
  // actual engine pins; this fixture is not a production compatibility test.
  const input = require('../../src/services/scenario-engine.adapter').requestForJob(claim, 30000);
  input.contract_version = 'scenario-engine:1.0'; input.engine_version = 'scenario-evaluator:1.0.0'; input.sampling.version = 'scenario-crn:1';
  const { execFileSync } = require('node:child_process');
  const result = JSON.parse(execFileSync(require('../../src/services/operations-contract.service').pythonExecutable(),
    ['-m', 'domain.scenarios.worker'], {cwd: require('node:path').resolve(__dirname, '../../../ai_services'),
      input: JSON.stringify(input), encoding: 'utf8', windowsHide: true, timeout: 30000}));
  const hash = contentHash(result);
  await leases.fenced(db, claim, async tx => {
    for (const [index, evaluated] of [result.baseline, result.scenario].entries()) {
      await tx.$executeRaw`UPDATE scenario_points SET status=${evaluated.outcome},result_json=${JSON.stringify(evaluated)}::jsonb,
        result_hash=${contentHash(evaluated)},completed_at=clock_timestamp() WHERE job_id=${job.job_id}::uuid AND point_index=${index}`;
    }
    await tx.$executeRaw`UPDATE scenario_attempts SET status='SUCCEEDED',completed_at=clock_timestamp() WHERE job_id=${job.job_id}::uuid AND attempt=${claim.attempt}`;
    await tx.$executeRaw`UPDATE scenario_jobs SET status='SUCCEEDED',result_json=${JSON.stringify(result)}::jsonb,
      result_hash=${hash},completed_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,worker_id=NULL WHERE id=${job.job_id}::uuid`;
  });
  return { source, w, job };
}
test('weights-only LIVE handoff creates a new pending case with immutable provenance, no recommendation or publication', async () => {
  const { source, w, job } = await completedBoundaryRun();
  const before = await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } });
  const key = randomUUID(), body = { source_run_id: job.job_id, confirmation: true,
    expected_head: { snapshot_id: before.snapshotId, plan_version: before.planVersion, revision: before.revision } };
  const options = { method: 'POST', key, user: f.users.MANAGER, body };
  const response = await f.http(`${path(w)}/live-evaluations`, options);
  expect(response.status).toBe(201);
  expect(response.body.data.decision_case_id).not.toBe(job.job_id);
  const created = await db.decisionCase.findUnique({ where: { id: response.body.data.decision_case_id }, include: { recommendation: true, humanDecision: true, commit: true } });
  expect(created).toMatchObject({ mode: 'LIVE', status: 'CREATED', processingStatus: 'PENDING', actorId: f.users.MANAGER.id,
    recommendation: null, humanDecision: null, commit: null, snapshotId: before.snapshotId, basePlanVersion: before.planVersion });
  expect(created.requestJson.request.trigger.type).toBe('MANUAL_REPLAN');
  expect(created.requestJson.request.planning_config.objective_weights).toEqual(example.planning_config.objective_weights);
  const [link] = await db.$queryRaw`SELECT * FROM scenario_live_evaluations WHERE case_id=${created.id}::uuid`;
  expect(link.run_id).toBe(job.job_id);
  expect(link.input_hash).toBe(job.input_hash);
  const event = await db.decisionCaseEvent.findFirst({ where: { caseId: created.id, sequence: 1 } });
  expect(event.payloadJson.source_scenario.run_id).toBe(job.job_id);
  const events = await f.http(`/decision-cases/${created.id}/events`, { user: f.users.VIEWER });
  expect(events.status).toBe(200);
  expect(events.body.data[0].payload.source_scenario).toEqual(event.payloadJson.source_scenario);
  // Replay does not depend on Python/engine availability and creates no second case.
  const python = process.env.OPERATIONS_PYTHON;
  try {
    process.env.OPERATIONS_PYTHON = 'nonexistent-scenario-validator';
    const replay = await f.http(`${path(w)}/live-evaluations`, options);
    expect(replay.body).toEqual(response.body); expect(replay.replay).toBe('true');
  } finally { process.env.OPERATIONS_PYTHON = python; }
  expect(await db.decisionCase.count({ where: { factoryId: source.factory_id } })).toBe(1);
  expect(await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } })).toEqual(before);
  await expect(db.$executeRaw`DELETE FROM scenario_live_evaluations WHERE case_id=${created.id}::uuid`).rejects.toThrow();
});
test.each([
  ['revoke before new handoff', false, false],
  ['revoke before LIVE replay', false, true],
  ['LIVE replay before revoke', true, true],
])('coordinated %s checks access before returning a LIVE receipt', async (_name, writeFirst, replay) => {
  const { source, w, job } = await completedBoundaryRun();
  const head = await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } });
  const options = { method: 'POST', user: f.users.OTHER, key: randomUUID(), body: {
    source_run_id: job.job_id, confirmation: true,
    expected_head: { snapshot_id: head.snapshotId, plan_version: head.planVersion, revision: head.revision },
  } };
  const handoff = () => f.http(`${path(w)}/live-evaluations`, options);
  const revoke = () => f.member(source.factory_id, f.users.OTHER, 'DELETE');
  const original = replay ? await handoff() : null;
  if (original) expect(original.status).toBe(201);
  let unlock, ready;
  const released = new Promise(resolve => { unlock = resolve; });
  const acquired = new Promise(resolve => { ready = resolve; });
  const gate = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${source.factory_id},0))::text`;
    ready();
    await released;
  }, { timeout: 20000 });
  let first, second;
  try {
    await Promise.race([acquired, gate]);
    first = writeFirst ? handoff() : revoke();
    await waitForFactoryWaiters(source.factory_id, 1);
    second = writeFirst ? revoke() : handoff();
    await waitForFactoryWaiters(source.factory_id, 2);
  } finally { unlock(); await gate; }
  const responses = await Promise.all([first, second]);
  expect(responses[writeFirst ? 1 : 0].status).toBe(200);
  const result = responses[writeFirst ? 0 : 1];
  expect(result.status).toBe(writeFirst ? 201 : 404);
  if (writeFirst) { expect(result.body).toEqual(original.body); expect(result.replay).toBe('true'); }
  expect((await handoff()).status).toBe(404);
  expect(await db.decisionCase.count({ where: { factoryId: source.factory_id } })).toBe(replay ? 1 : 0);
  const [counts] = await db.$queryRaw`SELECT
    (SELECT count(*)::int FROM scenario_live_evaluations WHERE workspace_id=${w.workspace_id}::uuid) AS links,
    (SELECT count(*)::int FROM scenario_events WHERE workspace_id=${w.workspace_id}::uuid AND type='LIVE_EVALUATION_CREATED') AS events,
    (SELECT count(*)::int FROM scenario_command_receipts WHERE workspace_id=${w.workspace_id}::uuid AND key=${options.key}) AS receipts`;
  expect(counts).toEqual({ links: replay ? 1 : 0, events: replay ? 1 : 0, receipts: replay ? 1 : 0 });
  expect(await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } })).toEqual(head);
});

test('LIVE handoff rejects stale context, incomplete runs, foreign IDs, absent confirmation and forbidden roles', async () => {
  const { source, w, job } = await completedBoundaryRun();
  const head = await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } });
  const body = { source_run_id: job.job_id, confirmation: true,
    expected_head: { snapshot_id: head.snapshotId, plan_version: head.planVersion, revision: head.revision } };
  const post = (value, user = f.users.MANAGER) => f.http(`${path(w)}/live-evaluations`, { method: 'POST', body: value, user });
  expect((await post({ ...body, confirmation: false })).status).toBe(400);
  expect((await post(body, f.users.OPERATOR)).status).toBe(403);
  expect((await post({ ...body, source_run_id: randomUUID() })).status).toBe(404);
  let queued;
  const version = process.env.SCENARIO_ENGINE_VERSION;
  try {
    process.env.SCENARIO_ENGINE_VERSION = job.engine_version;
    queued = await f.http(`${path(w)}/runs`, { method: 'POST', body: { kind: 'BASELINE' } });
    expect(queued.status).toBe(202);
  } finally { process.env.SCENARIO_ENGINE_VERSION = version; }
  expect((await post({ ...body, source_run_id: queued.body.data.job_id })).body.error.code).toBe('SCENARIO_RUN_NOT_READY');
  const observed = { ...structuredClone(source), snapshot_id: 'live-S2-' + randomUUID() };
  await require('../../src/services/operations-snapshot.service').ingestFactorySnapshot({ factoryId: source.factory_id,
    expectedHeadRevision: head.revision, snapshot: observed, sourceId: 'live-handoff-stale-test' }, db);
  expect((await post(body)).body.error.code).toBe('SCENARIO_HEAD_CONFLICT');
  const current = await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } });
  expect((await post({ ...body, expected_head: { snapshot_id: current.snapshotId, plan_version: current.planVersion, revision: current.revision } })).body.error.code).toBe('SCENARIO_HEAD_CONFLICT');
  expect(await db.decisionCase.count({ where: { factoryId: source.factory_id } })).toBe(0);
});

test.each(['MAINTENANCE_DURATION', 'TECHNICIAN_UNAVAILABLE'])('LIVE rejects unsupported %s without writing a case or receipt', async type => {
  const { source, w, job } = await completedBoundaryRun(snapshot => type === 'TECHNICIAN_UNAVAILABLE'
    ? [{ type, technician_id: snapshot.technicians[0].technician_id, start_at: snapshot.planning_window.start_at, end_at: snapshot.planning_window.end_at }]
    : [{ type, maintenance_request_id: snapshot.maintenance_requests[0].maintenance_request_id,
      ...(type === 'MAINTENANCE_DURATION' ? { expected_duration_minutes: 90 } : { earliest_start_at: snapshot.planning_window.start_at }) }]);
  const head = await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } }), key = randomUUID();
  const response = await f.http(`${path(w)}/live-evaluations`, { method: 'POST', key, body: { source_run_id: job.job_id, confirmation: true,
    expected_head: { snapshot_id: head.snapshotId, plan_version: head.planVersion, revision: head.revision } } });
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('SCENARIO_LIVE_MAPPING_UNSUPPORTED');
  expect(await db.decisionCase.count({ where: { factoryId: source.factory_id } })).toBe(0);
  expect(await db.$queryRaw`SELECT key FROM scenario_command_receipts WHERE workspace_id=${w.workspace_id}::uuid AND key=${key}`).toHaveLength(0);
});

test('LIVE case, provenance and receipt roll back if the audit write fails', async () => {
  const { source, w, job } = await completedBoundaryRun();
  const head = await db.operationsHead.findUnique({ where: { factoryId: source.factory_id } }), key = randomUUID();
  await db.$executeRawUnsafe("CREATE FUNCTION scenario_test_fail_live_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced LIVE audit failure'; END $$");
  await db.$executeRawUnsafe("CREATE TRIGGER scenario_test_fail_live_event BEFORE INSERT ON scenario_events FOR EACH ROW WHEN (NEW.type='LIVE_EVALUATION_CREATED') EXECUTE FUNCTION scenario_test_fail_live_event()");
  try {
    const response = await f.http(`${path(w)}/live-evaluations`, { method: 'POST', key, body: { source_run_id: job.job_id, confirmation: true,
      expected_head: { snapshot_id: head.snapshotId, plan_version: head.planVersion, revision: head.revision } } });
    expect(response.status).toBe(500);
    expect(await db.decisionCase.count({ where: { factoryId: source.factory_id } })).toBe(0);
    expect(await db.$queryRaw`SELECT case_id FROM scenario_live_evaluations WHERE workspace_id=${w.workspace_id}::uuid`).toHaveLength(0);
    expect(await db.$queryRaw`SELECT key FROM scenario_command_receipts WHERE workspace_id=${w.workspace_id}::uuid AND key=${key}`).toHaveLength(0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER scenario_test_fail_live_event ON scenario_events');
    await db.$executeRawUnsafe('DROP FUNCTION scenario_test_fail_live_event()');
  }
});
