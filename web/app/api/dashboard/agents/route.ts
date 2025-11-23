import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const agents = await prisma.agent.findMany({
      where: {
        userId: user.id,
      },
      include: {
        ranking: true,
        whiteMatches: {
          where: {
            status: 'completed',
          },
          select: {
            id: true,
            completedAt: true,
          },
          orderBy: {
            completedAt: 'desc',
          },
          take: 1,
        },
        blackMatches: {
          where: {
            status: 'completed',
          },
          select: {
            id: true,
            completedAt: true,
          },
          orderBy: {
            completedAt: 'desc',
          },
          take: 1,
        },
        localConnections: {
          where: {
            status: 'connected',
          },
          orderBy: {
            connectedAt: 'desc',
          },
          take: 1,
          select: {
            status: true,
            lastHeartbeat: true,
            connectedAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Get global rank for each agent
    const agentsWithRank = await Promise.all(
      agents.map(async (agent) => {
        let globalRank = null;
        if (agent.ranking) {
          const higherRanked = await prisma.ranking.count({
            where: {
              eloRating: {
                gt: agent.ranking.eloRating,
              },
              agent: {
                active: true,
              },
            },
          });
          globalRank = higherRanked + 1;
        }

        const whiteMatchDate = agent.whiteMatches[0]?.completedAt || null;
        const blackMatchDate = agent.blackMatches[0]?.completedAt || null;
        const lastMatch = whiteMatchDate && blackMatchDate
          ? (whiteMatchDate > blackMatchDate ? whiteMatchDate : blackMatchDate)
          : whiteMatchDate || blackMatchDate;

        const localConnection = agent.localConnections[0];
        const now = new Date();
        const isConnected = localConnection && localConnection.lastHeartbeat
          ? (now.getTime() - new Date(localConnection.lastHeartbeat).getTime()) < 30000
          : false;

        return {
          id: agent.id,
          name: agent.name,
          version: agent.version,
          active: agent.active,
          executionMode: (agent as any).executionMode || 'server',
          createdAt: agent.createdAt,
          codeHash: agent.codeHash,
          ranking: agent.ranking ? {
            eloRating: agent.ranking.eloRating,
            gamesPlayed: agent.ranking.gamesPlayed,
            wins: agent.ranking.wins,
            losses: agent.ranking.losses,
            draws: agent.ranking.draws,
            avgMoveTimeMs: agent.ranking.avgMoveTimeMs,
            globalRank,
          } : null,
          lastMatchAt: lastMatch || null,
          connectionStatus: isConnected ? 'connected' : 'disconnected',
          lastHeartbeat: localConnection?.lastHeartbeat || null,
        };
      })
    );

    return NextResponse.json({
      success: true,
      agents: agentsWithRank,
    });
  } catch (error) {
    console.error('Error fetching user agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}
