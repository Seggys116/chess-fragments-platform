import { prisma } from './db';

interface BufferedGame {
  matchId: string;
  moves: Array<{
    move_number: number;
    board_state: unknown;
    move_time_ms: number | null;
    move_notation: string | null;
    evaluation: number | null;
  }>;
  whiteAgent: { id: string; name: string; version: number; eloRating: number };
  blackAgent: { id: string; name: string; version: number; eloRating: number };
  status: string;
  winner: string | null;
  termination: string | null;
  completedAt: Date | null;
}

class GameBufferManager {
  private static instance: GameBufferManager;
  private gameBuffer: BufferedGame[] = [];
  private readonly MAX_BUFFER_SIZE = 8;
  private isPolling = false;
  private pollInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.startPolling();
  }

  public static getInstance(): GameBufferManager {
    if (!GameBufferManager.instance) {
      GameBufferManager.instance = new GameBufferManager();
    }
    return GameBufferManager.instance;
  }

  private async startPolling() {
    if (this.isPolling) return;

    this.isPolling = true;
    console.log('Game buffer manager started');

    // Initial fill
    await this.fillBuffer();

    // Poll every 5 seconds to maintain buffer
    this.pollInterval = setInterval(async () => {
      await this.fillBuffer();
    }, 5000);
  }

  private async fillBuffer() {
    try {
      // Remove completed games that have been fully streamed
      this.gameBuffer = this.gameBuffer.filter(game => game.status !== 'completed');

      // Calculate how many games we need
      const slotsAvailable = this.MAX_BUFFER_SIZE - this.gameBuffer.length;

      if (slotsAvailable <= 0) {
        return; // Buffer is full
      }

      const bufferedIds = this.gameBuffer.map(g => g.matchId);

      // Find completed matchmaking games not yet in buffer
      const completedMatches = await prisma.match.findMany({
        where: {
          matchType: 'matchmaking',
          status: 'completed',
          id: bufferedIds.length > 0 ? { notIn: bufferedIds } : undefined,
        },
        orderBy: {
          completedAt: 'desc',
        },
        take: slotsAvailable,
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
              moveNumber: 'asc',
            },
          },
        },
      });

      // Add new games to buffer
      for (const match of completedMatches) {
        const bufferedGame: BufferedGame = {
          matchId: match.id,
          moves: match.gameStates.map(state => ({
            move_number: state.moveNumber,
            board_state: state.boardState,
            move_time_ms: state.moveTimeMs,
            move_notation: state.moveNotation,
            evaluation: state.evaluation,
          })),
          whiteAgent: {
            id: match.whiteAgent.id,
            name: match.whiteAgent.name,
            version: match.whiteAgent.version,
            eloRating: match.whiteAgent.ranking?.eloRating || 1500,
          },
          blackAgent: {
            id: match.blackAgent.id,
            name: match.blackAgent.name,
            version: match.blackAgent.version,
            eloRating: match.blackAgent.ranking?.eloRating || 1500,
          },
          status: 'ready', // Ready to stream
          winner: match.winner,
          termination: match.termination,
          completedAt: match.completedAt,
        };

        this.gameBuffer.push(bufferedGame);
      }
    } catch (error) {
      console.error('Error filling game buffer:', error);
    }
  }

  public getBufferedGames(): BufferedGame[] {
    return this.gameBuffer.filter(g => g.status === 'ready');
  }

  public getGame(matchId: string): BufferedGame | undefined {
    return this.gameBuffer.find(g => g.matchId === matchId);
  }

  public markGameAsCompleted(matchId: string) {
    const game = this.gameBuffer.find(g => g.matchId === matchId);
    if (game) {
      game.status = 'completed';
    }
  }

  public stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isPolling = false;
    console.log('Game buffer manager stopped');
  }
}

// Export singleton instance
export const gameBufferManager = GameBufferManager.getInstance();
