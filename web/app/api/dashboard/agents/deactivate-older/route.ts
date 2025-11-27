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

    // Get all agents for this user, grouped by name
    const agents = await prisma.agent.findMany({
      where: {
        userId: user.id,
        active: true,
      },
      orderBy: {
        version: 'desc',
      },
    });

    // Group by name and find older versions to deactivate
    const agentsByName: Record<string, typeof agents> = {};
    for (const agent of agents) {
      if (!agentsByName[agent.name]) {
        agentsByName[agent.name] = [];
      }
      agentsByName[agent.name].push(agent);
    }

    // Collect IDs of older versions to deactivate (keep only the highest version per name)
    const idsToDeactivate: string[] = [];
    for (const [name, versions] of Object.entries(agentsByName)) {
      // Sort by version descending (already sorted but ensure)
      const sorted = versions.sort((a, b) => b.version - a.version);
      // Skip the first one (latest), deactivate the rest
      for (let i = 1; i < sorted.length; i++) {
        idsToDeactivate.push(sorted[i].id);
      }
    }

    if (idsToDeactivate.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No older versions to deactivate',
        deactivatedCount: 0,
      });
    }

    // Deactivate all older versions
    const result = await prisma.agent.updateMany({
      where: {
        id: {
          in: idsToDeactivate,
        },
        userId: user.id, // Safety check
      },
      data: {
        active: false,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Deactivated ${result.count} older agent version(s)`,
      deactivatedCount: result.count,
    });
  } catch (error) {
    console.error('Error deactivating older versions:', error);
    return NextResponse.json(
      { error: 'Failed to deactivate older versions' },
      { status: 500 }
    );
  }
}
