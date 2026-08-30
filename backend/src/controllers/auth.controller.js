const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const prisma = require('../config/prisma');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

const updateMeSchema = z.object({
  fullName: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }, z.union([z.string().max(100), z.null()]).optional()),
  email: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }, z.union([z.string().email(), z.null()]).optional()),
  password: z.string().min(8).max(128).optional(),
  newPassword: z.string().min(8).max(128).optional(),
  currentPassword: z.string().min(1).max(128).optional(),
  oldPassword: z.string().min(1).max(128).optional(),
}).superRefine((data, ctx) => {
  const nextPassword = data.newPassword ?? data.password;
  const hasProfileField = Object.prototype.hasOwnProperty.call(data, 'fullName')
    || Object.prototype.hasOwnProperty.call(data, 'email');

  if (!hasProfileField && !nextPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one field must be provided',
    });
  }

  if (nextPassword && !(data.currentPassword ?? data.oldPassword)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Current password is required to set a new password',
      path: ['currentPassword'],
    });
  }
});

const toPublicUser = (user) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  fullName: user.fullName,
  email: user.email,
  active: user.active,
});

const login = async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required',
      });
    }
    const { username, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      console.warn('[auth] login_failed reason=user_not_found username=%s ip=%s', username, req.ip);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
      });
    }

    if (!user.active) {
      console.warn('[auth] login_failed reason=inactive_account username=%s ip=%s', username, req.ip);
      return res.status(401).json({
        success: false,
        message: 'User account is inactive',
      });
    }

    const isPasswordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordMatch) {
      console.warn('[auth] login_failed reason=wrong_password username=%s ip=%s', username, req.ip);
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    res.cookie('pdm_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.fullName,
      },
    });
  } catch (error) {
    console.error('[auth] login_error ip=%s err=%s', req.ip, error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

const me = async (req, res) => {
  res.json({ success: true, user: toPublicUser(req.user) });
};

const updateMe = async (req, res, next) => {
  try {
    const parsed = updateMeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message, detail: parsed.error.issues },
      });
    }

    const { fullName, email, password, newPassword, currentPassword, oldPassword } = parsed.data;
    const nextPassword = newPassword ?? password;
    const previousPassword = currentPassword ?? oldPassword;
    const data = {};

    if (Object.prototype.hasOwnProperty.call(parsed.data, 'fullName')) {
      data.fullName = fullName ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(parsed.data, 'email')) {
      data.email = email ?? null;
    }

    if (nextPassword) {
      // The middleware user does not include passwordHash.
      const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!dbUser || !dbUser.active) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'User no longer exists or is inactive' },
        });
      }
      const passwordMatches = await bcrypt.compare(previousPassword, dbUser.passwordHash);
      if (!passwordMatches) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect' },
        });
      }

      data.passwordHash = await bcrypt.hash(nextPassword, 12);
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data,
    });

    res.json({
      success: true,
      user: toPublicUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
};

const logout = (_req, res) => {
  // Cookie attributes must match login for reliable removal.
  res.clearCookie('pdm_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
  res.json({ success: true });
};

module.exports = { login, me, updateMe, logout };
