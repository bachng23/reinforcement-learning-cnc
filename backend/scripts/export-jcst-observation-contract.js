const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const file = path.resolve(__dirname, '../research-openapi.yaml');
const source = fs.readFileSync(file, 'utf8');
const doc = yaml.safeLoad(source);
const examples = require('../docs/jcst-context-examples.json');
const ref = name => ({ $ref: '#/components/schemas/' + name });
const text = { type: 'string' }, nat = { type: 'integer', minimum: 0 }, tick = { ...nat, maximum: 64 };
const nullable = value => ({ anyOf: [value, { type: 'null' }] });
const array = (items, maxItems) => ({ type: 'array', items, ...(maxItems == null ? {} : { maxItems }) });
const obj = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const machineId = { enum: ['M1', 'M2', 'M3'] }, componentId = { enum: ['C1', 'C2'] };
const schemas = {};
schemas.DemoBatch = obj({ batchId: text, productName: text, quantity: nullable(nat), dueAt: nullable({ type: 'string', format: 'date-time' }) });
schemas.DemoMachineProfile = obj({ machineId, simulatorMachineIndex: { ...nat, maximum: 2 }, name: text, type: text,
  operation: text, operationOrder: { type: 'integer', minimum: 1, maximum: 3 }, lineId: text,
  location: obj({ zone: text, bay: text, x: nat, y: nat }), assignedBatch: ref('DemoBatch') });
schemas.DemoContext = obj({ contextVersion: text, contextOrigin: { const: 'ILLUSTRATIVE_DEMO' },
  factory: obj({ factoryId: text, name: text }), layout: obj({ coordinateUnit: { const: 'SCHEMATIC_GRID' }, columns: nat, rows: nat }),
  lines: array(obj({ lineId: text, name: text, machineIds: array(machineId, 3) })), machines: array(ref('DemoMachineProfile'), 3) });
const shared = { sessionId: { type: 'string', format: 'uuid' }, revision: nat, tick, lane: { const: 'primary' },
  contextStatus: { enum: ['AVAILABLE', 'MISSING_LEGACY'] }, contextVersion: nullable(text),
  contextOrigin: nullable({ const: 'ILLUSTRATIVE_DEMO' }), context: nullable(ref('DemoContext')) };
schemas.DemoMachineState = obj({ machineId, simulatorMachineIndex: { ...nat, maximum: 2 },
  machineState: { enum: ['WORKING', 'BREAKDOWN', 'IN_SERVICE'] },
  components: array(obj({ componentId, ageTicks: nat, failed: { type: 'boolean' } }), 2),
  currentJobs: array(obj({ technicianId: text, componentId, kind: { enum: ['PM', 'CM'] }, remainingTicks: { type: 'integer', minimum: 1 } }), 3) });
schemas.DemoPhysicalEvidence = obj({ recordIndex: { ...nat, maximum: 63 }, eventIndex: nat, tick,
  type: { enum: ['failure', 'start', 'completion'] }, machineId, componentId, technicianId: nullable(text),
  kind: nullable({ enum: ['PM', 'CM'] }), durationTicks: nullable({ type: 'integer', minimum: 1 }) });
schemas.DemoDecisionEvidence = obj({ decisionIndex: { ...nat, maximum: 63 }, tick, actor: text, reason: text,
  action: array(array(nat, 3), 3), override: { type: 'boolean' } });
schemas.DemoIncident = obj({ incidentId: text, machineId, simulatorMachineIndex: { ...nat, maximum: 2 }, componentId,
  simulatorComponentIndex: { ...nat, maximum: 1 }, status: { enum: ['OPEN', 'IN_SERVICE', 'RESOLVED'] },
  openedAtTick: tick, serviceStartedAtTick: nullable(tick), resolvedAtTick: nullable(tick), failure: ref('DemoPhysicalEvidence'),
  timeline: array(ref('DemoPhysicalEvidence'), 3), decisions: array(ref('DemoDecisionEvidence'), 1) });
schemas.DemoServiceHistory = obj({ serviceId: text, machineId, componentId, technicianId: text, kind: { enum: ['PM', 'CM'] },
  startedAtTick: tick, completedAtTick: nullable(tick), durationTicks: { type: 'integer', minimum: 1 },
  start: ref('DemoPhysicalEvidence'), completion: nullable(ref('DemoPhysicalEvidence')), decision: nullable(ref('DemoDecisionEvidence')) });
