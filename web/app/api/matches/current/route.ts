import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    // Find the most recent matchmaking game that's either pending or in progress
    const currentMatch = await prisma.match.findFirst({
      where: {
        matchType: 'matchmaking',
        status: {
          in: ['pending', 'in_progress'],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        whiteAgent: {
          include: {
            ranking: true,
          },
        },
        blackAgent: {
          include: {
            ranking: true,
          },
        },
        gameStates: {
          orderBy: {
            moveNumber: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!currentMatch) {
      return NextResponse.json({
        success: true,
        match: null,
        message: 'No active matchmaking games at the moment',
      });
    }

    return NextResponse.json({
      success: true,
      match: {
        id: currentMatch.id,
        whiteAgent: {
          id: currentMatch.whiteAgent.id,
          name: currentMatch.whiteAgent.name,
          version: currentMatch.whiteAgent.version,
          eloRating: currentMatch.whiteAgent.ranking?.eloRating || 1500,
        },
        blackAgent: {
          id: currentMatch.blackAgent.id,
          name: currentMatch.blackAgent.name,
          version: currentMatch.blackAgent.version,
          eloRating: currentMatch.blackAgent.ranking?.eloRating || 1500,
        },
        status: currentMatch.status,
        moves: currentMatch.moves,
        startedAt: currentMatch.startedAt,
        currentMove: currentMatch.gameStates[0]?.moveNumber || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching current match:', error);
    return NextResponse.json(
      { error: 'Failed to fetch current match' },
      { status: 500 }
    );
  }
}
