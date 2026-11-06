const { ApiError } = require('../lib/api-error');
function legacyWrite(req, _res, next) {
  // Compatibility tests/development retain old behavior unless explicitly disabled.
  const enabled = process.env.LEGACY_RESEARCH_WRITE_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true');
  if (enabled !== 'true') return next(new ApiError(409, 'LEGACY_RESEARCH_READ_ONLY', 'Legacy CNC experiments are read-only; use the JCST research workspace'));
  next();
}
module.exports = { legacyWrite };
