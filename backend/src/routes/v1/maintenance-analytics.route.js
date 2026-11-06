const router = require('express').Router();
const db = require('../../config/prisma');
const { requireAuth } = require('../../middlewares/auth.middleware');
const { accessError } = require('../../services/factory-access.service');
const { read } = require('../../services/maintenance-analytics.service');
router.use(requireAuth);
for (const endpoint of ['overview', 'trends', 'machines', 'drilldown', 'definitions']) {
  router.get('/' + endpoint, async (req, res) => res.json(await read(db, req.user, endpoint, req.query)));
}
router.use((err, req, res, next) => {
  err = accessError(err);
  const known = { UNAUTHORIZED: 401, FORBIDDEN: 403, DB_UNAVAILABLE: 503 };
  const status = err.statusCode || known[err.message] || 500;
  res.status(status).json({
    success: false,
    error: {
      code: err.statusCode ? err.code : known[err.message] ? err.message : 'INTERNAL_ERROR',
      message: status >= 500 ? 'Maintenance analytics service is unavailable' : err.message,
    },
    requestId: req.requestId,
  });
});
module.exports = router;
