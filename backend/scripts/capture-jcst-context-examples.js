const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { project } = require('../src/research/demo-observation');
const { contextSnapshot } = require('../src/research/demo-context');
if (!process.env.JCST_PYTHON) throw Error('Explicit JCST_PYTHON required for real physical examples');
const traces = JSON.parse(execFileSync(process.env.JCST_PYTHON,
  [path.resolve(__dirname, '../tests/helpers/jcst-context-trace.py')], { encoding: 'utf8', timeout: 30000 }));
const row = { id: '11111111-1111-4111-8111-111111111111', contextJson: contextSnapshot() };
const at = tick => project({ ...row, revision: tick, payloadJson: traces[tick - 1] });
const five = at(5), six = at(6), seven = at(7);
const file = path.resolve(__dirname, '../docs/jcst-context-examples.json');
const samples = { provenance: { seed: '990000001', sourceCommit: traces[0].source_commit,
  method: 'Pinned JCST physics, explicit legal test matching at tick 5; not learned-policy inference.',
  identity: 'Session UUID is illustrative, not a retained session. fixture-reviewer is an explicit test actor, not an authenticated user.' },
  factory: { success: true, data: { ...five.metadata, ...five.context } },
  failure: { success: true, data: { ...five.metadata, ...five.context, incident: five.incidents[0], machine: five.machines[2] } },
  inService: { success: true, data: { ...six.metadata, ...six.context, incident: six.incidents[0], machine: six.machines[2] } },
  completedAndNewFailure: { success: true, data: { ...seven.metadata, ...seven.context, items: seven.incidents, limit: 384, truncated: false } },
  missingContext: { success: true, data: { ...five.metadata, contextStatus: 'MISSING_LEGACY', contextVersion: null, contextOrigin: null, context: null } } };
fs.writeFileSync(file, JSON.stringify(samples, null, 2) + '\n');
console.log('Captured physical examples: t5 failure, t6 in service, t7 CM completion and new failure');
