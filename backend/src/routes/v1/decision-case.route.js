const router = require('express').Router();
const db = require('../../config/prisma');
const { requireAuth } = require('../../middlewares/auth.middleware');
const { createDecisionCase, getDecisionCase, getDecisionCaseRecommendation,
  getDecisionCaseEvents } = require('../../services/decision-case.service');
router.use(requireAuth);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.post('/', async (req, res) => {
  const result = await createDecisionCase(db, req.user, req.body, req.get('Idempotency-Key'));
  res.status(202).set('Location', result.location);
  if (result.replayed) res.set('Idempotency-Replayed', 'true');
  res.json(result.body);
});
router.get('/:id', async (req, res) => res.json(await getDecisionCase(db, req.user, req.params.id)));
router.get('/:id/recommendation', async (req, res) => res.json(await getDecisionCaseRecommendation(db, req.user, req.params.id)));
router.get('/:id/events', async (req, res) => res.json(await getDecisionCaseEvents(db, req.user, req.params.id, req.query)));
router.get('/:id/recommendation', async (req, res) => res.json(await require('../../services/decision-planning.service').getDecisionRecommendation(db, req.user, req.params.id)));
module.exports = router;
