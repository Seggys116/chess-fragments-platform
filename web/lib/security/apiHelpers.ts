import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSecurityHeaders, API_RESPONSE } from './config';
import { monitor } from './monitor';
import { validateHeaders, createSafeErrorResponse } from './validation';
import { getUserFromRequest } from '../auth';

interface HandlerOptions {
  requireAuth?: boolean;
  validateBody?: z.ZodSchema;
  validateQuery?: z.ZodSchema;
  rateLimit?: {
    requests: number;
    window: number;
  };
}

export function withSecurity<T = any>(
  handler: (req: NextRequest, context: any) => Promise<NextResponse>,
  options: HandlerOptions = {}
) {
  return async (req: NextRequest, context: any): Promise<NextResponse> => {
    const start = Date.now();
    const { clientIp, userAgent } = validateHeaders(req.headers);

    try {
      const isBlocked = await monitor.isIpBlocked(clientIp);
      if (isBlocked) {
        await monitor.logSecurityEvent({
          type: 'blocked_request',
          ip: clientIp,
          endpoint: req.url,
          details: { userAgent },
          timestamp: new Date(),
        });

        return createApiError('Forbidden', 403);
      }

      let user = null;
      if (options.requireAuth) {
        user = await getUserFromRequest(req);
        if (!user) {
          await monitor.logSecurityEvent({
            type: 'auth_failure',
            ip: clientIp,
            endpoint: req.url,
            details: { reason: 'Missing or invalid session' },
            timestamp: new Date(),
          });

          return createApiError('Unauthorized', 401);
        }
      }

      let body = null;
      if (options.validateBody && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
        try {
          const rawBody = await req.json();
          body = options.validateBody.parse(rawBody);
        } catch (error) {
          await monitor.logSecurityEvent({
            type: 'validation_error',
            ip: clientIp,
            userId: user?.id,
            endpoint: req.url,
            details: { error: error instanceof z.ZodError ? error.errors : String(error) },
            timestamp: new Date(),
          });

          if (error instanceof z.ZodError) {
            return createApiError(
              error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
              400
            );
          }
          return createApiError('Invalid request body', 400);
        }
      }

      let query = null;
      if (options.validateQuery) {
        try {
          const searchParams = new URL(req.url).searchParams;
          const queryObj = Object.fromEntries(searchParams.entries());
          query = options.validateQuery.parse(queryObj);
        } catch (error) {
          if (error instanceof z.ZodError) {
            return createApiError(
              error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
              400
            );
          }
          return createApiError('Invalid query parameters', 400);
        }
      }

      // Track request
      monitor.trackRequest(req.url, user?.id);

      // Modify request to include parsed data
      const modifiedReq = req as any;
      if (body) modifiedReq.body = body;
      if (query) modifiedReq.query = query;
      if (user) modifiedReq.user = user;

      // Call the actual handler
      const response = await handler(modifiedReq, context);

      // Track response time
      monitor.trackResponseTime(Date.now() - start);

      // Add security headers to response
      const headers = getSecurityHeaders();
      Object.entries(headers).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      return response;

    } catch (error) {
      // Track error
      monitor.trackError(req.url, error);

      if (error instanceof Error && error.message.includes('JSON')) {
        await monitor.logSecurityEvent({
          type: 'suspicious_activity',
          ip: clientIp,
          endpoint: req.url,
          details: { error: error.message },
          timestamp: new Date(),
        });
      }

      return createApiError('Internal server error', 500);
    }
  };
}

