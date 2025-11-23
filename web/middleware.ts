import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// CORS configuration for chesscomp.zaknobleclarke.com
const ALLOWED_ORIGINS = [
  'https://chesscomp.zaknobleclarke.com',
  'https://www.chesscomp.zaknobleclarke.com',
];

// Add localhost for development
if (process.env.NODE_ENV === 'development') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:3892');
}

// API routes that should have CORS headers
const API_ROUTE_PREFIX = '/api/';

// Security headers to add to all responses
function addSecurityHeaders(response: NextResponse): NextResponse {
  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Enable XSS protection (legacy browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Force HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires these
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' wss: ws:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  response.headers.set('Content-Security-Policy', cspDirectives.join('; '));

  // Referrer Policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy (replace Feature-Policy)
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );

  return response;
}

// Add CORS headers to response
function addCorsHeaders(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get('origin');

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  } else if (process.env.NODE_ENV === 'production') {
    // In production, default to the main domain if no origin match
    response.headers.set('Access-Control-Allow-Origin', 'https://chesscomp.zaknobleclarke.com');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  response.headers.set(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS, PATCH'
  );

  response.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Access-Code'
  );

  response.headers.set('Access-Control-Max-Age', '86400'); // 24 hours

  return response;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Only process API routes
  if (!pathname.startsWith(API_ROUTE_PREFIX)) {
    return NextResponse.next();
  }

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });
    addCorsHeaders(request, response);
    return addSecurityHeaders(response);
  }

  // Process the request
  const response = NextResponse.next();

  // Add CORS and security headers
  addCorsHeaders(request, response);
  return addSecurityHeaders(response);
}

// Configuration for which paths the middleware runs on
export const config = {
  matcher: [
    // Match all API routes
    '/api/:path*',
    // Exclude static files and images
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};