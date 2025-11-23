import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const rankings = await prisma.ranking.findMany({
      where: {
        agent: {
          active: true,
        },
        gamesPlayed: {
          gt: 0,
        },
      },
      include: {
        agent: true,
      },
      orderBy: {
        eloRating: 'desc',
      },
      take: limit,
      skip: offset,
    });

    const total = await prisma.ranking.count({
      where: {
        agent: {
          active: true,
        },
        gamesPlayed: {
          gt: 0,
        },
      },
    });

    const leaderboard = rankings.map((ranking, index) => ({
      rank: offset + index + 1,
      agentId: ranking.agentId,
      agentName: ranking.agent.name,
      version: ranking.agent.version,
      eloRating: ranking.eloRating,
      gamesPlayed: ranking.gamesPlayed,
      wins: ranking.wins,
      losses: ranking.losses,
      draws: ranking.draws,
      winPercentage: ranking.gamesPlayed > 0
        ? ((ranking.wins / ranking.gamesPlayed) * 100).toFixed(1)
        : '0.0',
      lossPercentage: ranking.gamesPlayed > 0
        ? ((ranking.losses / ranking.gamesPlayed) * 100).toFixed(1)
        : '0.0',
      avgMoveTimeMs: ranking.avgMoveTimeMs,
      lastUpdated: ranking.lastUpdated,
    }));

    return NextResponse.json({
      success: true,
      leaderboard,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
