import { NextRequest, NextResponse } from 'next/server';

// Disable static generation for this API route
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/auth/logout
 * Logout the current user and invalidate all sessions
 */
export async function POST(request: NextRequest) {
  try {
    const { logoutUser } = await import('@/lib/auth');
    const { createApiResponse, createApiError } = await import('@/lib/security/apiHelpers');

    const success = await logoutUser(request);

    if (!success) {
      return createApiResponse({
        success: true,
        message: 'No active session to logout',
      });
    }

    return createApiResponse({
      success: true,
      message: 'Successfully logged out',
    });

  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Failed to logout' },
      { status: 500 }
    );
  }
}