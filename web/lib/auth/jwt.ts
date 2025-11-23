import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'development-secret-change-in-production';
const JWT_ACCESS_EXPIRY = '1h'; // 1 hour for API access
const JWT_REFRESH_EXPIRY = '7d'; // 7 days (1 week) for refresh token

// Token types
export enum TokenType {
  ACCESS = 'access',
  REFRESH = 'refresh',
}

// Token payload interface
export interface TokenPayload {
  userId: string;
  type: TokenType;
  sessionId?: string;
  iat?: number;
  exp?: number;
}

// Token response interface
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

/**
 * Generate a JWT access token (1 hour expiry)
 */
export function generateAccessToken(userId: string, sessionId?: string): string {
  const payload: TokenPayload = {
    userId,
    type: TokenType.ACCESS,
    sessionId,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRY,
    issuer: 'fragmentarena',
    audience: 'api',
  });
}

/**
 * Generate a JWT refresh token (30 days expiry)
 */
export function generateRefreshToken(userId: string, sessionId: string): string {
  const payload: TokenPayload = {
    userId,
    type: TokenType.REFRESH,
    sessionId,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRY,
    issuer: 'fragmentarena',
    audience: 'refresh',
  });
}

/**
 * Generate both access and refresh tokens
 */
export function generateTokenPair(userId: string, sessionId: string): TokenPair {
  const accessToken = generateAccessToken(userId, sessionId);
  const refreshToken = generateRefreshToken(userId, sessionId);

  return {
    accessToken,
    refreshToken,
    expiresIn: 3600, // 1 hour in seconds
  };
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string, type: TokenType = TokenType.ACCESS): TokenPayload | null {
  try {
    const audience = type === TokenType.ACCESS ? 'api' : 'refresh';
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'fragmentarena',
      audience,
    }) as TokenPayload;

    if (decoded.type !== type) {
      console.error('Token type mismatch:', decoded.type, 'expected:', type);
      return null;
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      console.error('Token expired:', error.message);
    } else if (error instanceof jwt.JsonWebTokenError) {
      console.error('Invalid token:', error.message);
    } else {
      console.error('Token verification error:', error);
    }
    return null;
  }
}

/**
 * Check if a token is expired
 */
export function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwt.decode(token) as TokenPayload;
    if (!decoded || !decoded.exp) return true;

    const now = Math.floor(Date.now() / 1000);
    return decoded.exp < now;
  } catch {
    return true;
  }
}

/**
 * Get token expiry time in seconds
 */
export function getTokenExpiry(token: string): number | null {
  try {
    const decoded = jwt.decode(token) as TokenPayload;
    if (!decoded || !decoded.exp) return null;

    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, decoded.exp - now);
  } catch {
    return null;
  }
}

/**
 * Hash a token for storage (for refresh tokens)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Extract bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Generate a secure session ID
 */
export function generateSessionId(): string {
  return createHash('sha256')
    .update(Date.now().toString() + Math.random().toString())
    .digest('hex');
}

/**
 * Decode token without verification (for debugging/logging only)
 */
export function decodeToken(token: string): TokenPayload | null {
  try {
    return jwt.decode(token) as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * Create a short-lived token for specific operations (e.g., email verification)
 */
export function createOperationToken(userId: string, operation: string, expiresIn = '15m'): string {
  const payload = {
    userId,
    operation,
    type: 'operation',
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    issuer: 'fragmentarena',
    audience: operation,
  });
}

/**
 * Verify an operation token
 */
export function verifyOperationToken(token: string, operation: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'fragmentarena',
      audience: operation,
    }) as any;

    if (decoded.type !== 'operation' || decoded.operation !== operation) {
      return null;
    }

    return { userId: decoded.userId };
  } catch {
    return null;
  }
}