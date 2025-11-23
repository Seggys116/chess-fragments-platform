import { prisma } from '../db';
import {
  generateTokenPair,
  verifyToken,
  TokenType,
  hashToken,
  generateSessionId,
  extractBearerToken,
  TokenPayload,
} from './jwt';
import { createHash } from 'crypto';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

// Lazy load Redis to avoid Edge Runtime issues
let redis: any = null;
async function getRedis() {
  if (!redis) {
    try {
      const redisModule = await import('../redis');
      redis = redisModule.redis;
    } catch (error) {
      console.warn('Redis not available:', error);
    }
  }
  return redis;
}

// Session configuration
const SESSION_COOKIE_NAME = 'fragmentarena_session';
const REFRESH_COOKIE_NAME = 'fragmentarena_refresh';
const SESSION_CACHE_TTL = 300; // 5 minutes cache

export interface Session {
  id: string;
  userId: string;
  refreshToken: string; // hashed version
  accessToken?: string; // current access token (not stored in DB)
  expiresAt: Date;
  createdAt: Date;
  lastUsed: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface SessionUser {
  id: string;
  accessCode: string;
  hashedAccessCode?: string;
  createdAt: Date;
  lastActive: Date;
}

/**
 * Create a new session for a user
 */
export async function createSession(
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ session: Session; tokens: ReturnType<typeof generateTokenPair> }> {
  const sessionId = generateSessionId();
  const tokens = generateTokenPair(userId, sessionId);
  const hashedRefreshToken = hashToken(tokens.refreshToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days (1 week)

  const session = await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      refreshToken: hashedRefreshToken,
      expiresAt,
      ipAddress,
      userAgent,
      lastUsed: new Date(),
    },
  });

  // Cache session in Redis for fast lookups
  await cacheSession(sessionId, {
    ...session,
    accessToken: tokens.accessToken,
  });

  return {
    session: {
      ...session,
      accessToken: tokens.accessToken,
    },
    tokens,
  };
}

/**
 * Validate and get session from access token
 */
export async function validateAccessToken(token: string): Promise<SessionUser | null> {
  const payload = verifyToken(token, TokenType.ACCESS);
  if (!payload || !payload.userId) return null;

  // Try to get user from cache first
  const cached = await getCachedUser(payload.userId);
  if (cached) return cached;

  // Fallback to database
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      accessCode: true,
      hashedAccessCode: true,
      createdAt: true,
      lastActive: true,
    },
  });

  if (user) {
    await cacheUser(user.id, user);
  }

  return user;
}

/**
 * Validate refresh token and generate new access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
} | null> {
  const payload = verifyToken(refreshToken, TokenType.REFRESH);
  if (!payload || !payload.sessionId) return null;

  const hashedRefreshToken = hashToken(refreshToken);

  const session = await prisma.session.findUnique({
    where: {
      id: payload.sessionId,
      refreshToken: hashedRefreshToken,
      expiresAt: { gt: new Date() },
    },
  });

  if (!session) return null;

  await prisma.session.update({
    where: { id: session.id },
    data: { lastUsed: new Date() },
  });

  // Generate new access token
  const accessToken = generateTokenPair(session.userId, session.id).accessToken;

  return {
    accessToken,
    expiresIn: 3600, // 1 hour
  };
}

/**
 * Invalidate a session (logout)
 */
export async function invalidateSession(sessionId: string): Promise<boolean> {
  try {
    await prisma.session.delete({
      where: { id: sessionId },
    });

    // Remove from cache
    await clearCachedSession(sessionId);

    return true;
  } catch (error) {
    console.error('Failed to invalidate session:', error);
    return false;
  }
}

/**
 * Invalidate all sessions for a user
 */
