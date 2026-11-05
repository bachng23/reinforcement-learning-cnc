const { execFileSync } = require('node:child_process');
const path = require('node:path');
test('Scenario populated upgrade from exact c926d5d preserves all existing tables and canonical history', () => {
  const output = execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/check-scenario-upgrade.js')], {
    cwd: path.resolve(__dirname, '../..'), env: process.env, encoding: 'utf8', timeout: 120000,
  });
  expect(output).toContain('"base":"c926d5d24566834850cf4a16af0792af9c7d50fd"');
  expect(output).toContain('"unchanged":true');
  for (const table of ['factory_snapshots', 'operation_schedules', 'decision_cases', 'decision_commits',
    'decision_case_idempotency_receipts', 'work_orders', 'work_order_events', 'work_order_completions', 'scenario_jobs'])
    expect(output).toContain(`"${table}"`);
}, 130000);
