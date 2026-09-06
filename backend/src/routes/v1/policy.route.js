const express = require('express');
const policyController = require('../../controllers/policy.controller');
const { requireAuth } = require('../../middlewares/auth.middleware');

const router = express.Router();

router.use(requireAuth);
router.get('/', policyController.listPolicies);

module.exports = router;
