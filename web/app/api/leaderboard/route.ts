import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { leaderboardQuerySchema } from '@/lib/security/validation';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsedQuery = leaderboardQuerySchema.safeParse({
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
      includeInactive: searchParams.get('includeInactive') === 'true',
    });

    if (!parsedQuery.success) {
      const message = parsedQuery.error.issues.map(issue => issue.message).join(', ');
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { limit, offset, includeInactive } = parsedQuery.data;

    const where = {
      gamesPlayed: {
        gt: 0,
      },
      ...(includeInactive ? {} : {
        agent: {
          active: true,
        },
      }),
    } as const;

    const [rankings, aggregates] = await Promise.all([
      prisma.ranking.findMany({
        where,
        include: {
          agent: true,
        },
        orderBy: {
          eloRating: 'desc',
        },
        take: limit,
        skip: offset,
      }),
      prisma.ranking.aggregate({
        where,
        _count: true,
        _max: {
          eloRating: true,
        },
        _sum: {
          gamesPlayed: true,
        },
        _avg: {
          avgMoveTimeMs: true,
        },
      }),
    ]);

    const total = typeof aggregates._count === 'number'
      ? aggregates._count
      : aggregates._count?._all ?? 0;

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
      stats: {
        highestElo: aggregates._max?.eloRating ?? null,
        totalGames: aggregates._sum?.gamesPlayed ?? 0,
        avgMoveTimeMs: aggregates._avg?.avgMoveTimeMs ?? null,
      },
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
