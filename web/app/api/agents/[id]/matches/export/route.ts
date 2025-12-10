import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

interface MatchExport {
  exportMetadata: {
    exportedAt: string;
    exportVersion: string;
    platform: string;
  };
  match: {
    id: string;
    matchType: string;
    status: string;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  };
  result: {
    winner: string | null;
    termination: string | null;
    totalMoves: number;
  };
  agents: {
    white: {
      id: string;
      name: string;
      version: number;
      eloBefore: number | null;
      eloAfter: number | null;
      eloChange: number | null;
    };
    black: {
      id: string;
      name: string;
      version: number;
      eloBefore: number | null;
      eloAfter: number | null;
      eloChange: number | null;
    };
  };
  statistics: {
    totalGameTimeMs: number;
    white: {
      totalMoves: number;
      avgMoveTimeMs: number | null;
      timeoutCount: number;
      totalMoveTimeMs: number;
    };
    black: {
      totalMoves: number;
      avgMoveTimeMs: number | null;
      timeoutCount: number;
      totalMoveTimeMs: number;
    };
  };
  moveHistory: Array<{
    moveNumber: number;
    player: 'white' | 'black';
    notation: string | null;
    boardState: object;
    evaluation: number | null;
    moveTimeMs: number | null;
    isTimeout: boolean;
    timestamp: string;
  }>;
}

