const router = require('express').Router();
const db = require('../../config/prisma');
const { requireAuth } = require('../../middlewares/auth.middleware');
const { accessError } = require('../../services/factory-access.service');
const { z, parse } = require('../../services/work-order-policy');
const read = require('../../services/work-order-read.service');
const write = require('../../services/work-order.service');
const noQuery = (req) => parse(z.object({}).strict(), req.query);
router.use(requireAuth);
router.get('/', async (req, res) => res.json(await read.listWorkOrders(db, req.user, req.query)));
router.get('/summaries', async (req, res) => res.json(await read.lookupHttp(db, req.user, req.query)));
router.get('/eligible-assignees', async (req, res) => res.json(await read.eligibleAssignees(db, req.user, req.query)));
router.get('/by-origin', async (req, res) => res.json(await read.byOrigin(db, req.user, req.query)));
router.post('/', async (req, res) => {
  noQuery(req);
  const r = await write.createWorkOrder(db, req.user, req.body, req.get('Idempotency-Key'));
  res
    .set('Idempotency-Replayed', String(r.replayed))
    .location('/api/v1/work-orders/' + r.body.data.id)
    .status(r.status)
    .json(r.body);
});
router.get('/:id', async (req, res) => {
  noQuery(req);
  res.json(await read.getWorkOrder(db, req.user, req.params.id));
});
router.get('/:id/events', async (req, res) =>
  res.json(await read.events(db, req.user, req.params.id, req.query)),
);
router.post('/:id/commands', async (req, res) => {
  noQuery(req);
  const r = await write.commandWorkOrder(db, req.user, req.params.id, req.body, req.get('Idempotency-Key'));
  res.set('Idempotency-Replayed', String(r.replayed)).status(r.status).json(r.body);
});
router.use((err, req, res, next) => {
  err = accessError(err);
  const known = { UNAUTHORIZED: 401, FORBIDDEN: 403, DB_UNAVAILABLE: 503 };
  const status = err.statusCode || known[err.message] || 500;
  res
    .status(status)
    .json({
      success: false,
      error: {
        code: err.statusCode ? err.code : known[err.message] ? err.message : 'INTERNAL_ERROR',
        message:
          status >= 500
            ? 'Work order service is unavailable'
            : err.statusCode
              ? err.message
              : 'Authentication or permission is required',
      },
      requestId: req.requestId,
    });
});
module.exports = router;
