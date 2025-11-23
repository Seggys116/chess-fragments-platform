import crypto from 'crypto';
import { cookies } from 'next/headers';
import { prisma } from './db';
import { NextRequest } from 'next/server';
import {
  createSession,
  getUserFromRequest as getUserFromReq,
  setSessionCookies,
  clearSessionCookies,
  validateAndCleanCookies,
  invalidateSession,
  invalidateAllUserSessions,
} from './auth/session';
import {
  generateTokenPair,
  extractBearerToken,
  verifyToken,
  TokenType,
} from './auth/jwt';

const SESSION_COOKIE_NAME = 'fragmentarena_session';
const SESSION_EXPIRY_DAYS = 30;

export function generateAccessCode(): string {
  // Generate 256-bit (32 bytes) random code, hex encoded
  return crypto.randomBytes(32).toString('hex');
}

export function hashAccessCode(code: string): string {
  // SHA-256 hash for session token
  return crypto.createHash('sha256').update(code).digest('hex');
}

export async function createUser(): Promise<{ userId: string; accessCode: string }> {
  const accessCode = generateAccessCode();
  const hashedAccessCode = hashAccessCode(accessCode);

  const user = await prisma.user.create({
    data: {
      accessCode,
      hashedAccessCode, // Store hashed version too
    },
  });

  return {
    userId: user.id,
    accessCode,
  };
}

export async function verifyAccessCode(code: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { accessCode: code },
  });

  if (!user) {
    return null;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastActive: new Date() },
  });

  return user.id;
}

export async function getUserFromAccessCode(code: string) {
  if (!code) return null;

  const user = await prisma.user.findUnique({
    where: { accessCode: code },
    include: {
      agents: {
        where: { active: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActive: new Date() },
    });
  }

  return user;
}

/**
 * New function: Get user from request (supports JWT and legacy access codes)
 * This was missing and causing import errors
 */
export async function getUserFromRequest(request: NextRequest) {
  // Use the session module's implementation
  const sessionUser = await getUserFromReq(request);

  if (!sessionUser) return null;

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    include: {
      agents: {
        where: { active: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  return user;
}

/**
 * Create and set JWT session for a user
 */
export async function createUserSession(
  userId: string,
  request?: NextRequest,
  rememberMe = false
): Promise<{ accessToken: string; refreshToken: string }> {
  const ipAddress = request?.headers.get('x-forwarded-for')?.split(',')[0] ||
                   request?.headers.get('x-real-ip') ||
                   undefined;
  const userAgent = request?.headers.get('user-agent') || undefined;

  const { session, tokens } = await createSession(userId, ipAddress, userAgent);

  await setSessionCookies(tokens.accessToken, tokens.refreshToken, rememberMe);

  return tokens;
}

/**
 * Legacy function - now creates JWT session instead
 */
export async function setSessionCookie(accessCode: string) {
  const user = await prisma.user.findUnique({
    where: { accessCode },
  });

  if (!user) {
    throw new Error('Invalid access code');
  }

  const { accessToken } = await createUserSession(user.id, undefined, true);

  // Also set legacy cookie for backward compatibility
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, accessCode, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60,
    path: '/',
  });
}

/**
 * Get session cookie (checks JWT first, then legacy)
 */
export async function getSessionCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();

  const jwtCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (jwtCookie?.value) {
    const payload = verifyToken(jwtCookie.value, TokenType.ACCESS);
    if (payload) {
      return jwtCookie.value;
    }
  }

  // Fallback to legacy cookie
  return cookieStore.get('fragmentarena_session')?.value;
}

/**
 * Clear all session cookies (JWT and legacy)
 */
export async function clearSessionCookie() {
  await clearSessionCookies();
}

/**
 * Invalidate user session (logout)
 */
export async function logoutUser(request: NextRequest): Promise<boolean> {
  const user = await getUserFromRequest(request);
  if (!user) return false;

  // Invalidate all user sessions
  await invalidateAllUserSessions(user.id);

  // Clear cookies
  await clearSessionCookies();

  return true;
}

/**
 * Validate session from request
 */
export async function validateSession(request: NextRequest): Promise<boolean> {
  return await validateAndCleanCookies(request);
}

/**
 * Check if a request has valid authentication
 */
export async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const user = await getUserFromRequest(request);
  return user !== null;
}

/**
 * Get access token from request
 */
export async function getTokenFromRequest(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  const bearerToken = extractBearerToken(authHeader);
  if (bearerToken) return bearerToken;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (sessionCookie?.value) {
    const payload = verifyToken(sessionCookie.value, TokenType.ACCESS);
    if (payload) return sessionCookie.value;
  }

  return request.headers.get('x-access-code');
}

// Export session functions for use in API routes
export {
  createSession,
  invalidateSession,
  invalidateAllUserSessions,
  setSessionCookies,
  clearSessionCookies,
  validateAndCleanCookies,
} from './auth/session';

export {
  generateTokenPair,
  verifyToken,
  TokenType,
} from './auth/jwt';