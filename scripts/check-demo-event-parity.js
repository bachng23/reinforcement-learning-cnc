// Explicit cross-branch check; requires the Backend 1 commit fetched locally.
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { project } = require('../backend/src/research/demo-work-orders');
const { snapshots } = require('../backend/examples/demo-work-orders-trace.json');
const root = path.resolve(__dirname, '..');
const ref = process.argv[2] || 'origin/feat/jcst-machine-health';
const sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const source = execFileSync('git', ['show', `${sha}:backend/src/research/demo-health.js`], { cwd: root, encoding: 'utf8' });
const filename = path.join(root, 'backend/src/research/demo-health-parity-only.js');
const other = new Module(filename, module);
other.filename = filename;
other.paths = Module._nodeModulePaths(path.dirname(filename));
other._compile(source, filename);
let checked = 0;
for (const [name, payloadJson] of Object.entries(snapshots)) {
  const row = { id: 'd549829e-27cc-4f33-855e-100000000001', revision: 7, payloadJson };
  const projection = project(row.id, payloadJson);
  for (let m = 0; m < payloadJson.config.components.length; m++) {
    const health = other.exports.projectHealth(row, m);
    for (const order of Object.values(projection.orders).filter(o => o.machineIndex === m)) {
      for (const [field, type] of [['startEventId', 'start'], ['completionEventId', 'completion'], ['failureEventId', 'failure']]) {
        if (order[field] === null) continue;
        const event = health.history.events.find(e => e.eventId === order[field]);
        assert.ok(event, `${name}: ${field} missing from Backend 1`);
        assert.equal(event.type, type);
        assert.equal(event.componentIndex, order.componentIndex);
        checked++;
      }
    }
  }
}
assert.ok(checked > 0);
console.log(JSON.stringify({ status: 'PASS', backend1Sha: sha, snapshots: Object.keys(snapshots).length, matchedReferences: checked }));
