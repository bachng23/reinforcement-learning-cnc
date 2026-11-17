const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('../examples/demo-work-orders-trace.json').snapshots;
const sessionId = '10000000-0000-4000-8000-000000000001';
const snapshotId = '10000000-0000-4000-8000-000000000002';
const actor = '10000000-0000-4000-8000-000000000003';
const metadata = { snapshotId, schemaVersion: 'jcst-demo-snapshot/1', sourceSessionId: sessionId,
  sourceRevision: 14, sourceTick: 7, sourceCommit: fixtures.completed.source_commit,
  snapshotHash: 'a'.repeat(64), name: 'Maintenance exercise', description: 'Training situation',
  layoutId: 'smt-board-assembly', createdAt: '2026-11-16T00:00:00.000Z', sessionId, revision: 14, tick: 7 };
const summary = p => ({ caseId: p.case_id, seed: p.physical_seed, status: p.status,
  primary: p.primary.controller, baseline: p.baseline.controller,
  machineCount: p.primary.state.components.length, technicianCount: p.primary.state.jobs.length });
const event = { eventId: '10000000-0000-4000-8000-000000000004', machineIndex: 2,
  componentIndex: 1, scheduledTick: 7, status: 'APPLIED', appliedTick: 7, reason: null,
  requestedReason: 'Controlled training failure', createdBy: actor, createdAt: metadata.createdAt };
const output = {
  evidence: 'CONTRACT_EXAMPLES_NOT_RUNTIME_ACCEPTANCE',
  saveRequest: { revision: 14, name: metadata.name, description: metadata.description, layoutId: metadata.layoutId },
  healthySnapshot: { success: true, data: { ...metadata, summary: summary(fixtures.completed) } },
  inServiceSnapshot: { success: true, data: { ...metadata, sourceRevision: 12, revision: 12, sourceTick: 6, tick: 6, summary: summary(fixtures.inProgress) } },
  reviewSnapshot: { success: true, data: { ...metadata, sourceRevision: 10, revision: 10, sourceTick: 5, tick: 5, summary: summary(fixtures.beforeApproval) } },
  openRequest: { revision: 14 },
  incidentRequest: { revision: 0, machineIndex: 2, componentIndex: 1, scheduledTick: 7, reason: event.requestedReason },
  appliedIncidents: { success: true, data: { sessionId, revision: 1, tick: 7, source: 'JCST_SIMULATION', events: [event] } },
  skippedIncidents: { success: true, data: { sessionId, revision: 2, tick: 7, source: 'JCST_SIMULATION', events: [{ ...event,
    eventId: '10000000-0000-4000-8000-000000000005', componentIndex: 0, status: 'SKIPPED', reason: 'COMPONENT_ALREADY_FAILED' }] } },
  list: { success: true, data: { items: [metadata], nextCursor: null } },
};
const out = path.resolve(__dirname, '../docs/jcst-situations-examples.json');
const text = JSON.stringify(output, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n') !== text) throw Error('Situation examples need regeneration');
} else fs.writeFileSync(out, text);
