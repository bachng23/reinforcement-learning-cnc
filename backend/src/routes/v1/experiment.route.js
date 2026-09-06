const express = require('express');
const experimentController = require('../../controllers/experiment.controller');
const episodeController = require('../../controllers/episode.controller');
const { requireAuth, requireRole } = require('../../middlewares/auth.middleware');
const validateUuidParam = require('../../middlewares/validate-uuid.middleware');
const { RESEARCH_MUTATION_ROLES } = require('../../services/research-access.service');

const router = express.Router();

router.use(requireAuth);
router.get('/', experimentController.listExperiments);
router.post('/', requireRole(RESEARCH_MUTATION_ROLES), experimentController.createExperiment);
router.get(
  '/:experimentId',
  validateUuidParam('experimentId'),
  experimentController.getExperiment,
);
router.post(
  '/:experimentId/run',
  validateUuidParam('experimentId'),
  requireRole(RESEARCH_MUTATION_ROLES),
  experimentController.runExperiment,
);
router.get(
  '/:experimentId/episodes',
  validateUuidParam('experimentId'),
  episodeController.listEpisodes,
);

module.exports = router;
