const express = require('express');
const authRoute = require('./auth.route');
const userRoute = require('./user.route');

const router = express.Router();

router.use('/auth', authRoute);
router.use('/users', userRoute);

router.get('/', (_req, res) => {
  res.json({ name: 'CNC Research Platform API', version: '1' });
});

module.exports = router;
