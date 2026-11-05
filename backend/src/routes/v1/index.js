const express = require('express');
const path = require('node:path');
const authRoute = require('./auth.route');
const episodeRoute = require('./episode.route');
const experimentRoute = require('./experiment.route');
const policyRoute = require('./policy.route');
const userRoute = require('./user.route');

const router = express.Router();

router.use('/auth', authRoute);
router.use('/users', userRoute);
router.use('/factories', require('./factory.route'));
router.use('/scenario-workspaces', require('./scenario.route'));
router.use('/work-orders', require('./work-order.route'));
router.use('/incidents', require('./incident.route'));
router.use('/maintenance-analytics', require('./maintenance-analytics.route'));
router.use('/policies', policyRoute);
router.use('/experiments', experimentRoute);
router.use('/episodes', episodeRoute);
router.use('/maintenance', require('./maintenance.route'));
router.use(require('./operations.route'));
router.use('/decision-cases', require('./decision-case.route'));

router.get('/openapi.yaml', (_req, res) => {
  res.type('application/yaml').sendFile(path.resolve(__dirname, '../../../openapi.yaml'));
});

router.get('/', (_req, res) => {
  res.json({ name: 'CNC Research Platform API', version: '1' });
});

module.exports = router;
