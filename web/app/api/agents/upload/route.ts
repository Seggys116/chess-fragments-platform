import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { checkRateLimit } from '@/lib/redis';
import { getUserFromRequest } from '@/lib/auth';
import { validateAgentName } from '@/lib/security/profanity';
import { validateUploadCode } from '@/lib/upload-code';

// Disable static generation for this API route
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalizeCode(code: string): string {
  return code
    .split('\n')
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(line => line.length > 0)
    .join('\n');
}

function computeCodeHash(code: string): string {
  const normalized = normalizeCode(code);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function validateAgentCode(code: string): { valid: boolean; error?: string } {
  const MAX_SIZE = parseInt(process.env.MAX_AGENT_SIZE_BYTES || '1073741824'); // 1GiB default
  if (code.length > MAX_SIZE) {
    const sizeInMB = (MAX_SIZE / (1024 * 1024)).toFixed(1);
    return { valid: false, error: `Code exceeds maximum size of ${sizeInMB}MB` };
  }

  if (code.length < 10) {
    return { valid: false, error: 'Code is too short' };
  }

  // Check for agent function
  if (!code.includes('def agent(board, player, var)')) {
    return { valid: false, error: 'Missing required "def agent(board, player, var):" function' };
  }

  const forbiddenImports = ['os', 'subprocess', 'socket', 'urllib', 'requests', 'sys', 'eval', 'exec'];
  for (const forbidden of forbiddenImports) {
    if (code.includes(`import ${forbidden}`) || code.includes(`from ${forbidden}`)) {
      return { valid: false, error: `Forbidden import: ${forbidden}` };
    }
  }

  return { valid: true };
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, code, uploadCode } = body;

    if (!name || !code) {
      return NextResponse.json(
        { error: 'Missing required fields: name, code' },
        { status: 400 }
      );
    }

    if (!uploadCode) {
      return NextResponse.json(
        { error: 'Upload code is required. Contact admin for current code.' },
        { status: 400 }
      );
    }

    // Sanitize upload code - remove all non-alphanumeric characters (dashes, spaces, etc.)
    const sanitizedUploadCode = uploadCode.replace(/[^A-Z0-9]/gi, '').toUpperCase();

    if (!sanitizedUploadCode) {
      return NextResponse.json(
        { error: 'Invalid upload code format. Contact admin for current code.' },
        { status: 400 }
      );
    }

    if (!validateUploadCode(sanitizedUploadCode)) {
      return NextResponse.json(
        { error: 'Invalid or expired upload code. Contact admin for current code.' },
        { status: 403 }
      );
    }

    const nameValidation = validateAgentName(name);
    if (!nameValidation.valid) {
      return NextResponse.json(
        { error: nameValidation.error },
        { status: 400 }
      );
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') ||
               request.headers.get('cf-connecting-ip') ||
               'unknown';

    // Check rate limit
    const rateLimitHours = parseInt(process.env.UPLOAD_RATE_LIMIT_HOURS || '1', 10);
    const rateLimit = await checkRateLimit(user.id, ip, 1, rateLimitHours);

    if (!rateLimit.allowed) {
      console.warn('Rate limit exceeded', {
        ip,
        userId: user.id,
        timestamp: new Date().toISOString()
      });

      const hours = rateLimitHours === 1 ? 'hour' : `${rateLimitHours} hours`;
      return NextResponse.json(
        { error: `Rate limit exceeded. You can only upload 1 agent per ${hours}.` },
        { status: 429 }
      );
    }

    const validation = validateAgentCode(code);
    if (!validation.valid) {
      await prisma.uploadLog.create({
        data: {
          userId: user.id,
          ipAddress: ip,
          success: false,
          errorMessage: validation.error,
        },
      });

      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const codeHash = computeCodeHash(code);

    // Check for duplicates
    const existingAgent = await prisma.agent.findFirst({
      where: { codeHash },
    });

    if (existingAgent) {
      return NextResponse.json(
        { error: 'This code has already been uploaded (duplicate detected)' },
        { status: 409 }
      );
    }

    // Check max agents per user
    const maxAgents = parseInt(process.env.MAX_AGENTS_PER_USER || '10');
    const userAgentCount = await prisma.agent.count({
      where: { userId: user.id, active: true },
    });

    if (userAgentCount >= maxAgents) {
      return NextResponse.json(
        { error: `You have reached the maximum of ${maxAgents} active agents` },
        { status: 403 }
      );
    }

    // Get next version number
    const latestAgent = await prisma.agent.findFirst({
      where: { userId: user.id, name },
      orderBy: { version: 'desc' },
    });

    const version = (latestAgent?.version || 0) + 1;

    await prisma.agent.updateMany({
      where: {
        userId: user.id,
        name,
        active: true,
      },
      data: { active: false },
    });

    // Create validation queue entry instead of creating agent directly
    const queueEntry = await prisma.validationQueue.create({
      data: {
        userId: user.id,
        name,
        version,
        code, // Stored securely, never exposed via API
        codeHash,
        status: 'pending',
      },
    });

    const position = await prisma.validationQueue.count({
      where: {
        status: 'pending',
        createdAt: {
          lt: queueEntry.createdAt,
        },
      },
    }) + 1;

    await prisma.uploadLog.create({
      data: {
        userId: user.id,
        ipAddress: ip,
        success: true,
        codeHash,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        uploadCount: { increment: 1 },
        lastUploadAt: new Date(),
      },
    });

    console.log('Agent queued for validation', {
      userId: user.id,
      agentName: name,
      version,
      queueId: queueEntry.id,
      position,
      timestamp: new Date().toISOString()
    });

    // Trigger validation task
    // The Celery worker will automatically pick up pending validation tasks
    // Or we can manually trigger via a separate validation scheduler
    // For now, the worker will poll the validation_queue table

    return NextResponse.json({
      success: true,
      queueId: queueEntry.id,
      status: 'pending',
      position,
      message: 'Agent submitted for validation',
    });
  } catch (error) {
    console.error('Agent upload error:', error);
    return NextResponse.json(
      { error: 'Failed to upload agent' },
      { status: 500 }
    );
  }
}