export function createApiResponse<T>(data: T, statusCode = 200): NextResponse {
  const response = NextResponse.json(
    {
      ...API_RESPONSE.SUCCESS_FORMAT,
      data,
      timestamp: new Date().toISOString(),
    },
    { status: statusCode }
  );

  // Add security headers
  const headers = getSecurityHeaders();
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

export function createApiError(
  message: string,
  statusCode = 500,
  code?: string
): NextResponse {
  const errorCode = code || Object.entries(API_RESPONSE.ERROR_CODES).find(
    ([_, c]) => {
      switch (statusCode) {
        case 400: return c === 'VALIDATION_ERROR';
        case 401: return c === 'UNAUTHORIZED';
        case 403: return c === 'FORBIDDEN';
        case 404: return c === 'NOT_FOUND';
        case 409: return c === 'CONFLICT';
        case 429: return c === 'RATE_LIMIT_EXCEEDED';
        case 504: return c === 'TIMEOUT';
        default: return c === 'INTERNAL_ERROR';
      }
    }
  )?.[1] || 'INTERNAL_ERROR';

  const response = NextResponse.json(
    {
      ...API_RESPONSE.ERROR_FORMAT,
      error: message,
      code: errorCode,
      timestamp: new Date().toISOString(),
    },
    { status: statusCode }
  );

  // Add security headers
  const headers = getSecurityHeaders();
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

export function getPaginationParams(searchParams: URLSearchParams): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'));

  return { limit, offset };
}

export async function validateOwnership(
  userId: string,
  resourceOwnerId: string,
  resourceType = 'resource'
): Promise<boolean> {
  if (userId !== resourceOwnerId) {
    await monitor.logSecurityEvent({
      type: 'auth_failure',
      ip: 'unknown',
      userId,
      endpoint: 'ownership-check',
      details: {
        resourceType,
        attemptedAccess: resourceOwnerId,
      },
      timestamp: new Date(),
    });
    return false;
  }
  return true;
}

export function validateFileUpload(
  file: File,
  options: {
    maxSize?: number;
    allowedTypes?: string[];
  } = {}
): { valid: boolean; error?: string } {
  const { maxSize = 10 * 1024 * 1024, allowedTypes = [] } = options; // Default 10MB

  if (file.size > maxSize) {
    return { valid: false, error: `File size exceeds maximum of ${maxSize} bytes` };
  }

  if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
    return { valid: false, error: `File type ${file.type} is not allowed` };
  }

  const suspiciousPatterns = ['../', '..\\', '<', '>', '|', '&', ';', '$', '`'];
  if (suspiciousPatterns.some(pattern => file.name.includes(pattern))) {
    return { valid: false, error: 'File name contains suspicious characters' };
  }

  return { valid: true };
}

export function withWebSocketSecurity(
  handler: (ws: any, req: NextRequest) => void
) {
  return async (ws: any, req: NextRequest) => {
    const { clientIp } = validateHeaders(req.headers);

    const isBlocked = await monitor.isIpBlocked(clientIp);
    if (isBlocked) {
      ws.close(1008, 'Forbidden');
      return;
    }

    // Track WebSocket connection
    monitor.trackRequest(`ws:${req.url}`, undefined);

    try {
      handler(ws, req);
    } catch (error) {
      monitor.trackError(`ws:${req.url}`, error);
      ws.close(1011, 'Internal server error');
    }
  };
}

export function isTrustedSource(req: NextRequest): boolean {
  const { clientIp } = validateHeaders(req.headers);

  const allowlist = process.env.IP_ALLOWLIST?.split(',') || [];
  if (allowlist.includes(clientIp)) {
    return true;
  }

  const internalIPs = ['127.0.0.1', '::1', 'localhost'];
  if (internalIPs.includes(clientIp)) {
    return process.env.NODE_ENV === 'development';
  }

  return false;
}

export function validateBatch<T>(
  items: any[],
  schema: z.ZodSchema<T>,
  maxBatchSize = 100
): { valid: T[]; invalid: { index: number; error: string }[] } {
  if (items.length > maxBatchSize) {
    throw new Error(`Batch size exceeds maximum of ${maxBatchSize}`);
  }

  const valid: T[] = [];
  const invalid: { index: number; error: string }[] = [];

  items.forEach((item, index) => {
    try {
      valid.push(schema.parse(item));
    } catch (error) {
      if (error instanceof z.ZodError) {
        invalid.push({
          index,
          error: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
        });
      } else {
        invalid.push({ index, error: String(error) });
      }
    }
  });

  return { valid, invalid };
}