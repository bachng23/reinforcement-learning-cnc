const { reportSchema, commandSchema, parse, initialSeverity, transition } = require('../src/services/incident-policy');
const examples = require('../examples/incidents.json');
const engineer = { id: '30000000-0000-4000-8000-000000000001', role: 'ENGINEER', active: true };
const manager = { id: '30000000-0000-4000-8000-000000000002', role: 'ADMIN', active: true };
const operator = { ...engineer, role: 'OPERATOR' };
const now = new Date('2026-10-22T09:00:00Z');
const incident = (overrides = {}) => ({ revision: 1, status: 'INVESTIGATING', ownerUserId: engineer.id,
  severity: 'WARNING', activeWorkOrderLinkCount: 0, ...overrides });
const resolve = { command: 'MARK_RESOLVED', expected_revision: 1, resolution: { code: 'FALSE_POSITIVE', summary: 'Reviewed', evidence: 'Manual inspection note' } };
const close = { command: 'CLOSE', expected_revision: 1, verification: { resolution_code: 'FALSE_POSITIVE', note: 'Independently reviewed' } };
const opts = { now, linkedWorkOrders: [] };
function code(fn, expected) { try { fn(); throw new Error('Expected rejection'); } catch (error) { expect(error.code).toBe(expected); } }

test('producer request examples parse as strict discriminated inputs', () => {
  parse(reportSchema, examples.manual_report);
  parse(reportSchema, examples.from_case_report);
  examples.commands.forEach(command => parse(commandSchema, command));
});
test.each(['actor_id', 'occurred_at', 'status', 'evidence', 'model_version'])('report rejects client-owned %s', field => {
  expect(() => parse(reportSchema, { ...examples.manual_report, [field]: 'forged' })).toThrow();
});
test('case identity comes from server; client machine and simulation declarations are rejected', () => {
  expect(() => parse(reportSchema, { ...examples.from_case_report, machine: examples.manual_report.machine })).toThrow();
  expect(() => parse(reportSchema, { ...examples.from_case_report, mode: 'LIVE' })).toThrow();
});
test('operator proposes severity but cannot establish official severity', () => {
  expect(initialSeverity(parse(reportSchema, examples.manual_report), operator)).toBeNull();
  code(() => initialSeverity({ severity: 'CRITICAL' }, operator), 'FORBIDDEN');
  expect(initialSeverity({ severity: 'WARNING' }, engineer)).toBe('WARNING');
});
test('owner investigation/resolution does not mutate input or any external resource', () => {
  const value = incident(); const original = structuredClone(value);
  const result = transition(value, resolve, operator, opts);
  expect(result.patch).toMatchObject({ status: 'RESOLVED', resolvedBy: operator.id, resolvedAt: now, revision: 2 });
  expect(value).toEqual(original);
  expect(result.event.actorId).toBe(operator.id);
  expect(result.event.payload.resolution).toEqual(resolve.resolution);
});
test('owner/non-owner, viewer, inactive, stale and state guards', () => {
  code(() => transition(incident(), resolve, manager, opts), 'FORBIDDEN');
  code(() => transition(incident({ ownerUserId: manager.id }), resolve, operator, opts), 'INCIDENT_OWNER_REQUIRED');
  code(() => transition(incident(), resolve, { ...operator, role: 'VIEWER' }, opts), 'FORBIDDEN');
  code(() => transition(incident(), resolve, { ...operator, active: false }, opts), 'UNAUTHORIZED');
  code(() => transition(incident({ revision: 2 }), resolve, operator, opts), 'INCIDENT_REVISION_CONFLICT');
  code(() => transition(incident({ status: 'OPEN' }), resolve, operator, opts), 'INCIDENT_STATE_CONFLICT');
});
test('independent verification is required even for an engineer resolver', () => {
  const resolved = incident({ status: 'RESOLVED', resolvedBy: engineer.id, resolution: resolve.resolution });
  code(() => transition(resolved, close, engineer, opts), 'INCIDENT_INDEPENDENT_VERIFICATION_REQUIRED');
  expect(transition(resolved, close, manager, opts).patch.status).toBe('CLOSED');
  code(() => transition({ ...resolved, severity: null }, close, manager, opts), 'INCIDENT_SEVERITY_UNCONFIRMED');
  code(() => transition(resolved, { ...close, verification: { resolution_code: 'FIXED', note: 'Wrong result' } }, manager, opts), 'INCIDENT_VERIFICATION_MISMATCH');
});
test.each(['UNASSIGNED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED'])('work order %s is not terminal', status => {
  const value = incident({ activeWorkOrderLinkCount: 1 });
  const context = { now, linkedWorkOrders: [{ status, availability: 'available' }] };
  code(() => transition(value, resolve, engineer, context), 'INCIDENT_WORK_ORDER_ACTIVE');
  const override = { ...resolve, work_order_override_reason: 'Independent incident remediation reviewed' };
  expect(transition(value, override, engineer, context).event.payload.work_order_override_reason).toBe(override.work_order_override_reason);
  code(() => transition(value, override, operator, context), 'FORBIDDEN');
});
test.each(['CLOSED', 'CANCELLED'])('work order %s permits resolution but does not cause it automatically', status => {
  expect(transition(incident({ activeWorkOrderLinkCount: 1 }), resolve, operator,
    { now, linkedWorkOrders: [{ status, availability: 'available' }] }).patch.status).toBe('RESOLVED');
});
test('missing/unavailable work order projection fails closed even with override', () => {
  const input = { ...resolve, work_order_override_reason: 'Cannot bypass unavailability' };
  for (const linkedWorkOrders of [undefined, [], [{ availability: 'unavailable' }], [{ availability: 'not_found' }], [{ availability: 'available', status: 'UNKNOWN' }]]) {
    code(() => transition(incident({ activeWorkOrderLinkCount: 1 }), input, engineer, { now, linkedWorkOrders }), 'INCIDENT_LINK_TARGET_UNAVAILABLE');
  }
});
test('reassignment resets acknowledgment and requires active scoped owner, not a technician', () => {
  const command = { command: 'REASSIGN', expected_revision: 1, owner_user_id: manager.id, reason: 'New investigator' };
  const owner = { ...operator, id: manager.id, factoryAuthorized: true };
  expect(transition(incident(), command, manager, { now, owner }).patch).toMatchObject({ status: 'OPEN', acknowledgedAt: null, ownerUserId: owner.id });
  code(() => transition(incident(), command, manager, { now, owner: { ...owner, factoryAuthorized: false } }), 'INCIDENT_OWNER_UNAVAILABLE');
  code(() => transition(incident({ status: 'RESOLVED' }), command, manager, { now, owner }), 'INCIDENT_STATE_CONFLICT');
});
test.each([['CLOSED', 'OPEN'], ['RESOLVED', 'INVESTIGATING']])('reopen %s -> %s retains historical resolution', (from, to) => {
  const value = incident({ status: from, resolution: resolve.resolution, resolvedBy: engineer.id });
  const result = transition(value, { command: 'REOPEN', expected_revision: 1, reason: 'New evidence' }, manager, opts);
  expect(result.patch.status).toBe(to);
  expect(result.patch).not.toHaveProperty('resolution');
  expect(value.resolution).toEqual(resolve.resolution);
});
test('resolution and command schemas reject empty evidence, unknown actor and missing revision', () => {
  for (const command of [{ ...resolve, resolution: { ...resolve.resolution, evidence: '  ' } }, { ...resolve, actor_id: engineer.id }, { command: 'ACKNOWLEDGE' }]) {
    expect(() => parse(commandSchema, command)).toThrow();
  }
});
