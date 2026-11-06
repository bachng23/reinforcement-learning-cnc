const router = require('express').Router();
const { z } = require('zod');
const { randomUUID } = require('node:crypto');
const prisma = require('../../config/prisma');
const { requireAuth } = require('../../middlewares/auth.middleware');
const { fromZodError } = require('../../lib/api-error');
const { readOperations } = require('../../services/operations-context.service');

const { readOperationsOverview } = require('../../services/operations-overview.service');

const query = z.object({ factory_id: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/) }).strict();
const read = (field) => async (req, res) => {
  const parsed = query.safeParse(req.query);
  if (!parsed.success) throw fromZodError(parsed.error);
  const result = await readOperations(prisma, req.user, parsed.data.factory_id);
  res.set('Cache-Control', 'no-store').json({ success: true, data: result[field], meta: result.meta });
};
router.get('/operations/overview', requireAuth, async (req, res) => {
  const parsed = query.safeParse(req.query);
  if (!parsed.success) throw fromZodError(parsed.error);
  const result = await readOperationsOverview(prisma, req.user, parsed.data.factory_id);
  res.set('Cache-Control', 'no-store').json(result);
});
router.get('/operations/snapshot', requireAuth, read('snapshot'));
router.get('/schedules/current', requireAuth, read('schedule'));
// Operations errors use the canonical v3 ErrorResponse; legacy routes keep their existing envelope.
router.use((error, req, res, next) => {
  if (!['/operations/overview', '/operations/snapshot', '/schedules/current'].includes(req.path)) return next(error);
  const known = { UNAUTHORIZED: 401, FORBIDDEN: 403, DB_UNAVAILABLE: 503 };
  // Connection/pool failures on the new read route use its documented 503 branch.
  const overviewDbUnavailable = req.path === '/operations/overview' && ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code);
  const status = overviewDbUnavailable ? 503 : error.statusCode || known[error.message] || (error.name === 'PrismaClientInitializationError' ? 503 : 500);
  const code = error.code && error.statusCode ? error.code : known[error.message] ? error.message : status === 503 ? 'DB_UNAVAILABLE' : 'INTERNAL_ERROR';
  res.status(status).set('Cache-Control', 'no-store').json({ schema_version: '3.0', error_id: randomUUID(), code,
    message: status >= 500 ? 'Operations context is unavailable' : error.statusCode ? error.message : 'Authentication or permission is required',
    correlation_id: req.requestId, retryable: status === 503, details: [],
  });
});
module.exports = router;
