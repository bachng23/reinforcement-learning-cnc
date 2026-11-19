#!/usr/bin/env node
// Run on the integrated Backend + Frontend + Flex checkout. No API interception.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');
const abort = new AbortController();
const children = new Set();
process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());
const deadline = setTimeout(() => abort.abort(), 360000);
const schema = `product_api_it_situations_${randomBytes(8).toString('hex')}`;
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim();
const out = path.resolve(process.env.SITUATION_EVIDENCE_DIR || path.join(root, 'artifacts/situations-real', sha, schema));
fs.mkdirSync(out, { recursive: true });
const evidence = { sha, schema, status: 'RUNNING', checks: [], interceptedApi: false, cleanup: {} };
const checkpoint = () => fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
const passed = name => { evidence.checks.push({ name, status: 'PASS' }); checkpoint(); console.log(`PASS ${name}`); };
function child(args, cwd, env, name) {
  const fd = fs.openSync(path.join(out, `${name}.log`), 'a');
  const p = spawn(process.execPath, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', fd, fd] });
  fs.closeSync(fd); children.add(p);
  p.on('error', error => { p.launchError = error; });
  p.once('exit', () => children.delete(p));
  return p;
}
async function finished(p) {
  while (p.exitCode === null && p.signalCode === null) {
    abort.signal.throwIfAborted(); if (p.launchError) throw p.launchError;
    await delay(100);
  }
  assert.equal(p.exitCode, 0, 'Child failed; inspect evidence logs');
}
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const number = server.address().port;
  await new Promise(resolve => server.close(resolve)); return number;
}
async function assertPortClosed(number) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const open = await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port: number });
      socket.setTimeout(500);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
      socket.once('timeout', () => { socket.destroy(); resolve(true); });
    });
    if (!open) return;
    await delay(100);
  }
  throw new Error(`Owned service port ${number} remains open after cleanup`);
}
async function ready(url, p) {
  for (let i = 0; i < 180; i++) {
    abort.signal.throwIfAborted();
    if (p?.exitCode !== null && p?.exitCode !== undefined) throw new Error('Service exited before ready');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
    await delay(500);
  }
  throw new Error('Readiness timeout');
}
async function main() {
  if (!process.env.JCST_PYTHON || process.env.JCST_BRIDGE_SCRIPT) throw new Error('Explicit real JCST_PYTHON required; bridge doubles forbidden');
  const baseUrl = new URL(process.env.TEST_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(baseUrl.protocol) || !/_(test|ci)$/.test(baseUrl.pathname)) throw new Error('Dedicated TEST_DATABASE_URL ending _test/_ci required');
  const url = new URL(baseUrl); url.searchParams.set('schema', schema);
  const uiPort = await port();
  const ui = `http://127.0.0.1:${uiPort}`;
  Object.assign(process.env, { DATABASE_URL: url.toString(), NODE_ENV: 'test',
    JWT_SECRET: 'situation-test-only-signing-key-at-least-32-characters', CLIENT_URL: ui,
    OPERATIONS_FACTORY_ACCESS: '{}', RESEARCH_API_ENABLED: 'true' });
  let prisma, server, browser, context, next;
  const generatedConfig = ['next-env.d.ts', 'tsconfig.json'].map(name => {
    const file = path.join(frontend, name);
    return { file, original: fs.readFileSync(file) };
  });
  checkpoint();
  try {
    await finished(child(['node_modules/prisma/build/index.js', 'generate'], backend, process.env, 'prisma-generate'));
    await finished(child(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], backend, process.env, 'migrate'));
    prisma = require(path.join(backend, 'src/config/prisma'));
    const bcrypt = require(path.join(backend, 'node_modules/bcrypt'));
    const jwt = require(path.join(backend, 'node_modules/jsonwebtoken'));
    const user = await prisma.user.create({ data: { username: `situation-${randomUUID()}`, role: 'ENGINEER', passwordHash: await bcrypt.hash('Situation-Test-123!', 10) } });
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
    const app = require(path.join(backend, 'src/app'));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const api = `http://127.0.0.1:${server.address().port}`;
    evidence.apiPort = server.address().port; evidence.frontendPort = uiPort;
    async function request(route, body, key = randomUUID(), expected = body === undefined ? 200 : undefined) {
      abort.signal.throwIfAborted();
      const response = await fetch(`${api}/api/v1/research/demo${route}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(40000)]) });
      const json = await response.json();
      fs.appendFileSync(path.join(out, 'http.jsonl'), JSON.stringify({ route, status: response.status, code: json.error?.code }) + '\n');
      if (expected !== undefined) assert.equal(response.status, expected, JSON.stringify(json));
      else assert.ok(response.ok, JSON.stringify(json));
      return json.data;
    }
    const create = () => request('/sessions', { case: 'base', seed: '990000001', mode: 'policy', primary: 'corrective', baseline: 'wait', continuous: true });
    const save = (p, name) => request(`/sessions/${p.id}/snapshots`, { revision: p.revision, name, description: 'Real acceptance', layoutId: 'smt-board-assembly' });
    const open = snap => request(`/snapshots/${snap.snapshotId}/sessions`, { revision: snap.sourceRevision });
    const command = (p, command, fields = {}) => request(`/sessions/${p.id}/commands`, { revision: p.revision, command, ...fields });
    const inject = (p, when, key) => request(`/sessions/${p.id}/incidents`, { revision: p.revision, machineIndex: 2, componentIndex: 1, scheduledTick: when, reason: 'Real intervention' }, key);
    const healthy = await create(); const frozen = await save(healthy, 'Healthy acceptance');
    let a = await open(frozen), b = await open(frozen);
    assert.notEqual(a.id, b.id); assert.equal(a.branch.snapshotHash, b.branch.snapshotHash);
    assert.equal(a.playbackPaused, true);
    for (let i = 0; i < 3; i++) {
      a = await command(a, 'advance', { autoApprove: true }); b = await command(b, 'advance', { autoApprove: true });
      assert.deepEqual(a.primary, b.primary); assert.deepEqual(a.baseline, b.baseline);
    }
    passed('healthy snapshot exact replay through real API and PostgreSQL');
    let immediate = await open(frozen); const key = randomUUID();
    const first = await inject(immediate, 0, key), replay = await inject(immediate, 0, key);
    assert.deepEqual(first, replay); assert.equal(first.event.status, 'APPLIED');
    immediate = first.session; assert.equal(immediate.tick, 0);
    const health = await request(`/sessions/${immediate.id}/machines/2/health?expectedRevision=${immediate.revision}`);
    assert.ok(health.history.events.some(e => e.eventId === first.event.eventId && e.provenance === 'CONTROLLED_INCIDENT'));
    immediate = await command(immediate, 'advance'); assert.equal(immediate.status, 'REVIEW');
    await request(`/sessions/${immediate.id}/incidents`, { revision: immediate.revision, machineIndex: 0, componentIndex: 0, scheduledTick: 0, reason: 'Review must conflict' }, undefined, 409);
    const reviewSnapshot = await save(immediate, 'Review acceptance');
    const reopenedReview = await open(reviewSnapshot);
    assert.deepEqual(reopenedReview.pending, immediate.pending);
    immediate = await command(reopenedReview, 'approve', { reason: 'Approve CM' });
    assert.equal(immediate.primary.state.jobs[1].remaining, 1);
    const repair = await save(immediate, 'Repair acceptance');
    let repairA = await open(repair), repairB = await open(repair);
    assert.equal(repairA.primary.state.jobs[1].remaining, 1);
    repairA = await command(repairA, 'advance', { autoApprove: true });
    repairB = await command(repairB, 'advance', { autoApprove: true });
    assert.deepEqual(repairA.primary, repairB.primary);
    assert.equal(repairA.primary.state.jobs[1], null);
    const orders = await request(`/sessions/${repairA.id}/work-orders?machineIndex=2`);
    assert.ok(orders.items.some(o => o.status === 'COMPLETED' && o.failureEventId === first.event.eventId));
    passed('immediate injection, health event, REVIEW conflict, repair snapshot and completion');
    a = await open(frozen); b = await open(frozen);
    a = (await inject(a, 2)).session; b = (await inject(b, 2)).session;
    a = await command(await command(a, 'advance', { autoApprove: true }), 'advance', { autoApprove: true });
    b = await command(b, 'autoplay', { maxTicks: 2, stopAt: 'complete' });
    assert.deepEqual(a.primary, b.primary); assert.equal(a.incidents[0].appliedTick, 2);
    assert.equal((await request(`/sessions/${a.id}`)).incidents[0].status, 'APPLIED');
    passed('scheduled incident single-step/autoplay parity and reload');
    const before = await prisma.demoSnapshot.findUnique({ where: { id: frozen.snapshotId } });
    await request(`/snapshots/${frozen.snapshotId}`);
    assert.deepEqual(await prisma.demoSnapshot.findUnique({ where: { id: frozen.snapshotId } }), before);
    passed('immutable snapshot and read-only GET');
    const technicians = process.env.JCST_TECHNICIAN_ACCEPTANCE === '1';
    if (technicians) {
      let p = await open(frozen);
      const absenceKey = randomUUID();
      const absent = await request(`/sessions/${p.id}/technicians/0/absence`, { revision: p.revision, durationTicks: 3, reason: 'Three-step real acceptance' }, absenceKey);
      assert.equal(absent.tick, 0); assert.equal(absent.revision, p.revision + 1);
      assert.equal(absent.technicians[0].availability, 'ABSENT');
      assert.deepEqual(await request(`/sessions/${p.id}/technicians/0/absence`, { revision: p.revision, durationTicks: 3, reason: 'Three-step real acceptance' }, absenceKey), absent);
      p = absent.session;
      const readBefore = await prisma.demoSession.findUniqueOrThrow({ where: { id: p.id } });
      await request(`/sessions/${p.id}/technicians`);
      assert.deepEqual(await prisma.demoSession.findUniqueOrThrow({ where: { id: p.id } }), readBefore);
      const saved = await save(p, 'Absent real acceptance');
      let q = await open(saved), r = await open(saved);
      assert.deepEqual(q.technicianAvailability, r.technicianAvailability);
      q = (await inject(q, 0)).session;
      q = await command(q, 'advance');
      assert.equal(q.status, 'REVIEW');
      assert.ok(q.pending.action.length > 0);
      assert.ok(q.pending.catalogue.every(action => action.every(edge => edge[2] === 1)));
      await request(`/sessions/${q.id}/commands`, { revision: q.revision, command: 'override', action: [[2, 1, 0]], reason: 'Must not dispatch absent T1' }, undefined, 409);
      const returned = await request(`/sessions/${q.id}/technicians/0/return`, { revision: q.revision, reason: 'Early return at REVIEW' });
      assert.equal(returned.tick, q.tick); assert.equal(returned.session.pending, null);
      assert.equal(returned.session.status, 'RUNNING'); assert.equal(returned.revision, q.revision + 1);
      q = await command(returned.session, 'advance');
      assert.ok(q.pending.catalogue.some(action => action.some(edge => edge[2] === 0)));
      q = await command(q, 'approve', { reason: 'Dispatch real CM' });
      const busy = q.primary.state.jobs.findIndex(Boolean);
      assert.ok(busy >= 0);
      await request(`/sessions/${q.id}/technicians/${busy}/absence`, { revision: q.revision, durationTicks: 1, reason: 'Busy must conflict' }, undefined, 409);
      q = await command(q, 'advance', { autoApprove: true });
      assert.ok((await request(`/sessions/${q.id}/work-orders?machineIndex=2`)).items.some(o => o.status === 'COMPLETED'));
      for (let i = 0; i < 3; i++) r = await command(r, 'advance', { autoApprove: true });
      const ended = await request(`/sessions/${r.id}/technicians`);
      assert.equal(ended.technicians[0].availability, 'AVAILABLE');
      assert.equal(r.technicianAvailability.events.filter(e => e.type === 'ABSENCE_ENDED').length, 1);
      assert.equal(r.technicianAvailability.events.at(-1).actor.type, 'SYSTEM');
      assert.equal(r.technicianAvailability.events.at(-1).tick, 3);
      passed('real workforce API: zero-time absence, receipt/read-only, restore, masked proposal, REVIEW return, busy conflict, CM completion and exact expiry');
    }

    next = child(['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(uiPort)], frontend,
      { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_API_BASE_URL: api, NEXT_PUBLIC_SKIP_AUTH: 'false', NEXT_TELEMETRY_DISABLED: '1', CNC_BUILD_DIR: '.next-situation-real' }, 'frontend');
    await ready(ui + '/login', next);
    const { chromium, expect } = require(path.join(frontend, 'node_modules/@playwright/test'));
    browser = await chromium.launch(process.env.OPERATIONS_BROWSER_EXECUTABLE ? { executablePath: process.env.OPERATIONS_BROWSER_EXECUTABLE } : {});
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const login = await context.request.post(api + '/api/v1/auth/login', { data: { username: user.username, password: 'Situation-Test-123!' } });
    assert.equal(login.status(), 200);
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => fs.appendFileSync(path.join(out, 'browser-errors.log'), error.message + '\n'));
    await page.goto(`${ui}/simulation?session=${healthy.id}&workshop=smt-board-assembly`);
    await page.getByRole('button', { name: 'Save situation', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Situation name', exact: true }).fill('Browser healthy snapshot');
    await dialog.getByRole('button', { name: 'Save situation', exact: true }).click();
    await expect(dialog.getByText('Saved “Browser healthy snapshot”')).toBeVisible();
    const openedResponse = page.waitForResponse(r => /\/snapshots\/[^/]+\/sessions$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Open saved situation', exact: true }).click();
    const opened = (await (await openedResponse).json()).data;
    assert.notEqual(opened.id, healthy.id); assert.equal(opened.tick, 0);
    await expect(page.getByRole('button', { name: 'Run simulator', exact: true })).toBeEnabled();
    if (technicians) {
      await page.getByRole('button', { name: '2D', exact: true }).click();
      await page.getByRole('button', { name: 'Inspect technician T1', exact: true }).click();
      const panel = page.getByRole('complementary', { name: 'Technician T1 details' });
      await panel.getByRole('button', { name: 'Mark temporarily absent', exact: true }).click();
      await panel.getByLabel('Absence duration', { exact: true }).fill('3');
      await panel.getByLabel('Availability reason (optional)', { exact: true }).fill('Real browser absence');
      const response = page.waitForResponse(r => r.url().endsWith(`/sessions/${opened.id}/technicians/0/absence`) && r.request().method() === 'POST');
      await panel.getByRole('button', { name: 'Confirm temporary absence', exact: true }).click();
      const result = (await (await response).json()).data;
      assert.equal(result.tick, 0); assert.equal(result.technicians[0].availability, 'ABSENT');
      await expect(panel.getByText('Temporarily absent', { exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(out, 'browser-real-absence.png'), fullPage: true });
    }
    await page.goto(`${ui}/simulation?session=${opened.id}&machine=2&inspect=1&workshop=smt-board-assembly`);
    await page.getByRole('button', { name: 'Create incident', exact: true }).click();
    await page.getByLabel('Incident component').selectOption('1');
    await page.getByLabel('Incident note', { exact: true }).fill('Browser real incident');
    const incidentResponse = page.waitForResponse(r => r.url().endsWith(`/sessions/${opened.id}/incidents`) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create injected incident', exact: true }).click();
    const injected = (await (await incidentResponse).json()).data;
    assert.equal(injected.event.status, 'APPLIED'); assert.equal(injected.session.tick, 0);
    await page.screenshot({ path: path.join(out, 'browser-injected.png'), fullPage: true });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Run simulator', exact: true })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Injected incidents', exact: true }).first().getByText('Injected incident · APPLIED', { exact: true })).toBeVisible();
    const reloaded = await request(`/sessions/${opened.id}`);
    assert.equal(reloaded.incidents.length, 1); assert.equal(reloaded.incidents[0].eventId, injected.event.eventId);
    await page.screenshot({ path: path.join(out, 'browser-reloaded.png'), fullPage: true });
    passed('real Chromium: authenticated save/open paused, immediate incident and reload');
    if (technicians) {
      const uiCommand = async (label) => {
        const response = page.waitForResponse(r => r.url().endsWith(`/sessions/${opened.id}/commands`) && r.request().method() === 'POST');
        await page.getByRole('button', { name: label, exact: true }).click();
        const received = await response; assert.ok(received.ok(), await received.text());
        return (await received.json()).data;
      };
      const proposal = await uiCommand('View dispatch proposal');
      assert.equal(proposal.status, 'REVIEW');
      assert.ok(proposal.pending.catalogue.every(action => action.every(edge => edge[2] === 1)));
      const dispatched = await uiCommand('Approve & dispatch');
      assert.equal(dispatched.tick, 1); assert.equal(dispatched.primary.state.jobs[1].remaining, 1);
      await page.goto(`${ui}/simulation?session=${opened.id}&technician=0&workshop=smt-board-assembly`);
      const panel = page.getByRole('complementary', { name: 'Technician T1 details' });
      await panel.getByRole('button', { name: 'Return now', exact: true }).click();
      await panel.getByLabel('Availability reason (optional)', { exact: true }).fill('Real browser early return');
      const response = page.waitForResponse(r => r.url().endsWith(`/sessions/${opened.id}/technicians/0/return`) && r.request().method() === 'POST');
      await panel.getByRole('button', { name: 'Confirm return now', exact: true }).click();
      const returned = (await (await response).json()).data;
      assert.equal(returned.tick, 1); assert.equal(returned.technicians[0].availability, 'AVAILABLE');
      await expect(panel.getByText('Ready for assignment', { exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(out, 'browser-real-return.png'), fullPage: true });
      await panel.getByRole('button', { name: 'Close technician panel', exact: true }).click();
      let completed = await uiCommand('Step');
      if (completed.status === 'REVIEW') {
        await page.goto(`${ui}/decisions?session=${opened.id}&workshop=smt-board-assembly`);
        completed = await uiCommand('Continue without dispatch');
      }
      assert.equal(completed.tick, 2); assert.equal(completed.primary.state.jobs[1], null);
      assert.ok((await request(`/sessions/${opened.id}/work-orders?machineIndex=2`)).items.some(o => o.status === 'COMPLETED'));
      passed('real Chromium workforce journey: absence, masked proposal, CM dispatch, early return and repair completion');
    }
    evidence.status = 'PASS';
  } finally {
    if (context) { await context.tracing.stop({ path: path.join(out, 'browser-trace.zip') }).catch(() => {}); await context.close().catch(() => {}); }
    if (browser) await browser.close().catch(() => {});
    for (const p of children) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else { try { process.kill(-p.pid, 'SIGKILL'); } catch {} }
    }
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (prisma) await prisma.$disconnect();
    const { PrismaClient } = require(path.join(backend, 'node_modules/@prisma/client'));
    const cleanup = new PrismaClient({ datasourceUrl: baseUrl.toString() });
    try {
      assert.match(schema, /^product_api_it_situations_[a-f0-9]{16}$/);
      await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      evidence.cleanup.schema = 'DROPPED';
    } finally { await cleanup.$disconnect(); }
    for (const number of [evidence.apiPort, evidence.frontendPort].filter(Boolean)) await assertPortClosed(number);
    for (const { file, original } of generatedConfig) fs.writeFileSync(file, original);
    evidence.cleanup.services = 'STOPPED'; evidence.cleanup.ports = 'CLOSED'; checkpoint();
  }
}
main().catch(error => { evidence.status = 'FAILED'; evidence.error = error.message; checkpoint(); console.error(error); process.exitCode = 1; })
  .finally(() => { clearTimeout(deadline); console.log(out); });
