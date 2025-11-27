import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

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
    const { agentIds } = body;

    if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
      return NextResponse.json(
        { error: 'agentIds array is required' },
        { status: 400 }
      );
    }

    // Verify all agents belong to this user before deactivating
    const agentsToDeactivate = await prisma.agent.findMany({
      where: {
        id: {
          in: agentIds,
        },
        userId: user.id,
      },
      select: {
        id: true,
      },
    });

    const validIds = agentsToDeactivate.map(a => a.id);

    if (validIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No valid agents to deactivate',
        deactivatedCount: 0,
      });
    }

    // Deactivate the specified agents
    const result = await prisma.agent.updateMany({
      where: {
        id: {
          in: validIds,
        },
      },
      data: {
        active: false,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Deactivated ${result.count} agent(s)`,
      deactivatedCount: result.count,
    });
  } catch (error) {
    console.error('Error bulk deactivating agents:', error);
    return NextResponse.json(
      { error: 'Failed to deactivate agents' },
      { status: 500 }
    );
  }
}
