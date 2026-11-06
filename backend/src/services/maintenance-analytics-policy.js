const { z, parse } = require('./work-order-policy');
const { identifier, accessSource } = require('./factory-access.service');
const { ApiError } = require('../lib/api-error');
const { createHmac, timingSafeEqual } = require('node:crypto');
const version = 'maintenance-analytics.v1';
const definitions = [
  ['open_orders', 'ORDER', 'CURRENT', 'count', 'Status not CLOSED/CANCELLED, including COMPLETED'],
  ['overdue_orders', 'ORDER', 'CURRENT', 'count', 'Open and planned_end_at < read_at'],
  ['blocked_orders', 'ORDER', 'CURRENT', 'count', 'Status BLOCKED, including MANAGER_HOLD'],
  ['waiting_verification_orders', 'ORDER', 'CURRENT', 'count', 'Status COMPLETED'],
  ['created_orders', 'ORDER', 'CREATE', 'count', 'Distinct orders with CREATE in period'],
  [
    'closed_orders',
    'ORDER',
    'CLOSE',
    'count',
    'Distinct orders with CLOSE in period, including VERIFIED_STOPPED',
  ],
  ['cancelled_orders', 'ORDER', 'CANCEL', 'count', 'Distinct orders with CANCEL in period'],
  [
    'successful_verified_orders',
    'ORDER',
    'CLOSE',
    'count',
    'CLOSE with SUCCESS completion and VERIFIED verification',
  ],
  [
    'rework_decision_rate',
    'DECISION',
    'VERIFICATION_DECISION',
    'fraction',
    'Rework decisions / CLOSE and both rework decisions',
  ],
  [
    'first_pass_verified_rate',
    'ORDER',
    'CLOSE',
    'fraction',
    'Attempt 1 SUCCESS VERIFIED closes / all closes',
  ],
  ['time_to_first_accept', 'ORDER', 'FIRST_ACCEPT', 'seconds', 'CREATE to first ACCEPT'],
  [
    'active_execution_time',
    'ATTEMPT',
    'COMPLETE',
    'seconds',
    'Sum IN_PROGRESS event intervals within completed attempt; excludes blocked and incomplete attempts',
  ],
  [
    'verification_wait_time',
    'DECISION',
    'VERIFICATION_DECISION',
    'seconds',
    'Preceding attempt COMPLETE to CLOSE or rework decision',
  ],
].map(([metric_key, grain, cohort, unit, formula]) => ({
  metric_key,
  grain,
  cohort,
  unit,
  formula,
  ...(unit === 'seconds'
    ? {
        percentile: 'PostgreSQL percentile_cont',
        exclusions: ['MISSING_HISTORY', 'INCONSISTENT_HISTORY'],
        meaning: 'Workflow elapsed seconds; not labor, downtime or MTTR',
      }
    : {}),
}));
const keys = definitions.map((d) => d.metric_key);
const periodKeys = definitions.filter((d) => d.cohort !== 'CURRENT').map((d) => d.metric_key);
const timestamp = z.string().datetime({ offset: true });
const timezone = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return !/^[+-]/.test(v);
    } catch {
      return false;
    }
  }, 'IANA timezone required')
  .default('UTC');
const shared = {
  factory_id: identifier,
  from: timestamp,
  to: timestamp,
  timezone,
  machine_id: identifier.optional(),
};
const pagination = {
  limit: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .transform(Number)
    .pipe(z.number().int().max(100))
    .default(25),
  cursor: z.string().min(1).max(8192).optional(),
};
const schemas = {
  definitions: z.object({}).strict(),
  overview: z.object(shared).strict(),
  trends: z
    .object({
      ...shared,
      metric_key: z.enum(periodKeys),
      bucket: z.enum(['day', 'week', 'month']).default('day'),
    })
    .strict(),
  machines: z
    .object({
      ...shared,
      ...pagination,
      sort: z.enum(['overdue', 'blocked', 'open', 'rework_rate', 'active_p90']).default('overdue'),
    })
    .strict(),
  drilldown: z
    .object({
      ...shared,
      ...pagination,
      metric_key: z.enum(keys),
      population: z.enum(['numerator', 'denominator']).optional(),
    })
    .strict(),
};
function query(endpoint, raw) {
  const q = parse(schemas[endpoint], raw);
  if (endpoint !== 'definitions') {
    const rate = q.metric_key?.endsWith('_rate');
    if (endpoint === 'drilldown' && Boolean(rate) !== Boolean(q.population))
      throw new ApiError(400, 'VALIDATION_ERROR', 'population is required only for rate metrics');
  }
  return q;
}
const invalid = () => new ApiError(400, 'INVALID_CURSOR', 'Cursor does not match actor, scope and filters');
function scope(endpoint, q, user) {
  const { cursor, limit, ...filters } = q;
  return JSON.stringify({ endpoint, filters, actor: user.id, source: accessSource(), version });
}
function signature(p) {
  if (!process.env.JWT_SECRET)
    throw new ApiError(503, 'CURSOR_SIGNING_UNAVAILABLE', 'Cursor signing unavailable');
  return createHmac('sha256', process.env.JWT_SECRET).update('maintenance-analytics:').update(p).digest();
}
function encode(endpoint, q, user, key) {
  const p = Buffer.from(JSON.stringify({ scope: scope(endpoint, q, user), key })).toString('base64url');
  return p + '.' + signature(p).toString('base64url');
}
function decode(endpoint, q, user) {
  if (!q.cursor) return null;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(q.cursor)) throw invalid();
  const [p, s] = q.cursor.split('.');
  const signatureBytes = Buffer.from(s, 'base64url');
  if (signatureBytes.toString('base64url') !== s || !timingSafeEqual(signature(p), signatureBytes))
    throw invalid();
  try {
    const parsed = JSON.parse(Buffer.from(p, 'base64url'));
    if (parsed.scope !== scope(endpoint, q, user) || !parsed.key || typeof parsed.key !== 'object')
      throw invalid();
    return parsed.key;
  } catch {
    throw invalid();
  }
}
module.exports = { version, definitions, keys, periodKeys, query, encode, decode };
