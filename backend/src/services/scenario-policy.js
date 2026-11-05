const { z } = require('zod');
const { ApiError, fromZodError } = require('../lib/api-error');
const { identifier } = require('./factory-access.service');
const { contentHash } = require('./operations-contract.service');

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const revision = z.number().int().min(1).max(2147483647);
const timestamp = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
const weightNames = ['production', 'reliability', 'maintenance', 'workforce', 'schedule_stability'];
const strategies = ['PRODUCTION_PRIORITY', 'BALANCED', 'RELIABILITY_PRIORITY'];
const weights = z.object(Object.fromEntries(weightNames.map(key => [key, z.number().min(0).max(1e6)])))
  .strict().refine(value => Object.values(value).reduce((a, b) => a + b, 0) > 1e-12,
    'At least one weight must be positive (sum > 1e-12, canonical tolerance)');
const duration = z.number().int().min(1).max(43200);
const override = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TECHNICIAN_UNAVAILABLE'), technician_id: identifier,
    start_at: timestamp, end_at: timestamp }).strict(),
  z.object({ type: z.literal('MAINTENANCE_DURATION'), maintenance_request_id: identifier,
    expected_duration_minutes: duration }).strict(),
  z.object({ type: z.literal('DEFER_MAINTENANCE'), maintenance_request_id: identifier,
    earliest_start_at: timestamp }).strict(),
]);
const overrides = z.array(override).max(5).superRefine((values, ctx) => {
  const seen = new Set();
  values.forEach((value, index) => {
    const key = `${value.type}:${value.technician_id ?? value.maintenance_request_id}`;
    if (seen.has(key)) ctx.addIssue({ code: 'custom', message: 'Duplicate override type/target', path: [index] });
    seen.add(key);
    if (value.type === 'TECHNICIAN_UNAVAILABLE' && value.start_at >= value.end_at)
      ctx.addIssue({ code: 'custom', message: 'Unavailable interval must be nonempty', path: [index] });
  });
});
const planningConfig = z.object({
  horizon_minutes: z.number().int().min(1).max(43200),
  candidate_limit: z.number().int().min(1).max(3),
  solver_timeout_seconds: z.number().int().min(1).max(30),
  simulation_runs: z.number().int().min(1).max(1000),
  base_seed: z.number().int().min(0).max(2147483647),
  objective_weights: weights,
  allowed_strategy_ids: z.array(z.enum(strategies)).min(1).max(3)
    .refine(value => new Set(value).size === value.length, 'Strategies must be unique'),
}).strict();
const head = z.object({ snapshot_id: identifier, plan_version: z.number().int().min(0).max(2147483647), revision }).strict();
const name = z.string().trim().min(1).max(160);
const draftFields = { name, note: z.string().trim().max(4000), overrides, objective_weights: weights };
const createWorkspace = z.object({ factory_id: identifier, name, expected_head: head, planning_config: planningConfig }).strict();
const createDraft = z.object(draftFields).strict();
const updateDraft = z.object({ ...draftFields, expected_revision: revision }).strict();
const enqueueRun = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('BASELINE') }).strict(),
  z.object({ kind: z.literal('SCENARIO'), scenario_id: uuid, expected_revision: revision }).strict(),
]);
const values = schema => z.array(schema).min(1).max(7)
  .refine(value => new Set(value).size === value.length, 'Sweep values must be unique');
const axis = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MAINTENANCE_DURATION'), maintenance_request_id: identifier, values: values(duration) }).strict(),
  z.object({ type: z.literal('OBJECTIVE_WEIGHT'), weight: z.enum(weightNames), values: values(z.number().min(0).max(1e6)) }).strict(),
]);
const enqueueSensitivity = z.object({ source_run_id: uuid, axis }).strict();
const liveEvaluation = z.object({ source_run_id: uuid, confirmation: z.literal(true), expected_head: head }).strict();
const limit = z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(z.number().int().min(1).max(100)).default(20);
const page = z.object({ cursor: z.string().min(1).max(2048).optional(), limit }).strict();
const listWorkspaces = page.extend({ factory_id: identifier });
const compare = z.object({ run_ids: z.string().transform(value => value.split(','))
  .pipe(z.array(uuid).min(2).max(4).refine(value => new Set(value).size === value.length, 'Run IDs must be unique')) }).strict();
const empty = z.object({}).strict();
const key = z.string().min(1).max(128).regex(/^[\x21-\x7e]+$/);
const jobStatuses = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'];
const pointStatuses = ['QUEUED', 'RUNNING', 'FEASIBLE', 'NO_FEASIBLE_PLAN', 'FAILED', 'TIMEOUT'];
function parse(schema, raw) {
  const result = schema.safeParse(raw);
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}
function canonicalOverrides(raw) {
  return parse(overrides, raw).sort((a, b) => {
    const left = `${a.type}:${a.technician_id ?? a.maintenance_request_id}`;
    const right = `${b.type}:${b.technician_id ?? b.maintenance_request_id}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
function inputHash(input) {
  return contentHash({ ...input, overrides: canonicalOverrides(input.overrides) });
}
function validateTargets(snapshot, raw) {
  const result = canonicalOverrides(raw);
  const start = Date.parse(snapshot.planning_window.start_at), end = Date.parse(snapshot.planning_window.end_at);
  for (const item of result) {
    const technician = item.type === 'TECHNICIAN_UNAVAILABLE';
    const target = technician ? snapshot.technicians?.find(t => t.technician_id === item.technician_id)
      : snapshot.maintenance_requests?.find(r => r.maintenance_request_id === item.maintenance_request_id);
    if (!target) throw new ApiError(400, 'SCENARIO_INVALID_TARGET', 'Override target is absent from the pinned snapshot');
    if (!technician && ['COMPLETED', 'CANCELLED'].includes(target.status))
      throw new ApiError(400, 'SCENARIO_INVALID_TARGET', 'Terminal maintenance cannot be overridden');
    if (technician && (Date.parse(item.start_at) < start || Date.parse(item.end_at) > end))
      throw new ApiError(400, 'SCENARIO_INVALID_WINDOW', 'Unavailable interval must be inside the planning window');
    if (item.type === 'DEFER_MAINTENANCE' && (Date.parse(item.earliest_start_at) < Math.max(start, Date.parse(target.earliest_start_at)) || Date.parse(item.earliest_start_at) >= end))
      throw new ApiError(400, 'SCENARIO_INVALID_WINDOW', 'Deferred start must be inside the planning window');
  }
  // Feasibility/contradictions against mandatory/locked constraints belong to the engine validator.
  return result;
}
module.exports = { uuid, revision, timestamp, weights, overrides, planningConfig, head, createWorkspace,
  createDraft, updateDraft, enqueueRun, enqueueSensitivity, liveEvaluation, page, listWorkspaces,
  compare, empty, key, jobStatuses, pointStatuses, parse, canonicalOverrides, inputHash, validateTargets };
