import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/redis';
import crypto from 'crypto';


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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { code } = body;

    if (!code) {
      return NextResponse.json(
        { error: 'Missing required field: code' },
        { status: 400 }
      );
    }

    // Get the original agent
    const originalAgent = await prisma.agent.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!originalAgent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    if (originalAgent.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - you do not own this agent' },
        { status: 403 }
      );
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') ||
               request.headers.get('cf-connecting-ip') ||
               'unknown';

    const rateLimitHours = parseInt(process.env.UPLOAD_RATE_LIMIT_HOURS || '1', 10);
    const rateLimit = await checkRateLimit(user.id, ip, 1, rateLimitHours);

    if (!rateLimit.allowed) {
      const hours = rateLimitHours === 1 ? 'hour' : `${rateLimitHours} hours`;
      return NextResponse.json(
        {
          error: `Rate limit exceeded. You can only upload 1 agent per ${hours}.`,
          retryAfter: rateLimit.retryAfter,
        },
        { status: 429 }
      );
    }

    const validation = validateAgentCode(code);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // Get next version number (simple integer increment)
    const latestAgent = await prisma.agent.findFirst({
      where: { userId: user.id, name: originalAgent.name },
      orderBy: { version: 'desc' },
    });

    const newVersion = (latestAgent?.version || 0) + 1;

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

    await prisma.agent.updateMany({
      where: {
        userId: user.id,
        name: originalAgent.name,
        active: true,
      },
      data: { active: false },
    });

    // Create validation queue entry instead of creating agent directly
    const queueEntry = await prisma.validationQueue.create({
      data: {
        userId: user.id,
        name: originalAgent.name,
        version: newVersion,
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

    console.log('Agent update queued for validation', {
      userId: user.id,
      agentName: originalAgent.name,
      oldVersion: originalAgent.version,
      newVersion: newVersion,
      queueId: queueEntry.id,
      position,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      queueId: queueEntry.id,
      status: 'pending',
      position,
      newVersion: newVersion,
      message: 'Agent update submitted for validation',
    });
  } catch (error) {
    console.error('Error updating agent:', error);
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 }
    );
  }
}