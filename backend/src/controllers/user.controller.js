const bcrypt = require('bcrypt');
const { z } = require('zod');
const prisma = require('../config/prisma');

const VALID_ROLES = ['ADMIN', 'OPERATOR', 'ENGINEER', 'VIEWER'];
const USER_SELECT = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  role: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(VALID_ROLES).default('VIEWER'),
});

const updateUserSchema = z.object({
  role: z.enum(VALID_ROLES).optional(),
  active: z.boolean().optional(),
  fullName: z.string().trim().max(100).nullable().optional(),
  email: z.string().email().nullable().optional(),
  password: z.string().min(8).max(128).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

const getUsersQuerySchema = z.object({
  role: z.enum(VALID_ROLES).optional(),
});

const toAuditUserSnapshot = (user) => ({
  id: user.id,
  username: user.username,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  active: user.active,
});

const getUsers = async (req, res, next) => {
  try {
    const parsed = getUsersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message },
      });
    }

    const where = parsed.data.role ? { role: parsed.data.role } : {};

    const users = await prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    next(error);
  }
};

const createUser = async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message, detail: parsed.error.issues },
      });
    }

    const { username, password, fullName, email, role } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { username, passwordHash, fullName, email, role },
      });

      await tx.auditLog.create({
        data: {
          entityType: 'AUTH',
          entityId: createdUser.id,
          action: 'USER_CREATE',
          actorUserId: req.user.id,
          payloadJson: {
            after: toAuditUserSnapshot(createdUser),
          },
        },
      });

      return createdUser;
    });

    const { passwordHash: _, ...userWithoutPassword } = user;

    res.status(201).json({
      success: true,
      data: userWithoutPassword,
    });
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message, detail: parsed.error.issues },
      });
    }

    const { id } = req.params;
    const { password, ...rest } = parsed.data;

    if (password && req.user.id === id) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SELF_PASSWORD_RESET_NOT_ALLOWED',
          message: 'Use PATCH /auth/me to change your own password (requires current password).',
        },
      });
    }

    // Password material is excluded from audit snapshots.
    const updateData = { ...rest };
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 12);
    }

    const user = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { id } });
      if (!existingUser) {
        const notFoundError = new Error('NOT_FOUND: User not found');
        throw notFoundError;
      }

      const updatedUser = await tx.user.update({
        where: { id },
        data: updateData,
      });

      await tx.auditLog.create({
        data: {
          entityType: 'AUTH',
          entityId: updatedUser.id,
          action: password ? 'USER_UPDATE_WITH_PASSWORD_RESET' : 'USER_UPDATE',
          actorUserId: req.user.id,
          payloadJson: {
            before: toAuditUserSnapshot(existingUser),
            after: toAuditUserSnapshot(updatedUser),
            passwordReset: Boolean(password),
          },
        },
      });

      return updatedUser;
    });

    const { passwordHash: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      data: userWithoutPassword,
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.id === id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You cannot delete your own account' },
      });
    }

    await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { id } });
      if (!existingUser) {
        const notFoundError = new Error('NOT_FOUND: User not found');
        throw notFoundError;
      }

      const updatedUser = await tx.user.update({
        where: { id },
        data: { active: false },
      });

      await tx.auditLog.create({
        data: {
          entityType: 'AUTH',
          entityId: updatedUser.id,
          action: 'USER_DELETE',
          actorUserId: req.user.id,
          payloadJson: {
            before: toAuditUserSnapshot(existingUser),
            after: toAuditUserSnapshot(updatedUser),
          },
        },
      });
    });

    res.json({ success: true, message: 'User deactivated successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
};
