const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const routes = require('./routes');

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use(cors(corsOptions));

app.use(cookieParser());
app.use(morgan('dev'));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.use('/api', routes);

app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found!`
  });
});

app.use((err, req, res, next) => {
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';

  // Rejected non-Error values may not expose a message.
  const msg = typeof err?.message === 'string' ? err.message : '';

  if (msg === 'UNAUTHORIZED') {
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

  if (errorCode === 'DB_UNAVAILABLE') {
    console.warn(`[api] Database unavailable while handling ${req.method} ${req.originalUrl}: ${msg}`);
  } else {
    console.error(err.stack || err);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: errorCode === 'DB_UNAVAILABLE'
        ? 'Database unavailable. Check DATABASE_URL and make sure Postgres is running.'
        : err.message || 'An unexpected error occurred',
      detail: process.env.NODE_ENV === 'development' ? err.stack : undefined
    }
  });
});

module.exports = app;
