import { NextRequest, NextResponse } from 'next/server';
import { getUserFromAccessCode, createUserSession } from '@/lib/auth';
import { ipRateLimit } from '@/lib/security/rateLimiter';

// Disable static generation for this API route
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accessCode } = body;

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                    request.headers.get('x-real-ip') ||
                    request.headers.get('cf-connecting-ip') ||
                    'unknown';

    // Rate limit: 10 login attempts per minute per IP
    const rateLimitResult = await ipRateLimit(clientIp, 'login', 10, 60000);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429 }
      );
    }

    if (!accessCode) {
      return NextResponse.json(
        { error: 'Access code required' },
        { status: 400 }
      );
    }

    const user = await getUserFromAccessCode(accessCode);

    if (!user) {
      console.warn('Failed login attempt', {
        ip: clientIp,
        timestamp: new Date().toISOString(),
        reason: 'Invalid access code'
      });

      return NextResponse.json(
        { error: 'Invalid access code' },
        { status: 401 }
      );
    }

    const tokens = await createUserSession(user.id, request, true);

    console.log('Successful login', {
      ip: clientIp,
      userId: user.id,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      userId: user.id,
      agentCount: user.agents.length,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: 3600, // 1 hour
    });
  } catch (error) {
    console.error('Error verifying access code:', error);
    return NextResponse.json(
      { error: 'Failed to verify access code' },
      { status: 500 }
    );
  }
}
