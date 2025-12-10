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

    // Fetch all relevant rankings, then keep only the highest-ELO active version per agent
    const rankings = await prisma.ranking.findMany({
      where: {
        gamesPlayed: { gt: 0 },
        ...(includeInactive ? {} : { agent: { active: true } }),
      },
      include: { agent: true },
      orderBy: { eloRating: 'desc' },
    });

    const bestActiveByAgent = new Map<string, typeof rankings[number]>();
    for (const ranking of rankings) {
      // Only consider active agent versions, and keep the highest ELO instance
      if (!ranking.agent.active) continue;
      const existing = bestActiveByAgent.get(ranking.agentId);
      if (!existing || ranking.eloRating > existing.eloRating) {
        bestActiveByAgent.set(ranking.agentId, ranking);
      }
    }

    const bestRankings = Array.from(bestActiveByAgent.values()).sort(
      (a, b) => b.eloRating - a.eloRating
    );

    const total = bestRankings.length;
    const paged = bestRankings.slice(offset, offset + limit);

    const leaderboard = paged.map((ranking, index) => ({
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

    const totalGames = bestRankings.reduce((sum, r) => sum + r.gamesPlayed, 0);
    const moveTimes = bestRankings
      .map(r => r.avgMoveTimeMs)
      .filter((v): v is number => v !== null);
    const avgMoveTimeMs = moveTimes.length
      ? moveTimes.reduce((sum, v) => sum + v, 0) / moveTimes.length
      : null;

    return NextResponse.json({
      success: true,
      leaderboard,
      total,
      limit,
      offset,
      stats: {
        highestElo: bestRankings[0]?.eloRating ?? null,
        totalGames,
        avgMoveTimeMs,
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
