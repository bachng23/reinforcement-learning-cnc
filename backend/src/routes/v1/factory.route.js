const router = require('express').Router();
const db = require('../../config/prisma');
const { requireAuth, requireRole } = require('../../middlewares/auth.middleware');
const service = require('../../services/factory-registry.service');
const { accessError } = require('../../services/factory-access.service');
router.use(requireAuth);
const admin = requireRole(['ADMIN']);
const noQuery = (req) => service.parse(service.empty, req.query);
router.get('/', async (req, res) => res.json(await service.listFactories(db, req.user, req.query)));
router.post('/', admin, async (req, res) => {
  noQuery(req);
  res.status(201).json(await service.writeFactory(db, req.user, null, req.body));
});
router.get('/:factory_id', async (req, res) => {
  noQuery(req);
  res.json(await service.getFactory(db, req.user, req.params.factory_id));
});
router.patch('/:factory_id', admin, async (req, res) => {
  noQuery(req);
  res.json(await service.writeFactory(db, req.user, req.params.factory_id, req.body));
});
router.get('/:factory_id/members', admin, async (req, res) =>
  res.json(await service.listMembers(db, req.user, req.params.factory_id, req.query)),
);
for (const [method, active] of [
  ['put', true],
  ['delete', false],
])
  router[method]('/:factory_id/members/:user_id', admin, async (req, res) => {
    noQuery(req);
    res.json(
      await service.changeMembership(
        db,
        req.user,
        req.params.factory_id,
        req.params.user_id,
        active,
        req.body,
      ),
    );
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
            ? 'Factory service is unavailable'
            : err.statusCode
              ? err.message
              : 'Authentication or permission is required',
      },
      requestId: req.requestId,
    });
});
module.exports = router;
