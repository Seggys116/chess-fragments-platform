import { NextResponse } from 'next/server';
import { gameBufferManager } from '@/lib/gameBufferManager';

export async function GET() {
  try {
    // Get buffered games ready for streaming
    const bufferedGames = gameBufferManager.getBufferedGames();

    const matches = bufferedGames.map(game => ({
      id: game.matchId,
      whiteAgent: game.whiteAgent,
      blackAgent: game.blackAgent,
      status: 'ready', // All buffered games are ready to stream
      moves: game.moves.length,
      startedAt: new Date(), // Use current time as these are buffered replays
      currentMove: 0, // Always start from 0 for buffered games
    }));

    return NextResponse.json({
      success: true,
      matches,
      count: matches.length,
    });
  } catch (error) {
    console.error('Error fetching buffered games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch buffered games' },
      { status: 500 }
    );
  }
}
