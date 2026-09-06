const express = require('express');
const episodeController = require('../../controllers/episode.controller');
const { requireAuth, requireRole } = require('../../middlewares/auth.middleware');
const validateUuidParam = require('../../middlewares/validate-uuid.middleware');
const { RESEARCH_MUTATION_ROLES } = require('../../services/research-access.service');

const router = express.Router();

router.use(requireAuth);
router.use('/:episodeId', validateUuidParam('episodeId'));

router.get('/:episodeId', episodeController.getEpisode);
router.get('/:episodeId/observations', episodeController.listObservations);
router.get('/:episodeId/recommendations', episodeController.listRecommendations);
router.get('/:episodeId/results', episodeController.listResults);
router.get('/:episodeId/summary', episodeController.getSummary);
router.post(
  '/:episodeId/retry',
  requireRole(RESEARCH_MUTATION_ROLES),
  episodeController.retryEpisode,
);
router.post(
  '/:episodeId/cancel',
  requireRole(RESEARCH_MUTATION_ROLES),
  episodeController.cancelEpisode,
);

module.exports = router;
