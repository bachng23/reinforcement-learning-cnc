class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const zodDetails = (error) => error.issues.map((issue) => ({
  path: issue.path.join('.'),
  code: issue.code,
  message: issue.message,
}));

const fromZodError = (error, message = 'Request validation failed') => (
  new ApiError(400, 'VALIDATION_ERROR', message, zodDetails(error))
);

module.exports = {
  ApiError,
  fromZodError,
  zodDetails,
};
