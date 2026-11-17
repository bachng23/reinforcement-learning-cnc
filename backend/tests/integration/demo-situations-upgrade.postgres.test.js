const { execFileSync } = require('node:child_process');
const path = require('node:path');
test('populated exact main upgrade preserves runtime payloads, schedules, hashes and migration history', () => {
  const output = execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/check-demo-situations-upgrade.js')], {
    cwd: path.resolve(__dirname, '../..'), env: process.env, encoding: 'utf8', timeout: 120000,
  });
  expect(output).toContain('"base":"30a27f820e511567f7fad8199f123f75646cd9f3"');
  expect(output).toContain('"unchanged":true'); expect(output).toContain('"migrationHistoryUnchanged":true');
}, 130000);
