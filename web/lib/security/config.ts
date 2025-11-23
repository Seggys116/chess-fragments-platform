/**
 * Central security configuration for the Chess Fragments Platform API
 */

// CORS Configuration
export const CORS_CONFIG = {
  // Production domain
  PRODUCTION_ORIGIN: 'https://chesscomp.zaknobleclarke.com',

  // Allowed origins for CORS
  ALLOWED_ORIGINS: process.env.NODE_ENV === 'production'
    ? [
        'https://chesscomp.zaknobleclarke.com',
        'https://www.chesscomp.zaknobleclarke.com',
      ]
    : [
        'https://chesscomp.zaknobleclarke.com',
        'https://www.chesscomp.zaknobleclarke.com',
        'http://localhost:3000',
        'http://localhost:3892',
      ],

  // CORS headers configuration
  ALLOWED_METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  ALLOWED_HEADERS: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  CREDENTIALS: true,
  MAX_AGE: 86400, // 24 hours
};

// Rate Limiting Configuration
export const RATE_LIMIT_CONFIG = {
  // Global rate limits by endpoint type
  TIERS: {
    // Critical write operations
    upload: {
      requests: parseInt(process.env.UPLOAD_RATE_LIMIT_REQUESTS || '1'),
      windowMs: parseInt(process.env.UPLOAD_RATE_LIMIT_HOURS || '1') * 3600000,
      blockDuration: 3600000, // 1 hour block on violation
    },
    update: {
      requests: 5,
      windowMs: 3600000, // 1 hour
      blockDuration: 1800000, // 30 min block
    },
    create: {
      requests: 10,
      windowMs: 60000, // 1 minute
      blockDuration: 300000, // 5 min block
    },

    // Authenticated read operations
    dashboard: {
      requests: 60,
      windowMs: 60000,
      blockDuration: 60000, // 1 min block
    },
    analytics: {
      requests: 30,
      windowMs: 60000,
      blockDuration: 60000,
    },

    // Public read operations
    public: {
      requests: 100,
      windowMs: 60000,
      blockDuration: 30000, // 30 sec block
    },
    leaderboard: {
      requests: 120,
      windowMs: 60000,
      blockDuration: 30000,
    },
    matches: {
      requests: 200,
      windowMs: 60000,
      blockDuration: 30000,
    },

    // WebSocket connections
    websocket: {
      requests: 10,
      windowMs: 60000,
      blockDuration: 120000, // 2 min block
    },

    // Default fallback
    default: {
      requests: parseInt(process.env.GLOBAL_RATE_LIMIT_PER_MINUTE || '60'),
      windowMs: 60000,
      blockDuration: 60000,
    },
  },

  // Burst protection
  BURST_CONFIG: {
    maxBurst: 10, // Max requests in 1 second
    penaltyMultiplier: 2, // Double the block duration on burst
  },

  // IP-based global limits
  IP_LIMITS: {
    perMinute: parseInt(process.env.IP_RATE_LIMIT_PER_MINUTE || '100'),
    perHour: parseInt(process.env.IP_RATE_LIMIT_PER_HOUR || '3000'),
    perDay: parseInt(process.env.IP_RATE_LIMIT_PER_DAY || '50000'),
  },

  // User-based global limits
  USER_LIMITS: {
    perMinute: parseInt(process.env.USER_RATE_LIMIT_PER_MINUTE || '200'),
    perHour: parseInt(process.env.USER_RATE_LIMIT_PER_HOUR || '5000'),
    perDay: parseInt(process.env.USER_RATE_LIMIT_PER_DAY || '100000'),
  },
};

// Security Headers Configuration
export const SECURITY_HEADERS = {
  // Content Security Policy
  CSP: {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Next.js requirements
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", 'wss:', 'ws:'],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [''] : undefined,
  },

  // Other security headers
  HEADERS: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  },

  // HSTS (production only)
  HSTS: process.env.NODE_ENV === 'production'
    ? 'max-age=31536000; includeSubDomains; preload'
    : null,
};

// Agent Code Validation Configuration
export const AGENT_VALIDATION = {
  // Size limits
  MIN_CODE_LENGTH: 10,
  MAX_CODE_LENGTH: parseInt(process.env.MAX_AGENT_SIZE_BYTES || '1073741824'),

  // Required function signature
  REQUIRED_SIGNATURE: 'def agent(board, player, var):',

  // Forbidden imports and functions
  FORBIDDEN_PATTERNS: [
    'import os', 'from os',
    'import subprocess', 'from subprocess',
    'import socket', 'from socket',
    'import urllib', 'from urllib',
    'import requests', 'from requests',
    'import sys', 'from sys',
    '__import__',
    'eval(',
    'exec(',
    'compile(',
    'open(',
    'file(',
    'input(',
    'raw_input(',
    'globals(',
    'locals(',
    'vars(',
    'dir(',
  ],

  // Execution limits
  TIMEOUT_SECONDS: parseInt(process.env.AGENT_TIMEOUT_SECONDS || '14'),
  MEMORY_LIMIT_MB: parseInt(process.env.AGENT_MEMORY_LIMIT_MB || '512'),
};

