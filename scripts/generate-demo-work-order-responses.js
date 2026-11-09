const fs = require('node:fs');
const path = require('node:path');
const { project, present } = require('../backend/src/research/demo-work-orders');
const { snapshots } = require('../backend/examples/demo-work-orders-trace.json');
const id = '00000000-0000-4000-8000-000000000001';
const responses = {};
let projection = null;
for (const [index, [name, payloadJson]] of Object.entries(snapshots).entries()) {
  projection = project(id, payloadJson, projection, index ? { name: 'approve', fromTick: index === 1 ? 5 : 6 } : null);
  responses[name] = { success: true, data: present({ id, revision: index, payloadJson, workOrdersJson: projection }, { machineIndex: 2 }) };
}
fs.writeFileSync(path.join(__dirname, '../backend/examples/demo-work-orders.json'), JSON.stringify(responses, null, 2) + '\n');
