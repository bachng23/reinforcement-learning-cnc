const fs = require('node:fs');
const path = require('node:path');
const { projectHealth } = require('../../src/research/demo-health');
const root = path.resolve(__dirname, '../fixtures/machine-health');
const source = require(path.join(root, 'source.json'));
for (const tick of [5, 6, 7]) {
  fs.writeFileSync(path.join(root, `t${tick}.json`), JSON.stringify({ success: true, data: projectHealth(source.rows[tick], 2) }, null, 2) + '\n');
}
console.log('Exported machine health t5/t6/t7 frontend fixtures.');