export async function invalidateAllUserSessions(userId: string): Promise<number> {
  try {
    const result = await prisma.session.deleteMany({
      where: { userId },
    });

    // Clear user cache
    await clearCachedUser(userId);

    return result.count;
  } catch (error) {
    console.error('Failed to invalidate user sessions:', error);
    return 0;
  }
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(): Promise<number> {
  try {
    const result = await prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    return result.count;
  } catch (error) {
    console.error('Failed to cleanup expired sessions:', error);
    return 0;
  }
}

/**
 * Get user from request (supports both JWT and legacy access codes)
 */
export async function getUserFromRequest(request: NextRequest): Promise<SessionUser | null> {
  // Try JWT first (Authorization header)
  const authHeader = request.headers.get('authorization');
  const bearerToken = extractBearerToken(authHeader);

  if (bearerToken) {
    const user = await validateAccessToken(bearerToken);
    if (user) return user;
  }

  // Try JWT from cookie
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

  if (sessionCookie?.value) {
    const user = await validateAccessToken(sessionCookie.value);
    if (user) return user;
  }

  // Fallback to legacy access code (for backward compatibility)
  const accessCode = request.headers.get('x-access-code') ||
                    cookieStore.get('fragmentarena_session')?.value;

  if (accessCode) {
    const user = await validateLegacyAccessCode(accessCode);
    if (user) {
      // Migrate to new session system
      await migrateLegacyUser(user.id);
      return user;
    }
  }

  return null;
}

/**
 * Validate legacy access code
 */
async function validateLegacyAccessCode(accessCode: string): Promise<SessionUser | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { accessCode },
      select: {
        id: true,
        accessCode: true,
        hashedAccessCode: true,
        createdAt: true,
        lastActive: true,
      },
    });

    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastActive: new Date() },
      });
    }

    return user;
  } catch (error) {
    console.error('Failed to validate legacy access code:', error);
    return null;
  }
}

/**
 * Migrate legacy user to new session system
 */
async function migrateLegacyUser(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accessCode: true, hashedAccessCode: true },
    });

    if (user && !user.hashedAccessCode) {
      // Hash the existing access code
      const hashedAccessCode = createHash('sha256')
        .update(user.accessCode)
        .digest('hex');

      await prisma.user.update({
        where: { id: userId },
        data: { hashedAccessCode },
      });
    }
  } catch (error) {
    console.error('Failed to migrate legacy user:', error);
  }
}

/**
 * Set session cookies
 */
export async function setSessionCookies(
  accessToken: string,
  refreshToken: string,
  rememberMe = false
): Promise<void> {
  const cookieStore = await cookies();

  // Access token cookie (1 hour)
  cookieStore.set(SESSION_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 3600, // 1 hour
  });

  // Refresh token cookie (7 days if remember me)
  if (rememberMe) {
    cookieStore.set(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days (1 week)
    });
  }
}

/**
 * Clear session cookies
 */
export async function clearSessionCookies(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.delete(SESSION_COOKIE_NAME);
  cookieStore.delete(REFRESH_COOKIE_NAME);
  cookieStore.delete('fragmentarena_session'); // Clear legacy cookie too
}

/**
 * Validate and clear invalid cookies
 */
export async function validateAndCleanCookies(request: NextRequest): Promise<boolean> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  const refreshCookie = cookieStore.get(REFRESH_COOKIE_NAME);
  const legacyCookie = cookieStore.get('fragmentarena_session');

  let hasValidSession = false;

  if (sessionCookie?.value) {
    const user = await validateAccessToken(sessionCookie.value);
    if (!user) {
      cookieStore.delete(SESSION_COOKIE_NAME);
    } else {
      hasValidSession = true;
    }
  }

  if (refreshCookie?.value && !hasValidSession) {
    const newTokens = await refreshAccessToken(refreshCookie.value);
    if (!newTokens) {
      cookieStore.delete(REFRESH_COOKIE_NAME);
    } else {
      cookieStore.set(SESSION_COOKIE_NAME, newTokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: newTokens.expiresIn,
      });
      hasValidSession = true;
    }
  }

  if (legacyCookie?.value && !hasValidSession) {
    const user = await validateLegacyAccessCode(legacyCookie.value);
    if (!user) {
      cookieStore.delete('fragmentarena_session');
    } else {
      hasValidSession = true;
    }
  }

  return hasValidSession;
}

// Redis caching functions

async function cacheSession(sessionId: string, session: any): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    await redis.setex(
      `session:${sessionId}`,
      SESSION_CACHE_TTL,
      JSON.stringify(session)
    );
  } catch (error) {
    console.error('Failed to cache session:', error);
  }
}

async function getCachedSession(sessionId: string): Promise<any | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    const cached = await redis.get(`session:${sessionId}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('Failed to get cached session:', error);
    return null;
  }
}

async function clearCachedSession(sessionId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    await redis.del(`session:${sessionId}`);
  } catch (error) {
    console.error('Failed to clear cached session:', error);
  }
}

async function cacheUser(userId: string, user: any): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    await redis.setex(
      `user:${userId}`,
      SESSION_CACHE_TTL,
      JSON.stringify(user)
    );
  } catch (error) {
    console.error('Failed to cache user:', error);
  }
}

async function getCachedUser(userId: string): Promise<SessionUser | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    const cached = await redis.get(`user:${userId}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('Failed to get cached user:', error);
    return null;
  }
}

async function clearCachedUser(userId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    await redis.del(`user:${userId}`);
  } catch (error) {
    console.error('Failed to clear cached user:', error);
  }
}