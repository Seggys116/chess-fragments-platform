import { z } from 'zod';
import { validateAgentName } from './profanity';

export const uuidSchema = z.string().uuid();

export const accessCodeSchema = z.string().min(32).max(64);

export const agentNameSchema = z.string().min(1).max(50).regex(
  /^[a-zA-Z0-9_\-\s]+$/,
  'Agent name can only contain letters, numbers, spaces, underscores, and hyphens'
).refine(
  (name) => {
    const validation = validateAgentName(name);
    return validation.valid;
  },
  {
    message: 'Agent name contains inappropriate or offensive language. Please choose a different name.'
  }
);

export const agentCodeSchema = z.string().min(10).max(1073741824).refine(
  (code) => {
    return code.includes('def agent(board, player, var):');
  },
  'Code must include the required agent function signature'
).refine(
  (code) => {
    const forbidden = ['import os', 'import subprocess', 'import socket',
                      'import urllib', 'import requests', 'import sys',
                      'from os', 'from subprocess', 'from socket',
                      'from urllib', 'from requests', 'from sys',
                      '__import__', 'eval(', 'exec(', 'compile('];
    return !forbidden.some(pattern => code.includes(pattern));
  },
  'Code contains forbidden imports or functions'
);

// Pagination schemas
export const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

// Sort order
export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

// Match status
export const matchStatusSchema = z.enum(['pending', 'active', 'completed', 'error']);

// API Request validation schemas
export const authVerifySchema = z.object({
  accessCode: accessCodeSchema,
});

export const authGenerateSchema = z.object({
  signupCode: z.string().optional(),
});

export const agentUploadSchema = z.object({
  name: agentNameSchema,
  code: agentCodeSchema,
});

export const agentUpdateSchema = z.object({
  name: agentNameSchema.optional(),
  code: agentCodeSchema.optional(),
  active: z.boolean().optional(),
}).refine(
  (data) => data.name || data.code || data.active !== undefined,
  'At least one field must be provided for update'
);

export const createMatchSchema = z.object({
  whiteAgentId: uuidSchema,
  blackAgentId: uuidSchema,
  isExhibition: z.boolean().default(false),
});

export const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  includeInactive: z.boolean().default(false),
});

export function sanitizeInput(input: string): string {
  // Remove any HTML tags
  let sanitized = input.replace(/<[^>]*>/g, '');

  // Escape special characters
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\//g, '&#x2F;');

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

export function sanitizeSqlIdentifier(identifier: string): string {
  // Only allow alphanumeric characters and underscores
  return identifier.replace(/[^a-zA-Z0-9_]/g, '');
}

export function validateJson<T>(
  input: unknown,
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: string } {
  try {
    const parsed = schema.parse(input);
    return { success: true, data: parsed };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return { success: false, error: errors };
    }
    return { success: false, error: 'Invalid input' };
  }
}

export function sanitizeRateLimitKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9:_\-]/g, '');
}

export function isValidFilePath(path: string): boolean {
  const dangerous = ['../', '..\\', '..', './', '.\\'];
  return !dangerous.some(pattern => path.includes(pattern));
}

export const ipAddressSchema = z.string().refine(
  (val) => {
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6 = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^::1$/;
    return ipv4.test(val) || ipv6.test(val) || val === 'unknown';
  },
  'Invalid IP address format'
);


export const urlSchema = z.string().url().refine(
  (url) => {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  },
  'Only HTTP and HTTPS URLs are allowed'
);

export const emailSchema = z.string().email();

export function validateHeaders(headers: Headers): {
  clientIp: string;
  userAgent: string;
  origin: string | null;
} {
  const forwardedFor = headers.get('x-forwarded-for');
  const realIp = headers.get('x-real-ip');
  const clientIp = forwardedFor?.split(',')[0].trim() || realIp || 'unknown';

  const userAgent = headers.get('user-agent') || 'unknown';
  const origin = headers.get('origin');

  return {
    clientIp: sanitizeInput(clientIp),
    userAgent: sanitizeInput(userAgent),
    origin: origin ? sanitizeInput(origin) : null,
  };
}

export function createSafeErrorResponse(
  error: unknown,
  statusCode: number = 500
): Response {
  console.error('API Error:', error);

  let message = 'An error occurred processing your request';
  let details: string | undefined;

  if (statusCode === 400) {
    message = 'Invalid request';
    if (error instanceof z.ZodError) {
      details = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    } else if (error instanceof Error) {
      details = error.message;
    }
  } else if (statusCode === 401) {
    message = 'Unauthorized';
  } else if (statusCode === 403) {
    message = 'Forbidden';
  } else if (statusCode === 404) {
    message = 'Not found';
  } else if (statusCode === 429) {
    message = 'Too many requests';
  }

  return new Response(
    JSON.stringify({
      error: message,
      ...(details && process.env.NODE_ENV === 'development' ? { details } : {}),
    }),
    {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

export function validateEnvVar(name: string, required = true): string | undefined {
  const value = process.env[name];

  if (required && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function parseIntSafe(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;

  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function parseBoolSafe(value: string | undefined, defaultValue = false): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}