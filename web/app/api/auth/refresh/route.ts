import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Disable static generation for this API route
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/auth/refresh
 * Refresh the access token using a refresh token
 */
export async function POST(request: NextRequest) {
  try {
    const { refreshAccessToken } = await import('@/lib/auth/session');
    const { createApiResponse, createApiError } = await import('@/lib/security/apiHelpers');

    // Get refresh token from cookie or body
    const cookieStore = cookies();
    let refreshToken = cookieStore.get('fragmentarena_refresh')?.value;

    // If not in cookie, check request body
    if (!refreshToken) {
      try {
        const body = await request.json();
        refreshToken = body.refreshToken;
      } catch {
        // No body or invalid JSON
      }
    }

    if (!refreshToken) {
      return createApiError('Refresh token required', 401);
    }

    // Attempt to refresh the access token
    const result = await refreshAccessToken(refreshToken);

    if (!result) {
      // Clear invalid refresh token cookie
      cookieStore.delete('fragmentarena_refresh');
      return createApiError('Invalid or expired refresh token', 401);
    }

    // Set new access token cookie
    cookieStore.set('fragmentarena_session', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: result.expiresIn,
    });

    return createApiResponse({
      success: true,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    // Fallback error response if imports fail
    return NextResponse.json(
      { error: 'Failed to refresh token' },
      { status: 500 }
    );
  }
}