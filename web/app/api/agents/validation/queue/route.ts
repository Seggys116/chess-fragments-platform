import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // SECURITY: Only return user's own validation queue entries
    // NEVER return the 'code' field
    const queueEntries = await prisma.validationQueue.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        name: true,
        version: true,
        status: true,
        error: true,
        testDurationMs: true,
        agentId: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20, // Limit to recent 20 entries
    });

    const enrichedEntries = await Promise.all(
      queueEntries.map(async (entry) => {
        let position = 0;
        if (entry.status === 'pending') {
          position = await prisma.validationQueue.count({
            where: {
              status: 'pending',
              createdAt: {
                lt: entry.createdAt,
              },
            },
          }) + 1; // +1 for 1-indexed position
        }

        return {
          ...entry,
          position,
        };
      })
    );

    return NextResponse.json({
      queue: enrichedEntries,
      total: queueEntries.length,
    });

  } catch (err) {
    console.error('Validation queue error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch validation queue' },
      { status: 500 }
    );
  }
}
