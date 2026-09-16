const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../../config/prisma');
const { requireAuth, requireRole } = require('../../middlewares/auth.middleware');
const validateUuid = require('../../middlewares/validate-uuid.middleware');
const { decide, accessWhere, missing, roles } = require('../../services/maintenance-decision.service');
const { episodeAccessWhere } = require('../../services/research-access.service');
const { ApiError, fromZodError } = require('../../lib/api-error');

router.use(requireAuth);
router.post('/decisions', requireRole(roles), async (req, res) => {
  const parsed = z.object({ recommendationId: z.string().uuid() }).strict().safeParse(req.body);
  if (!parsed.success) throw fromZodError(parsed.error);
  const recommendation = await prisma.policyRecommendation.findFirst({ where: {
    id: parsed.data.recommendationId, observation: { episode: episodeAccessWhere(req.user) },
  } });
  if (!recommendation) throw new ApiError(404, 'RECOMMENDATION_NOT_FOUND', 'Recommendation was not found');
  const decision = await prisma.maintenanceDecision.upsert({
    where: { recommendationId: recommendation.id }, update: {}, create: { recommendationId: recommendation.id },
  });
  res.status(200).json({ success: true, data: decision });
});
router.use('/decisions/:id', validateUuid('id'));
for (const [verb, to] of Object.entries({ approve: 'APPROVED', override: 'OVERRIDDEN', reject: 'REJECTED' })) {
  router.post(`/decisions/:id/${verb}`, requireRole(roles), async (req, res) => {
    const data = await decide(prisma, { id: req.params.id, user: req.user, to, body: req.body });
    res.json({ success: true, data });
  });
}
router.get('/decisions/:id/history', async (req, res) => {
  const decision = await prisma.maintenanceDecision.findFirst({
    where: { id: req.params.id, ...accessWhere(req.user) },
    include: { actions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  if (!decision) throw missing();
  res.json({ success: true, data: decision });
});
module.exports = router;
