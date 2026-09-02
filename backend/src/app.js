const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const routes = require('./routes');
const requestLogger = require('./middlewares/request-logger.middleware');

const app = express();

app.use(helmet());

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  preflightContinue: false,
  optionsSuccessStatus: 204,
  credentials: true,
  exposedHeaders: ['Idempotency-Replayed', 'X-Request-Id'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Idempotency-Key',
    'X-Request-Id',
    'X-Requested-With',
  ],
};
app.use(cors(corsOptions));

app.use(cookieParser());
app.use(requestLogger);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.use('/api', routes);

app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${req.originalUrl} was not found`,
    },
    requestId: req.requestId,
  });
});

app.use((err, req, res, next) => {
  let statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  let errorCode = err?.statusCode && typeof err?.code === 'string'
    ? err.code
    : 'INTERNAL_ERROR';
  let details = err?.details;

  // Rejected non-Error values may not expose a message.
  const msg = typeof err?.message === 'string' ? err.message : '';

  if (err?.statusCode) {
    // ApiError already carries its public status and code.
  } else if (msg === 'UNAUTHORIZED') {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
  } else if (msg === 'FORBIDDEN') {
    statusCode = 403;
    errorCode = 'FORBIDDEN';
  } else if (msg === 'DB_UNAVAILABLE') {
    statusCode = 503;
    errorCode = 'DB_UNAVAILABLE';
  } else if (msg.includes('NOT_FOUND')) {
    statusCode = 404;
    errorCode = 'NOT_FOUND';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
  } else if (
    err.name === 'PrismaClientInitializationError' ||
    msg.includes("Can't reach database server")
  ) {
    statusCode = 503;
    errorCode = 'DB_UNAVAILABLE';
  } else if (err.name === 'PrismaClientKnownRequestError') {
    if (err.code === 'P2002') {
      statusCode = 409;
      errorCode = 'DUPLICATE_ENTRY';
    } else if (err.code === 'P2025') {
      statusCode = 404;
      errorCode = 'RECORD_NOT_FOUND';
    }
  }

  if (err?.type === 'entity.parse.failed') {
    statusCode = 400;
    errorCode = 'INVALID_JSON';
    details = undefined;
  } else if (err?.type === 'entity.too.large') {
    statusCode = 413;
    errorCode = 'PAYLOAD_TOO_LARGE';
    details = undefined;
  }

  if (process.env.NODE_ENV !== 'test') {
    if (errorCode === 'DB_UNAVAILABLE') {
      console.warn(JSON.stringify({
        type: 'api_error',
        requestId: req.requestId,
        code: errorCode,
        method: req.method,
        path: req.originalUrl,
      }));
    } else {
      console.error(JSON.stringify({
        type: 'api_error',
        requestId: req.requestId,
        code: errorCode,
        method: req.method,
        path: req.originalUrl,
        message: statusCode >= 500 ? 'Internal error' : msg,
      }));
    }
  }

  const publicMessages = {
    DB_UNAVAILABLE: 'Database unavailable. Check DATABASE_URL and make sure Postgres is running.',
    DUPLICATE_ENTRY: 'A record with the same unique value already exists',
    RECORD_NOT_FOUND: 'The requested record was not found',
    UNAUTHORIZED: 'Authentication is required',
    FORBIDDEN: 'You do not have permission to perform this operation',
    NOT_FOUND: 'The requested resource was not found',
    INTERNAL_ERROR: 'An unexpected error occurred',
    INVALID_JSON: 'Request body must contain valid JSON',
    PAYLOAD_TOO_LARGE: 'Request payload is too large',
  };

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: publicMessages[errorCode] || msg || 'An unexpected error occurred',
      details,
    },
    requestId: req.requestId,
  });
});

module.exports = app;
