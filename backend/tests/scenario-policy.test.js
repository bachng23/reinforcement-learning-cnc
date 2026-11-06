const policy = require('../src/services/scenario-policy');
const weights = { production: 1, reliability: 1, maintenance: 1, workforce: 1, schedule_stability: 0.25 };
const duration = { type: 'MAINTENANCE_DURATION', maintenance_request_id: 'maintenance-1', expected_duration_minutes: 90 };
const defer = { type: 'DEFER_MAINTENANCE', maintenance_request_id: 'maintenance-1', earliest_start_at: '2026-10-27T02:00:00Z' };
const snapshot = { planning_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2026-10-28T00:00:00Z' },
  technicians: [{ technician_id: 'tech-1' }], maintenance_requests: [{ maintenance_request_id: 'maintenance-1' }] };

test('canonical overrides ignore ordering and equivalent timezone notation without mutating caller input', () => {
  const a = { overrides: [duration, defer], objective_weights: weights };
  const original = JSON.stringify(a);
  expect(policy.inputHash(a)).toBe(policy.inputHash({ ...a, overrides: [{ ...defer, earliest_start_at: '2026-10-27T10:00:00+08:00' }, duration] }));
  expect(JSON.stringify(a)).toBe(original);
  expect(policy.inputHash({ ...a, overrides: [{ ...duration, expected_duration_minutes: 91 }, defer] })).not.toBe(policy.inputHash(a));
});

test.each([NaN, Infinity, -Infinity, 0, -1, 43201, '90'])('duration rejects invalid or unbounded value %s', value => {
  expect(() => policy.parse(policy.overrides, [{ ...duration, expected_duration_minutes: value }])).toThrow();
});

test('weights are the exact five finite names with a nonzero canonical-compatible sum', () => {
  expect(policy.parse(policy.weights, weights)).toEqual(weights);
  for (const invalid of [{ ...weights, production: Infinity }, { ...weights, extra: 1 },
    { production: 1 }, Object.fromEntries(Object.keys(weights).map(key => [key, 0])),
    { ...weights, production: -1 }]) expect(() => policy.parse(policy.weights, invalid)).toThrow();
});

test('duplicate target/type, too many overrides and untrusted actor fields are rejected', () => {
  expect(() => policy.parse(policy.overrides, [duration, duration])).toThrow();
  expect(() => policy.parse(policy.overrides, Array.from({ length: 6 }, (_, i) => ({ ...duration, maintenance_request_id: `m-${i}` })))).toThrow();
  expect(() => policy.parse(policy.createDraft, { name: ' test ', note: '', overrides: [], objective_weights: weights, actor_id: 'forged' })).toThrow();
  expect(policy.parse(policy.createDraft, { name: ' test ', note: '', overrides: [], objective_weights: weights }).name).toBe('test');
});

test('snapshot-scoped target/window checks preserve source and leave infeasibility to engine', () => {
  const before = JSON.stringify(snapshot);
  expect(policy.validateTargets(snapshot, [duration, defer])).toHaveLength(2);
  expect(() => policy.validateTargets(snapshot, [{ ...duration, maintenance_request_id: 'foreign' }])).toThrow(expect.objectContaining({ code: 'SCENARIO_INVALID_TARGET' }));
  const unavailable = { type: 'TECHNICIAN_UNAVAILABLE', technician_id: 'tech-1', start_at: '2026-10-27T03:00:00Z', end_at: '2026-10-27T02:00:00Z' };
  expect(() => policy.validateTargets(snapshot, [unavailable])).toThrow();
  expect(() => policy.validateTargets(snapshot, [{ ...unavailable, start_at: '2026-10-26T23:00:00Z' }])).toThrow(expect.objectContaining({ code: 'SCENARIO_INVALID_WINDOW' }));
  expect(JSON.stringify(snapshot)).toBe(before);
});

test('compare and pagination reject repeated/unknown/unbounded queries', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  expect(() => policy.parse(policy.compare, { run_ids: `${id},${id}` })).toThrow();
  expect(() => policy.parse(policy.compare, { run_ids: [id, id] })).toThrow();
  for (const query of [{ factory_id: 'f', limit: '101' }, { factory_id: ['f', 'g'] },
    { factory_id: 'f', limit: ['1', '2'] }, { factory_id: 'f', debug: '1' }])
    expect(() => policy.parse(policy.listWorkspaces, query)).toThrow();
});

test('sweep rejects duplicate and more than seven samples', () => {
  for (const values of [[1, 1], [], [1, 2, 3, 4, 5, 6, 7, 8]])
    expect(() => policy.parse(policy.enqueueSensitivity, { source_run_id: '11111111-1111-4111-8111-111111111111',
      axis: { type: 'OBJECTIVE_WEIGHT', weight: 'production', values } })).toThrow();
});
