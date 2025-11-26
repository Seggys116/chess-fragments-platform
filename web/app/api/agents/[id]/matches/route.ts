import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const agent = await prisma.agent.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        version: true,
        userId: true,
      },
    });

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // CHECK AUTHORIZATION - Only owner can view match history
    if (agent.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - You can only view match history for your own agents' },
        { status: 403 }
      );
    }

    // Get match history
    const matches = await prisma.match.findMany({
      where: {
        OR: [
          { whiteAgentId: id },
          { blackAgentId: id },
        ],
      },
      include: {
        whiteAgent: {
          select: {
            id: true,
            name: true,
            version: true,
            ranking: {
              select: { eloRating: true },
            },
          },
        },
        blackAgent: {
          select: {
            id: true,
            name: true,
            version: true,
            ranking: {
              select: { eloRating: true },
            },
          },
        },
        gameStates: {
          select: {
            moveNumber: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    });

    // Get total count
    const totalCount = await prisma.match.count({
      where: {
        OR: [
          { whiteAgentId: id },
          { blackAgentId: id },
        ],
      },
    });

    // Fetch ELO history for all these matches
    const matchIds = matches.map(m => m.id);
    const eloHistoryResult = await prisma.$queryRaw<Array<{
      match_id: string;
      elo_change: number;
      elo_before: number;
    }>>`
      SELECT match_id, elo_change, elo_before
      FROM elo_history
      WHERE match_id = ANY(${matchIds}::text[])
        AND agent_id = ${id}
    `;

    // Create a map for quick lookup
    const eloHistoryMap = new Map<string, { eloChange: number; eloBefore: number }>(
      eloHistoryResult.map(h => [h.match_id, { eloChange: h.elo_change, eloBefore: h.elo_before }])
    );

    // Format matches
    const formattedMatches = matches.map(match => {
      const isWhite = match.whiteAgentId === id;
      const opponent = isWhite ? match.blackAgent : match.whiteAgent;

      let result = 'in_progress';
      if (match.status === 'completed') {
        if (match.winner === null) {
          // Use the termination field to show specific draw types
          result = match.termination || 'draw';
        } else if (
          (isWhite && match.winner === 'white') ||
          (!isWhite && match.winner === 'black')
        ) {
          result = 'win';
        } else {
          result = 'loss';
        }
      }

      const eloHistory = eloHistoryMap.get(match.id);

      return {
        id: match.id,
        matchType: match.matchType,
        status: match.status,
        result,
        color: isWhite ? 'white' : 'black',
        opponent: {
          id: opponent.id,
          name: opponent.name,
          version: opponent.version,
          eloRating: opponent.ranking?.eloRating || null,
        },
        moves: match.gameStates.length,
        termination: match.termination,
        winner: match.winner,
        createdAt: match.createdAt,
        completedAt: match.completedAt,
        eloChange: eloHistory?.eloChange ?? null,
        eloBefore: eloHistory?.eloBefore ?? null,
      };
    });

    console.log('Match history accessed', {
      userId: user.id,
      agentId: id,
      agentName: agent.name,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        version: agent.version,
      },
      matches: formattedMatches,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });

  } catch (err) {
    console.error('Match history error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch matches' },
      { status: 500 }
    );
  }
}