schemas.DemoFactoryRead = obj(shared);
schemas.DemoMachineRead = obj({ ...shared, profile: nullable(ref('DemoMachineProfile')), assignedBatch: nullable(ref('DemoBatch')),
  ...schemas.DemoMachineState.properties, maintenanceHistory: array(ref('DemoServiceHistory'), 192), incidentIds: array(text, 128) });
schemas.DemoIncidentListRead = obj({ ...shared, items: array(ref('DemoIncident'), 384), limit: { const: 384 }, truncated: { const: false } });
schemas.DemoIncidentRead = obj({ ...shared, incident: ref('DemoIncident'), machine: ref('DemoMachineState') });
schemas.DemoObservationRead = obj({ ...shared, status: { enum: ['RUNNING', 'REVIEW', 'COMPLETE'] },
  machines: array(ref('DemoMachineState'), 3), incidents: array(ref('DemoIncident'), 384), maintenanceHistory: array(ref('DemoServiceHistory'), 192) });
const errors = { 400: 'VALIDATION_ERROR: unknown/repeated query, invalid expectedRevision or filter',
  401: 'UNAUTHORIZED: invalid token/inactive user', 404: 'DEMO_NOT_FOUND / DEMO_MACHINE_NOT_FOUND / DEMO_INCIDENT_NOT_FOUND',
  409: 'DEMO_STALE: discard related reads and refetch the same revision',
  500: 'DEMO_TRACE_INVALID: inconsistent stored physical evidence', 503: 'DB_UNAVAILABLE' };
for (const [suffix, name, resource] of [['observation', 'DemoObservationRead'], ['factory', 'DemoFactoryRead'],
  ['machines/{machineId}', 'DemoMachineRead', 'machineId'], ['incidents', 'DemoIncidentListRead'], ['incidents/{incidentId}', 'DemoIncidentRead', 'incidentId']]) {
  const parameters = [{ name: 'expectedRevision', in: 'query', required: false, schema: { ...nat, maximum: 2147483647 } }];
  if (resource) parameters.push({ name: resource, in: 'path', required: true, schema: resource === 'machineId' ? machineId : text });
  if (suffix === 'incidents') parameters.push({ name: 'status', in: 'query', schema: schemas.DemoIncident.properties.status },
    { name: 'machineId', in: 'query', schema: machineId });
  doc.paths['/demo/sessions/{id}/' + suffix] = { parameters: [{ $ref: '#/components/parameters/id' }], get: {
    summary: 'Read ' + suffix + ' from one authorized persisted session revision',
    description: 'Read-only primary-lane projection; never prepares policy or advances the simulator. ADMIN/owner scope matches session reads. Context is ILLUSTRATIVE_DEMO, quantities/deadlines may be null; legacy context is MISSING_LEGACY. All time fields use simulator ticks; positions use dimensionless schematic grid units. With expectedRevision, concurrent changes return DEMO_STALE; observation bundles all views in one row read. No query parameters beyond those declared; repeated fields rejected. Incidents use session/lane/failure record/event identity, sorted source positions descending; timeline positions ascend. Recurrence is a new identity. CM completion resolves only its incident; PM cannot resolve CM. Lists are complete, max 384 failures (64 records x 3 machines x 2 components), no pagination or silent truncation.',
    parameters, responses: { '200': { description: 'Persisted snapshot projection', headers: { 'Cache-Control': { schema: { const: 'no-store' } } },
      content: { 'application/json': { schema: obj({ success: { const: true }, data: ref(name) }) } } },
      ...Object.fromEntries(Object.entries(errors).map(([code, description]) => [code, { description,
        headers: { 'Cache-Control': { schema: { const: 'no-store' } } } }])) } } };
  const selected = suffix === 'factory' ? { available: examples.factory, missingLegacy: examples.missingContext }
    : suffix === 'incidents' ? { completedAndNewFailure: examples.completedAndNewFailure }
      : resource === 'incidentId' ? { open: examples.failure, inService: examples.inService } : null;
  if (selected) doc.paths['/demo/sessions/{id}/' + suffix].get.responses['200'].content['application/json'].examples =
    Object.fromEntries(Object.entries(selected).map(([key, value]) => [key, { summary: examples.provenance.method + ' Illustrative UUID.', value }]));
}
doc.components.schemas = { ...doc.components.schemas, ...schemas };
const output = yaml.safeDump(doc, { noRefs: true, lineWidth: 110 });
if (process.argv.includes('--check')) {
  if (source.replace(/\r\n/g, '\n') !== output) { console.error('Research observation OpenAPI is stale'); process.exitCode = 1; }
} else fs.writeFileSync(file, output);
