const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const requireAuth = async (req, res, next) => {
  try {
    // Browser sessions use the cookie; API clients may use a Bearer token.
    const cookieToken = req.cookies?.pdm_token;
    const authHeader = req.headers.authorization;
    let token = cookieToken;
    if (!token) {
      if (!authHeader) return next(new Error('UNAUTHORIZED'));
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
        return next(new Error('UNAUTHORIZED'));
      }
      token = parts[1];
    }
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.warn(`[auth] JWT verification failed: ${err.name}`);
      return next(new Error('UNAUTHORIZED'));
    }

    let user;
    try {
      user = await prisma.user.findUnique({
        where: { id: decoded.id || decoded.sub },
      });
    } catch (err) {
      // Reject legacy tokens carrying non-UUID user IDs.
      if (err.code === 'P2023') {
        console.warn('[auth] JWT contained non-UUID id — rejecting');
        return next(new Error('UNAUTHORIZED'));
      }
      if (
        err.name === 'PrismaClientInitializationError' ||
        (typeof err.message === 'string' && err.message.includes("Can't reach database server"))
      ) {
        return next(new Error('DB_UNAVAILABLE'));
      }
      throw err;
    }

    if (!user || !user.active) {
      return next(new Error('UNAUTHORIZED'));
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const cookieToken = req.cookies?.pdm_token;
    const authHeader = req.headers.authorization;
    let token = cookieToken;

    if (!token && authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
        return next(new Error('UNAUTHORIZED'));
      }
      token = parts[1];
    }

    if (!token) return next();

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.warn(`[auth] Optional JWT verification failed: ${err.name}`);
      return next(new Error('UNAUTHORIZED'));
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id || decoded.sub },
    });

    if (!user || !user.active) {
      return next(new Error('UNAUTHORIZED'));
    }

    req.user = user;
    next();
  } catch (error) {
    if (
      error.name === 'PrismaClientInitializationError' ||
      (typeof error.message === 'string' && error.message.includes("Can't reach database server"))
    ) {
      return next(new Error('DB_UNAVAILABLE'));
    }
    if (error.code === 'P2023') {
      return next(new Error('UNAUTHORIZED'));
    }
    next(error);
  }
};

/** @param {string[]} roles */
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new Error('FORBIDDEN'));
    }
    next();
  };
};

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole,
};
