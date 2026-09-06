const { randomUUID } = require('node:crypto');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const requestLogger = (req, res, next) => {
  const suppliedRequestId = req.get('X-Request-Id');
  const requestId = suppliedRequestId && REQUEST_ID_PATTERN.test(suppliedRequestId)
    ? suppliedRequestId
    : randomUUID();
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  res.set('X-Request-Id', requestId);

  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.info(JSON.stringify({
      type: 'http_request',
      timestamp: new Date().toISOString(),
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      userId: req.user?.id,
      ip: req.ip,
    }));
  });

  next();
};

module.exports = requestLogger;