// Authentication Configuration
export const AUTH_CONFIG = {
  // Session configuration
  SESSION: {
    COOKIE_NAME: 'fragmentarena_session',
    MAX_AGE: 30 * 24 * 60 * 60, // 30 days in seconds
    HTTP_ONLY: true,
    SECURE: process.env.NODE_ENV === 'production',
    SAME_SITE: 'strict' as const,
    PATH: '/',
  },

  // Access code configuration
  ACCESS_CODE: {
    LENGTH: 32, // 256 bits
    HASH_ALGORITHM: 'sha256',
  },

  // User limits
  MAX_AGENTS_PER_USER: parseInt(process.env.MAX_AGENTS_PER_USER || '10'),

  // Signup configuration
  SIGNUP_REQUIRED: !!process.env.SIGNUP_CODE,
  SIGNUP_CODE: process.env.SIGNUP_CODE,
};

export const LOGGING_CONFIG = {
  LEVELS: {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
  },

  // What to log
  LOG_REQUESTS: process.env.LOG_REQUESTS === 'true',
  LOG_RATE_LIMITS: process.env.LOG_RATE_LIMITS !== 'false',
  LOG_AUTH_ATTEMPTS: process.env.LOG_AUTH_ATTEMPTS !== 'false',
  LOG_UPLOADS: true, // Always log uploads
  LOG_ERRORS: true, // Always log errors

  // Sensitive data filtering
  FILTER_PATTERNS: [
    /accessCode=[\w]+/g,
    /authorization:\s*[\w]+/gi,
    /cookie:\s*[\w]+/gi,
    /password=[\w]+/gi,
  ],
};

// API Response Configuration
export const API_RESPONSE = {
  // Success response format
  SUCCESS_FORMAT: {
    success: true,
    data: null,
    timestamp: null,
  },

  // Error response format
  ERROR_FORMAT: {
    success: false,
    error: '',
    code: '',
    timestamp: null,
  },

  // Standard error codes
  ERROR_CODES: {
    RATE_LIMIT: 'RATE_LIMIT_EXCEEDED',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    VALIDATION: 'VALIDATION_ERROR',
    INTERNAL: 'INTERNAL_ERROR',
    TIMEOUT: 'TIMEOUT',
    CONFLICT: 'CONFLICT',
  },
};

// Monitoring and Alerting Configuration
export const MONITORING_CONFIG = {
  // Thresholds for alerts
  ALERTS: {
    RATE_LIMIT_THRESHOLD: 1000, // Alert if more than 1000 rate limit hits per hour
    ERROR_RATE_THRESHOLD: 0.05, // Alert if error rate > 5%
    RESPONSE_TIME_THRESHOLD: 3000, // Alert if response time > 3 seconds
  },

  // Metrics to track
  METRICS: {
    REQUEST_COUNT: true,
    RESPONSE_TIME: true,
    ERROR_RATE: true,
    RATE_LIMIT_HITS: true,
    ACTIVE_USERS: true,
    AGENT_UPLOADS: true,
  },
};

// IP Blocking Configuration
export const IP_BLOCKING = {
  // Auto-block configuration
  AUTO_BLOCK: {
    ENABLED: process.env.AUTO_BLOCK_ENABLED === 'true',
    THRESHOLD: parseInt(process.env.AUTO_BLOCK_THRESHOLD || '10'), // Violations before block
    DURATION: parseInt(process.env.AUTO_BLOCK_DURATION || '3600000'), // 1 hour
  },

  // Permanent blocklist (can be loaded from environment or database)
  BLOCKLIST: process.env.IP_BLOCKLIST?.split(',') || [],

  // Allowlist (never block these IPs)
  ALLOWLIST: process.env.IP_ALLOWLIST?.split(',') || [],
};

// Export helper function to get all security headers
export function getSecurityHeaders(): Record<string, string> {
  const headers: Record<string, string> = { ...SECURITY_HEADERS.HEADERS };

  // Add CSP header
  const cspParts: string[] = [];
  for (const [directive, values] of Object.entries(SECURITY_HEADERS.CSP)) {
    if (values && values.length > 0) {
      cspParts.push(`${directive} ${values.join(' ')}`);
    }
  }
  if (cspParts.length > 0) {
    headers['Content-Security-Policy'] = cspParts.join('; ');
  }

  // Add HSTS in production
  if (SECURITY_HEADERS.HSTS) {
    headers['Strict-Transport-Security'] = SECURITY_HEADERS.HSTS;
  }

  return headers;
}

// Export helper to check if an IP is blocked
export function isIpBlocked(ip: string): boolean {
  if (IP_BLOCKING.ALLOWLIST.includes(ip)) {
    return false;
  }

  return IP_BLOCKING.BLOCKLIST.includes(ip);
}

// Export configuration validation function
export function validateConfiguration(): void {
  const required = [
    'DATABASE_URL',
    'REDIS_URL',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const numeric = [
    'UPLOAD_RATE_LIMIT_HOURS',
    'MAX_AGENT_SIZE_BYTES',
    'MAX_AGENTS_PER_USER',
    'AGENT_TIMEOUT_SECONDS',
    'AGENT_MEMORY_LIMIT_MB',
  ];

  for (const key of numeric) {
    const value = process.env[key];
    if (value && isNaN(parseInt(value))) {
      throw new Error(`Invalid numeric value for ${key}: ${value}`);
    }
  }
}