interface BulkMatchExport {
  exportMetadata: {
    exportedAt: string;
    exportVersion: string;
    platform: string;
    agentId: string;
    agentName: string;
    agentVersion: number;
    totalMatches: number;
  };
  matches: MatchExport[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '500'), 1000);

    // Authenticate user
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Fetch agent and verify ownership
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

    if (agent.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - You can only export matches for your own agents' },
        { status: 403 }
      );
    }

    // Fetch all completed matches for this agent with full game states
    const matches = await prisma.match.findMany({
      where: {
        status: 'completed',
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
          },
        },
        blackAgent: {
          select: {
            id: true,
            name: true,
            version: true,
          },
        },
        gameStates: {
          orderBy: { moveNumber: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Fetch ELO history for all matches
    const matchIds = matches.map(m => m.id);
    const eloHistoryResult = await prisma.$queryRaw<Array<{
      match_id: string;
      agent_id: string;
      elo_before: number;
      elo_after: number;
      elo_change: number;
    }>>`
      SELECT match_id, agent_id, elo_before, elo_after, elo_change
      FROM elo_history
      WHERE match_id = ANY(${matchIds}::text[])
    `;

    // Create a map for quick lookup: matchId -> agentId -> eloData
    const eloHistoryMap = new Map<string, Map<string, { eloBefore: number; eloAfter: number; eloChange: number }>>();
    for (const h of eloHistoryResult) {
      if (!eloHistoryMap.has(h.match_id)) {
        eloHistoryMap.set(h.match_id, new Map());
      }
      eloHistoryMap.get(h.match_id)!.set(h.agent_id, {
        eloBefore: h.elo_before,
        eloAfter: h.elo_after,
        eloChange: h.elo_change,
      });
    }

    // Build export data for each match
    const matchExports: MatchExport[] = matches.map(match => {
      const matchEloHistory = eloHistoryMap.get(match.id);
      const whiteEloHistory = matchEloHistory?.get(match.whiteAgent.id);
      const blackEloHistory = matchEloHistory?.get(match.blackAgent.id);

      // Calculate move statistics
      const whiteMoves = match.gameStates.filter(state => state.moveNumber % 2 === 1);
      const blackMoves = match.gameStates.filter(state => state.moveNumber % 2 === 0);

      const whiteTimeouts = whiteMoves.filter(m => m.moveTimeMs === null).length;
      const blackTimeouts = blackMoves.filter(m => m.moveTimeMs === null).length;

      // Exclude 0ms moves from time calculations (artifacts)
      const whiteValidMoves = whiteMoves.filter(m => m.moveTimeMs !== null && m.moveTimeMs > 0);
      const blackValidMoves = blackMoves.filter(m => m.moveTimeMs !== null && m.moveTimeMs > 0);

      const whiteTotalTime = whiteValidMoves.reduce((sum, m) => sum + (m.moveTimeMs || 0), 0);
      const blackTotalTime = blackValidMoves.reduce((sum, m) => sum + (m.moveTimeMs || 0), 0);

      const whiteAvgTime = whiteValidMoves.length > 0
        ? Math.round(whiteTotalTime / whiteValidMoves.length)
        : null;
      const blackAvgTime = blackValidMoves.length > 0
        ? Math.round(blackTotalTime / blackValidMoves.length)
        : null;

      let totalGameTimeMs = 0;
      if (match.startedAt && match.completedAt) {
        totalGameTimeMs = new Date(match.completedAt).getTime() - new Date(match.startedAt).getTime();
      } else {
        totalGameTimeMs = whiteTotalTime + blackTotalTime;
      }

      return {
        exportMetadata: {
          exportedAt: new Date().toISOString(),
          exportVersion: '1.0',
          platform: 'Chess Fragments Platform',
        },
        match: {
          id: match.id,
          matchType: match.matchType,
          status: match.status,
          createdAt: match.createdAt.toISOString(),
          startedAt: match.startedAt?.toISOString() || null,
          completedAt: match.completedAt?.toISOString() || null,
        },
        result: {
          winner: match.winner,
          termination: match.termination,
          totalMoves: match.moves,
        },
        agents: {
          white: {
            id: match.whiteAgent.id,
            name: match.whiteAgent.name,
            version: match.whiteAgent.version,
            eloBefore: whiteEloHistory?.eloBefore ?? null,
            eloAfter: whiteEloHistory?.eloAfter ?? null,
            eloChange: whiteEloHistory?.eloChange ?? null,
          },
          black: {
            id: match.blackAgent.id,
            name: match.blackAgent.name,
            version: match.blackAgent.version,
            eloBefore: blackEloHistory?.eloBefore ?? null,
            eloAfter: blackEloHistory?.eloAfter ?? null,
            eloChange: blackEloHistory?.eloChange ?? null,
          },
        },
        statistics: {
          totalGameTimeMs,
          white: {
            totalMoves: whiteMoves.length,
            avgMoveTimeMs: whiteAvgTime,
            timeoutCount: whiteTimeouts,
            totalMoveTimeMs: whiteTotalTime,
          },
          black: {
            totalMoves: blackMoves.length,
            avgMoveTimeMs: blackAvgTime,
            timeoutCount: blackTimeouts,
            totalMoveTimeMs: blackTotalTime,
          },
        },
        moveHistory: match.gameStates.map(state => ({
          moveNumber: state.moveNumber,
          player: state.moveNumber % 2 === 1 ? 'white' as const : 'black' as const,
          notation: state.moveNotation,
          boardState: state.boardState as object,
          evaluation: state.evaluation,
          moveTimeMs: state.moveTimeMs,
          isTimeout: state.moveTimeMs === null,
          timestamp: state.createdAt.toISOString(),
        })),
      };
    });

    // Build bulk export wrapper
    const bulkExport: BulkMatchExport = {
      exportMetadata: {
        exportedAt: new Date().toISOString(),
        exportVersion: '1.0',
        platform: 'Chess Fragments Platform',
        agentId: agent.id,
        agentName: agent.name,
        agentVersion: agent.version,
        totalMatches: matchExports.length,
      },
      matches: matchExports,
    };

    // Return as downloadable JSON file
    const jsonContent = JSON.stringify(bulkExport, null, 2);
    const safeName = agent.name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${safeName}_v${agent.version}_matches_${Date.now()}.json`;

    console.log('Bulk export completed', {
      userId: user.id,
      agentId: id,
      agentName: agent.name,
      matchCount: matchExports.length,
      timestamp: new Date().toISOString(),
    });

    return new NextResponse(jsonContent, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error exporting matches:', error);
    return NextResponse.json(
      { error: 'Failed to export matches' },
      { status: 500 }
    );
  }
}
