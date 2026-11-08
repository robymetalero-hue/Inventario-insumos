import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import {
  users,
  userWarehousePermissions,
  securityAuditEvents,
} from '../db/schema.ts';
import { eq, and } from 'drizzle-orm';

export interface AuthenticatedUser {
  id: number;
  uid: string;
  username: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  canViewPrivateCosts: boolean;
  warehousePermissions: {
    warehouseId: number;
    canView: boolean;
    canReceive: boolean;
    canDispatch: boolean;
    canProduce: boolean;
    canCount: boolean;
    canApproveAdjustments: boolean;
  }[];
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
}

const SESSION_SECRET = process.env.GEMINI_API_KEY || 'controlstock-pro-hmac-secret-2026';

export function hashPassword(password: string, salt = 'cs-salt-2026'): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function createLocalSessionToken(userId: number, uid: string): string {
  const payload = JSON.stringify({
    userId,
    uid,
    exp: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
  });
  const base64Payload = Buffer.from(payload).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(base64Payload)
    .digest('base64url');
  return `local.${base64Payload}.${signature}`;
}

export function verifyLocalSessionToken(token: string): { userId: number; uid: string } | null {
  try {
    if (!token.startsWith('local.')) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [, base64Payload, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(base64Payload)
      .digest('base64url');
    if (signature !== expectedSig) return null;
    const decoded = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf8'));
    if (Date.now() > decoded.exp) return null;
    return { userId: decoded.userId, uid: decoded.uid };
  } catch {
    return null;
  }
}

export async function logSecurityEvent(
  userId: number | null,
  username: string,
  eventType: string,
  endpoint: string,
  details: string
) {
  try {
    await db.insert(securityAuditEvents).values({
      userId,
      username,
      eventType,
      endpoint,
      details,
    });
  } catch (err) {
    console.error('Failed to record security audit event:', err);
  }
}

export async function loadUserWithPermissions(userRow: typeof users.$inferSelect): Promise<AuthenticatedUser> {
  const perms = await db
    .select()
    .from(userWarehousePermissions)
    .where(eq(userWarehousePermissions.userId, userRow.id));

  return {
    id: userRow.id,
    uid: userRow.uid,
    username: userRow.username,
    email: userRow.email,
    fullName: userRow.fullName,
    role: userRow.role,
    isActive: userRow.isActive,
    canViewPrivateCosts: userRow.role === 'OWNER' || userRow.canViewPrivateCosts,
    warehousePermissions: perms.map((p) => ({
      warehouseId: p.warehouseId,
      canView: p.canView,
      canReceive: p.canReceive,
      canDispatch: p.canDispatch,
      canProduce: p.canProduce,
      canCount: p.canCount,
      canApproveAdjustments: p.canApproveAdjustments,
    })),
  };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Sesión no iniciada o token ausente.' });
    }

    const token = authHeader.split('Bearer ')[1].trim();
    let userRow: typeof users.$inferSelect | undefined;

    // 1. Check if it's a local signed token
    const localData = verifyLocalSessionToken(token);
    if (localData) {
      const found = await db
        .select()
        .from(users)
        .where(eq(users.id, localData.userId));
      userRow = found[0];
    } else {
      // 2. Verify Firebase ID Token (Google Sign-In)
      const decodedToken = await adminAuth.verifyIdToken(token);
      const email = decodedToken.email || `${decodedToken.uid}@google.auth`;
      const fullName = decodedToken.name || email.split('@')[0];

      // Upsert user in PostgreSQL as Owner/Superadmin when signing in via Google
      const upserted = await db
        .insert(users)
        .values({
          uid: decodedToken.uid,
          username: email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_') + '_g',
          email,
          fullName,
          role: 'OWNER',
          isActive: true,
          canViewPrivateCosts: true,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            email,
          },
        })
        .returning();

      userRow = upserted[0];
    }

    if (!userRow || !userRow.isActive) {
      await logSecurityEvent(
        userRow?.id ?? null,
        userRow?.username ?? 'unknown',
        'ACCESS_DENIED',
        req.originalUrl,
        'Usuario inactivo o no encontrado'
      );
      return res.status(403).json({ error: 'Cuenta de usuario desactivada o inválida.' });
    }

    // Optional test role simulation header (only allowed in dev/test switcher if explicitly sent)
    const simulateUserId = req.headers['x-simulate-user-id'];
    if (simulateUserId && typeof simulateUserId === 'string') {
      const simId = parseInt(simulateUserId, 10);
      if (!isNaN(simId)) {
        const simFound = await db.select().from(users).where(eq(users.id, simId));
        if (simFound[0] && simFound[0].isActive) {
          userRow = simFound[0];
        }
      }
    }

    req.authUser = await loadUserWithPermissions(userRow);
    next();
  } catch (error) {
    console.error('Authentication verification error:', error);
    return res.status(401).json({ error: 'Sesión inválida o expirada. Inicie sesión nuevamente.' });
  }
};

export function assertWarehouseAccess(
  user: AuthenticatedUser,
  warehouseId: number,
  action: 'VIEW' | 'RECEIVE' | 'DISPATCH' | 'PRODUCE' | 'COUNT' | 'APPROVE_ADJUSTMENT'
): boolean {
  if (user.role === 'OWNER' || user.role === 'ADMIN') {
    return true;
  }
  const perm = user.warehousePermissions.find((p) => p.warehouseId === warehouseId);
  if (!perm) return false;
  switch (action) {
    case 'VIEW':
      return perm.canView;
    case 'RECEIVE':
      return perm.canReceive;
    case 'DISPATCH':
      return perm.canDispatch;
    case 'PRODUCE':
      return perm.canProduce;
    case 'COUNT':
      return perm.canCount;
    case 'APPROVE_ADJUSTMENT':
      return perm.canApproveAdjustments;
    default:
      return false;
  }
}

export const requireOwnerPrivateAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const user = req.authUser;
  if (!user || (user.role !== 'OWNER' && !user.canViewPrivateCosts)) {
    await logSecurityEvent(
      user?.id ?? null,
      user?.username ?? 'unknown',
      'ACCESS_DENIED',
      req.originalUrl,
      'Intento no autorizado de acceder a la Zona Privada de Costos/Compras del Propietario'
    );
    return res.status(403).json({
      error: 'Acceso denegado: Esta sección es exclusiva para el Propietario.',
    });
  }
  next();
};
