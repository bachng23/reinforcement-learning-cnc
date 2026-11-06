const fs = require('node:fs'),
  path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const url = new URL(process.env.TEST_DATABASE_URL || '');
url.searchParams.set('schema', 'analytics_bench_' + randomUUID().replaceAll('-', ''));
const root = path.resolve(__dirname, '../..');
const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Cannot resolve benchmark source SHA');
const directory = path.join(root, 'artifacts', 'maintenance-analytics', sha);
fs.mkdirSync(directory, { recursive: true });
const report = path.join(directory, 'benchmark-' + randomUUID() + '.json');
const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'benchmark-maintenance-analytics.js'), report],
  {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;
