const { execFileSync } = require('node:child_process');
const path = require('node:path');
test('exact merged #50/#51 populated upgrade preserves every source/workflow/access table', () => {
  const output = execFileSync(
    process.execPath,
    [path.resolve(__dirname, '../../scripts/check-maintenance-analytics-upgrade.js')],
    {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, TEST_DATABASE_URL: process.env.DATABASE_URL },
      encoding: 'utf8',
      timeout: 120000,
    },
  );
  expect(output).toContain('"unchanged":true');
  expect(output).toContain('"work_order_events"');
  expect(output).toContain('"work_order_completions"');
  expect(output).toContain('"work_order_command_receipts"');
}, 130000);
