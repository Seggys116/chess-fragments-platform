import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        whiteAgent: {
          include: {
            ranking: true,
            user: {
              select: {
                id: true, // Don't expose access codes
              },
            },
          },
        },
        blackAgent: {
          include: {
            ranking: true,
            user: {
              select: {
                id: true,
              },
            },
          },
        },
        gameStates: {
          orderBy: {
            moveNumber: 'asc',
          },
        },
      },
    });

    if (!match) {
      return NextResponse.json(
        { error: 'Match not found' },
        { status: 404 }
      );
    }

    // moveNumber starts at 1, so odd = white, even = black
    const whiteMoves = match.gameStates.filter((state) => state.moveNumber % 2 === 1);
    const blackMoves = match.gameStates.filter((state) => state.moveNumber % 2 === 0);

    const whiteAvgTime = whiteMoves.length > 0
      ? Math.round(whiteMoves.reduce((sum, m) => sum + (m.moveTimeMs || 0), 0) / whiteMoves.length)
      : null;

    const blackAvgTime = blackMoves.length > 0
      ? Math.round(blackMoves.reduce((sum, m) => sum + (m.moveTimeMs || 0), 0) / blackMoves.length)
      : null;

    // Fetch ELO history for this match (if it exists)
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

    return NextResponse.json({
      success: true,
      match: {
        id: match.id,
        matchType: match.matchType,
        status: match.status,
        winner: match.winner,
        moves: match.moves,
        termination: match.termination,
        startedAt: match.startedAt,
        completedAt: match.completedAt,
        createdAt: match.createdAt,
        whiteAgent: {
          id: match.whiteAgent.id,
          name: match.whiteAgent.name,
          version: match.whiteAgent.version,
          eloRating: match.whiteAgent.ranking?.eloRating || 1500,
          avgMoveTimeMs: whiteAvgTime,
          eloChange: whiteEloHistory ? whiteEloHistory.elo_change : null,
          eloBefore: whiteEloHistory ? whiteEloHistory.elo_before : null,
        },
        blackAgent: {
          id: match.blackAgent.id,
          name: match.blackAgent.name,
          version: match.blackAgent.version,
          eloRating: match.blackAgent.ranking?.eloRating || 1500,
          avgMoveTimeMs: blackAvgTime,
          eloChange: blackEloHistory ? blackEloHistory.elo_change : null,
          eloBefore: blackEloHistory ? blackEloHistory.elo_before : null,
        },
        gameStates: match.gameStates.map(state => ({
          moveNumber: state.moveNumber,
          boardState: state.boardState,
          evaluation: state.evaluation,
          moveTimeMs: state.moveTimeMs,
          moveNotation: state.moveNotation,
          createdAt: state.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching match details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch match details' },
      { status: 500 }
    );
  }
}
