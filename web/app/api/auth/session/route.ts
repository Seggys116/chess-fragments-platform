import { NextRequest, NextResponse } from 'next/server';

// Disable static generation for this API route
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/auth/session
 * Check if the current session is valid
 * Automatically clears invalid cookies
 */
export async function GET(request: NextRequest) {
  try {
    const { getUserFromRequest, validateSession } = await import('@/lib/auth');
    const { createApiResponse, createApiError } = await import('@/lib/security/apiHelpers');

    const isValid = await validateSession(request);

    if (!isValid) {
      return createApiResponse({
        valid: false,
        message: 'No valid session found',
        user: null,
      });
    }

    const user = await getUserFromRequest(request);

    if (!user) {
      return createApiResponse({
        valid: false,
        message: 'Session invalid or expired',
        user: null,
      });
    }

    return createApiResponse({
      valid: true,
      user: {
        id: user.id,
        createdAt: user.createdAt,
        lastActive: user.lastActive,
        agentCount: user.agents.length,
        uploadCount: user.uploadCount,
      },
    });

  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json(
      { error: 'Failed to check session' },
      { status: 500 }
    );
  }
}