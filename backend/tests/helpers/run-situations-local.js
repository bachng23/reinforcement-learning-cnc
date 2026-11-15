// Starts only a task-owned loopback PostgreSQL cluster. Does not read .env or
// connect to the developer DB. The usual runner owns/cleans isolated schemas.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync, spawn } = require('node:child_process');
async function main() {
  const bin = process.env.SITUATIONS_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jcst-situations-pg-'));
  const data = path.join(temp, 'data');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const run = (name, args) => {
    // Windows pg_ctl's server child can inherit pipe handles. It must not keep
    // spawnSync waiting for EOF after the server has already become ready.
    const r = spawnSync(path.join(bin, name + suffix), args, { encoding: 'utf8', stdio: name === 'pg_ctl' ? 'ignore' : 'pipe' });
    if (r.status !== 0) throw Error(name + ': ' + r.stderr); return r.stdout;
  };
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  let started = false, child, runtime;
  const stop = () => {
    if (started) { run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']); started = false; }
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { child?.kill(); try { stop(); } finally { process.exit(130); } });
  try {
    run('initdb', ['-D', data, '-U', 'situations_test', '--auth=trust', '--encoding=UTF8', '--no-locale']);
    fs.appendFileSync(path.join(data, 'postgresql.conf'), `\nlisten_addresses='127.0.0.1'\nport=${port}\nmax_connections=30\n`);
    run('pg_ctl', ['-D', data, '-l', path.join(temp, 'postgres.log'), '-w', 'start']); started = true;
    run('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'situations_test', 'jcst_situations_test']);
    const env = { ...process.env, TEST_DATABASE_URL: `postgresql://situations_test@127.0.0.1:${port}/jcst_situations_test`,
      OPERATIONS_SCHEMA_JOURNAL: path.join(temp, 'schemas.jsonl'), FACTORY_ACCESS_SOURCE: 'database' };
    if (process.argv.includes('--regression')) {
      runtime = require('./machine-health-runtime').runtime();
      env.JCST_BRIDGE_SCRIPT = runtime.script;
      env.JCST_PYTHON ||= path.resolve(__dirname, '../../../ai_services/.venv/Scripts/python.exe');
    }
    const args = ['tests/integration/run-integration-tests.js', ...(process.argv.includes('--all') ? [] : [process.argv.includes('--regression') ? '--demo-regression' : '--demo-situations'])];
    child = spawn(process.execPath, args, { cwd: path.resolve(__dirname, '../..'), env, stdio: 'inherit' });
    const status = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    process.exitCode = status ?? 1;
  } finally {
    stop();
    runtime?.close();
    // Keep failures for diagnosis; remove only our checked mkdtemp path on pass.
    if (process.exitCode) console.error('Task-owned PostgreSQL logs retained: ' + temp);
    else if (path.dirname(path.resolve(temp)) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith('jcst-situations-pg-'))
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
