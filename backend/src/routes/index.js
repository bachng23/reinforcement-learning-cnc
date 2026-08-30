const express = require('express');
const v1Routes = require('./v1');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'OK', service: 'research-api' });
});

router.use('/v1', v1Routes);

module.exports = router;
