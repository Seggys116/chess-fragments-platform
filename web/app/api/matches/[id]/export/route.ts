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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Authenticate user
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Fetch match with all required relations
    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        whiteAgent: {
          include: {
            ranking: true,
            user: {
              select: { id: true },
            },
          },
        },
        blackAgent: {
          include: {
            ranking: true,
            user: {
              select: { id: true },
            },
          },
        },
        gameStates: {
          orderBy: { moveNumber: 'asc' },
        },
      },
    });

    if (!match) {
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      );
    }

    // Verify ownership - user must own at least one participating agent
    const ownsWhite = match.whiteAgent.user?.id === user.id;
    const ownsBlack = match.blackAgent.user?.id === user.id;

    if (!ownsWhite && !ownsBlack) {
      return NextResponse.json(
        { error: 'You must own a participating agent to export this match' },
        { status: 403 }
      );
    }

    // Fetch ELO history for this match
    const eloHistory = await prisma.$queryRaw<Array<{
      agent_id: string;
      elo_before: number;
      elo_after: number;
      elo_change: number;
    }>>`
      SELECT agent_id, elo_before, elo_after, elo_change
      FROM elo_history
      WHERE match_id = ${id}
    `;

    const whiteEloHistory = eloHistory.find(h => h.agent_id === match.whiteAgent.id);
    const blackEloHistory = eloHistory.find(h => h.agent_id === match.blackAgent.id);

    // Calculate move statistics
    // moveNumber starts at 1, odd = white's move, even = black's move
    const whiteMoves = match.gameStates.filter(state => state.moveNumber % 2 === 1);
    const blackMoves = match.gameStates.filter(state => state.moveNumber % 2 === 0);

    const whiteTimeouts = whiteMoves.filter(m => m.moveTimeMs === null).length;
    const blackTimeouts = blackMoves.filter(m => m.moveTimeMs === null).length;

    const whiteTotalTime = whiteMoves.reduce((sum, m) => sum + (m.moveTimeMs || 0), 0);
    const blackTotalTime = blackMoves.reduce((sum, m) => sum + (m.moveTimeMs || 0), 0);

    const whiteValidMoves = whiteMoves.filter(m => m.moveTimeMs !== null);
    const blackValidMoves = blackMoves.filter(m => m.moveTimeMs !== null);

    const whiteAvgTime = whiteValidMoves.length > 0
      ? Math.round(whiteTotalTime / whiteValidMoves.length)
      : null;
    const blackAvgTime = blackValidMoves.length > 0
      ? Math.round(blackTotalTime / blackValidMoves.length)
      : null;

    // Calculate total game time from timestamps
    let totalGameTimeMs = 0;
    if (match.startedAt && match.completedAt) {
      totalGameTimeMs = new Date(match.completedAt).getTime() - new Date(match.startedAt).getTime();
    } else {
      totalGameTimeMs = whiteTotalTime + blackTotalTime;
    }

    // Build export data
    const exportData: MatchExport = {
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
          eloBefore: whiteEloHistory?.elo_before ?? null,
          eloAfter: whiteEloHistory?.elo_after ?? null,
          eloChange: whiteEloHistory?.elo_change ?? null,
        },
        black: {
          id: match.blackAgent.id,
          name: match.blackAgent.name,
          version: match.blackAgent.version,
          eloBefore: blackEloHistory?.elo_before ?? null,
          eloAfter: blackEloHistory?.elo_after ?? null,
          eloChange: blackEloHistory?.elo_change ?? null,
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
        player: state.moveNumber % 2 === 1 ? 'white' : 'black',
        notation: state.moveNotation,
        boardState: state.boardState as object,
        evaluation: state.evaluation,
        moveTimeMs: state.moveTimeMs,
        isTimeout: state.moveTimeMs === null,
        timestamp: state.createdAt.toISOString(),
      })),
    };

    // Return as downloadable JSON file
    const jsonContent = JSON.stringify(exportData, null, 2);
    const filename = `match_${match.id}_${Date.now()}.json`;

    return new NextResponse(jsonContent, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error exporting match:', error);
    return NextResponse.json(
      { error: 'Failed to export match' },
      { status: 500 }
    );
  }
}
