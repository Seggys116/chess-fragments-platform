import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ queueId: string }> }
) {
  try {
    const { queueId } = await params;

    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get validation queue entry
    // SECURITY: Only select fields that are safe to expose, NEVER return 'code' field
    const queueEntry = await prisma.validationQueue.findUnique({
      where: { id: queueId },
      select: {
        id: true,
        userId: true,
        name: true,
        status: true,
        error: true,
        testDurationMs: true,
        agentId: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    });

    if (!queueEntry) {
      return NextResponse.json(
        { error: 'Validation entry not found' },
        { status: 404 }
      );
    }

    // SECURITY: Verify user owns this validation entry
    if (queueEntry.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    let position = 0;
    if (queueEntry.status === 'pending') {
      // Count how many entries are ahead in queue (created before this one)
      position = await prisma.validationQueue.count({
        where: {
          status: 'pending',
          createdAt: {
            lt: queueEntry.createdAt,
          },
        },
      }) + 1; // +1 for 1-indexed position
    }

    return NextResponse.json({
      id: queueEntry.id,
      name: queueEntry.name,
      status: queueEntry.status,
      position: position,
      error: queueEntry.error, // Sanitized error message
      testDurationMs: queueEntry.testDurationMs,
      agentId: queueEntry.agentId,
      createdAt: queueEntry.createdAt,
      startedAt: queueEntry.startedAt,
      completedAt: queueEntry.completedAt,
    });

  } catch (err) {
    console.error('Validation status error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch validation status' },
      { status: 500 }
    );
  }
}
