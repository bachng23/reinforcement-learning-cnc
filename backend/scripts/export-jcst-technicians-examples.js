const fs = require('node:fs');
const path = require('node:path');
const { present } = require('../src/research/demo-technician-state');
const fixture = require('../examples/demo-work-orders-trace.json').snapshots;
const eventId = '10000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
const p = structuredClone(fixture.beforeApproval);
const sessionId = '10000000-0000-4000-8000-000000000003';
p.technicianAvailability = { schemaVersion: 'jcst-technician-availability/1', version: 1,
  absences: [{ eventId, automaticEndEventId: '10000000-0000-4000-8000-000000000004', technicianIndex: 0,
    startTick: 5, returnTick: 8, endedTick: null, endedByEventId: null }],
  events: [{ eventId, technicianIndex: 0, type: 'ABSENCE_STARTED', tick: 5, actor: { type: 'USER', userId: actorId }, reason: 'Short break' }],
  origin: { eventId, tick: 5, workforceVersion: 1 } };
const envelope = payloadJson => ({ success: true, data: present({ id: sessionId, revision: 11, payloadJson }) });
const output = { evidence: 'M0_CONTRACT_EXAMPLES_NOT_RUNTIME_ACCEPTANCE', startRequest: { revision: 10, durationTicks: 3, reason: 'Short break' },
  returnRequest: { revision: 11, reason: 'Returned early' }, AVAILABLE: envelope(fixture.beforeApproval), BUSY: envelope(fixture.inProgress), ABSENT: envelope(p),
  event: p.technicianAvailability.events[0] };
const file = path.resolve(__dirname, '../docs/jcst-technicians-examples.json'), text = JSON.stringify(output, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text) throw Error('Technician examples need regeneration');
} else fs.writeFileSync(file, text);
