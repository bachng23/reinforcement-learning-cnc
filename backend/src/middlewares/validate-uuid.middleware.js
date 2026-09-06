const { z } = require('zod');
const { fromZodError } = require('../lib/api-error');

const uuidSchema = z.string().uuid();

const validateUuidParam = (paramName) => (req, _res, next) => {
  const parsed = uuidSchema.safeParse(req.params[paramName]);
  if (!parsed.success) {
    return next(fromZodError(parsed.error, `${paramName} must be a valid UUID`));
  }
  req.params[paramName] = parsed.data;
  return next();
};

module.exports = validateUuidParam;
