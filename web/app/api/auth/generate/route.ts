import { NextRequest, NextResponse } from 'next/server';
import { createUser, createUserSession } from '@/lib/auth';
import { isIpBlocked, trackFailedAttempt, clearFailedAttempts } from '@/lib/security/ip-blocker';
import { ipRateLimit } from '@/lib/security/rateLimiter';

// Disable static generation for this API route
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { signupCode } = body;

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                    request.headers.get('x-real-ip') ||
                    request.headers.get('cf-connecting-ip') ||
                    'unknown';

    // Rate limit: 3 signup attempts per hour per IP
    const rateLimitResult = await ipRateLimit(clientIp, 'signup', 3, 3600000);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again later.' },
        { status: 429 }
      );
    }

    if (await isIpBlocked(clientIp)) {
      console.warn('Blocked IP attempted signup', {
        ip: clientIp,
        timestamp: new Date().toISOString()
      });
      return NextResponse.json(
        { error: 'Too many failed attempts. Please try again later.' },
        { status: 429 }
      );
    }

    const requiredSignupCode = process.env.SIGNUP_CODE;

    if (requiredSignupCode) {
      // Signup code is required
      if (!signupCode) {
        console.warn('Missing signup code', {
          ip: clientIp,
          timestamp: new Date().toISOString()
        });
        return NextResponse.json(
          { error: 'Signup code is required' },
          { status: 400 }
        );
      }

      if (signupCode !== requiredSignupCode) {
        // Track failed attempt
        const shouldBlock = await trackFailedAttempt(clientIp);

        console.warn('Invalid signup code attempt', {
          ip: clientIp,
          blocked: shouldBlock,
          timestamp: new Date().toISOString()
        });

        if (shouldBlock) {
          return NextResponse.json(
            { error: 'Too many failed attempts. Please try again later.' },
            { status: 429 }
          );
        }

        return NextResponse.json(
          { error: 'Invalid signup code' },
          { status: 403 }
        );
      }
    }

    // Clear any failed attempts on successful validation
    await clearFailedAttempts(clientIp);

    const { userId, accessCode } = await createUser();

    const tokens = await createUserSession(userId, request, true);

    console.log('New user registered', {
      ip: clientIp,
      userId,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      userId,
      accessCode,
      accessToken: tokens.accessToken,
      expiresIn: 3600, // 1 hour
    });
  } catch (error) {
    console.error('Error generating access code:', error);
    return NextResponse.json(
      { error: 'Failed to generate access code' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const requiredSignupCode = process.env.SIGNUP_CODE;
  return NextResponse.json({ required: !!requiredSignupCode });
}