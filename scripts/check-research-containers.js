// Disposable production-image smoke: API + worker + frontend proxy + PostgreSQL.
// Uses only uniquely named resources created here, always removed on completion.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const suffix = crypto.randomBytes(5).toString('hex');
const network = `jcst-smoke-${suffix}`, volume = `${network}-artifacts`;
const db = `${network}-db`, api = `${network}-api`, worker = `${network}-worker`, web = `${network}-web`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 4e6 });
const names = [];
const dbUrl = `postgresql://jcst_test:jcst_test@${db}:5432/jcst_test`;
const env = ['-e', `DATABASE_URL=${dbUrl}`, '-e', 'RESEARCH_ARTIFACT_DIR=/research-artifacts'];
const backend = process.env.JCST_BACKEND_IMAGE || 'cnc-jcst-backend:test';
const frontend = process.env.JCST_FRONTEND_IMAGE || 'cnc-jcst-frontend:test';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let n = 0; n < 60; n++) { try { if (await fn()) return; } catch {} await sleep(500); }
  throw new Error(`${label} did not become ready`);
}
async function main() {
  docker('network', 'create', network); docker('volume', 'create', volume);
  names.push(db); docker('run', '-d', '--name', db, '--network', network, '-e', 'POSTGRES_USER=jcst_test', '-e', 'POSTGRES_PASSWORD=jcst_test', '-e', 'POSTGRES_DB=jcst_test', 'postgres:16-alpine');
  await until(() => { docker('exec', db, 'pg_isready', '-U', 'jcst_test'); return true; }, 'PostgreSQL');
  docker('run', '--rm', '--network', network, ...env, backend, 'node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy');
  docker('run', '--rm', '--network', network, ...env, backend, 'node', '-e',
    "const p=require('./src/config/prisma');require('bcrypt').hash('container-smoke-password',4).then(passwordHash=>p.user.create({data:{username:'container-smoke',passwordHash,role:'ADMIN'}})).finally(()=>p.$disconnect())");
  names.push(api); docker('run', '-d', '--name', api, '--network', network, '--network-alias', 'research_api', ...env, '-v', `${volume}:/research-artifacts`, '-e', 'JWT_SECRET=jcst-container-test-only-secret-at-least-32-characters', '-e', 'CLIENT_URL=http://localhost:3000', backend, 'node', 'src/server.js');
  names.push(worker); docker('run', '-d', '--name', worker, '--network', network, ...env, '-v', `${volume}:/research-artifacts`, backend, 'node', 'src/research/worker.js');
  names.push(web); docker('run', '-d', '--name', web, '--network', network, '-p', '127.0.0.1::3000', frontend);
  const port = docker('port', web, '3000').trim().split(':').at(-1);
  const base = `http://127.0.0.1:${port}`;
  await until(async () => (await fetch(`${base}/login`)).ok, 'production frontend');
  const login = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'container-smoke', password: 'container-smoke-password' }) });
  assert.equal(login.status, 200, 'same-origin proxy login');
  const cookie = login.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie, 'session cookie');
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const capabilities = await fetch(`${base}/api/v1/research/capabilities`, { headers });
  assert.equal(capabilities.status, 200); assert.equal((await capabilities.json()).data.simulator_version, 'JCST/1.1');
  const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/jcst/v1/fixtures/engineering-bundle.json'), 'utf8'));
  const queued = await fetch(`${base}/api/v1/research/imports`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': `smoke-${suffix}` }, body: JSON.stringify({ bundle }) });
  assert.equal(queued.status, 202); const job = (await queued.json()).data;
  let completed;
  await until(async () => { completed = (await (await fetch(`${base}/api/v1/research/jobs/${job.id}`, { headers })).json()).data; return ['SUCCEEDED', 'FAILED'].includes(completed.status); }, 'container worker import');
  assert.equal(completed.status, 'SUCCEEDED', completed.errorCode || 'worker result');
  const campaign = (await (await fetch(`${base}/api/v1/research/campaigns/${completed.outputJson.campaignId}`, { headers })).json()).data;
  assert.equal(campaign.runs[0].physicalReplayJson[0].status, 'PASS');
  assert.equal(campaign.runs[0].episodes.length, 1);
  const source = campaign.runs[0].episodes[0];
  const branchResponse = await fetch(`${base}/api/v1/research/branches`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': `branch-${suffix}` }, body: JSON.stringify({
    episode_id: source.id, tick: 0, action: [], reason: 'Production-container matched-baseline verification', expected_episode_hash: source.contentHash, controller: 'risk',
  }) });
  assert.equal(branchResponse.status,202); const branchJob=(await branchResponse.json()).data;
  let branch;
  await until(async()=>{branch=(await(await fetch(`${base}/api/v1/research/jobs/${branchJob.id}`,{headers})).json()).data;return ['SUCCEEDED','FAILED'].includes(branch.status);},'matched branch');
  assert.equal(branch.status,'SUCCEEDED',branch.errorCode || 'branch result');
  assert.equal(branch.outputJson.deltaTotalCost,0,'identical WAIT vs risk baseline at tick zero');
  assert.equal(branch.outputJson.baselineAudit.status,'PASS');
  const {sha,canonical}=require('../backend/src/research/artifact-store');
  const review=await fetch(`${base}/api/v1/research/jobs/${branch.id}/review`,{method:'POST',headers,body:JSON.stringify({decision:'ACCEPT',reason:'Container simulation verification only',expected_output_hash:sha(canonical(branch.outputJson))})});
  assert.equal(review.status,201,'immutable management review');
  assert.equal((await fetch(`${base}/research`)).status, 200);
  console.log(JSON.stringify({ status: 'PASS', checks: ['production frontend', 'same-origin session proxy', 'packaged Python bridge', 'fresh migrations', 'shared artifact volume', 'separate worker import', 'independent physical replay', 'matched-baseline branch', 'immutable review'] }));
}
main().catch(error => {
  for (const name of names.filter(n => n !== db)) { try { console.error(docker('logs', '--tail', '20', name)); } catch {} }
  console.error(error.message); process.exitCode = 1;
}).finally(() => {
  for (const name of names.reverse()) { try { docker('rm', '-f', '-v', name); } catch {} }
  try { docker('volume', 'rm', volume); } catch {} try { docker('network', 'rm', network); } catch {}
});
