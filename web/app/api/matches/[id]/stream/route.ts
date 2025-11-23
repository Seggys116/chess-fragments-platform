import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const match = await prisma.match.findUnique({
    where: { id },
  });

  if (!match) {
    return new Response('Match not found', { status: 404 });
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let interval: NodeJS.Timeout | null = null;
      let isClosed = false;

      const safeClose = () => {
        if (!isClosed) {
          isClosed = true;
          if (interval) clearInterval(interval);
          try {
            controller.close();
          } catch (e) {
          }
        }
      };

      const safeEnqueue = (data: Uint8Array) => {
        if (!isClosed) {
          try {
            controller.enqueue(data);
          } catch (e) {
            console.error('Failed to enqueue data:', e);
            safeClose();
          }
        }
      };

      try {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', matchId: id })}\n\n`));

        // Increment spectator count
        await prisma.match.update({
          where: { id },
          data: { spectatorCount: { increment: 1 } },
        });

        const existingStates = await prisma.gameState.findMany({
          where: { matchId: id },
          orderBy: { moveNumber: 'asc' },
        });

        const initialData = {
          type: 'initial',
          gameStates: existingStates.map(state => ({
            move_number: state.moveNumber,
            board_state: state.boardState,
            move_time_ms: state.moveTimeMs,
            move_notation: state.moveNotation,
            evaluation: state.evaluation,
          })),
        };

        safeEnqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`));

        let lastMoveNumber = existingStates.length > 0 ? existingStates[existingStates.length - 1].moveNumber : -1;
        let isActive = true;

        // Polling loop to check for new moves
        interval = setInterval(async () => {
          if (isClosed) {
            if (interval) clearInterval(interval);
            return;
          }

          try {
            const currentMatch = await prisma.match.findUnique({
              where: { id },
              include: {
                gameStates: {
                  where: {
                    moveNumber: { gt: lastMoveNumber },
                  },
                  orderBy: {
                    moveNumber: 'asc',
                  },
                },
              },
            });

            if (!currentMatch) {
              safeClose();
              return;
            }

            for (const state of currentMatch.gameStates) {
              const data = {
                type: 'move',
                gameState: {
                  move_number: state.moveNumber,
                  board_state: state.boardState,
                  move_time_ms: state.moveTimeMs,
                  move_notation: state.moveNotation,
                  evaluation: state.evaluation,
                },
              };

              safeEnqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
              lastMoveNumber = state.moveNumber;
            }

            if (currentMatch.status === 'completed' && isActive) {
              isActive = false;

              const allFinalStates = await prisma.gameState.findMany({
                where: { matchId: id },
                orderBy: { moveNumber: 'asc' },
              });

              for (const state of allFinalStates) {
                if (state.moveNumber > lastMoveNumber) {
                  const data = {
                    type: 'move',
                    gameState: {
                      move_number: state.moveNumber,
                      board_state: state.boardState,
                      move_time_ms: state.moveTimeMs,
                      move_notation: state.moveNotation,
                      evaluation: state.evaluation,
                    },
                  };
                  safeEnqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                  lastMoveNumber = state.moveNumber;
                }
              }

              // Now send completion message
              const completionData = {
                type: 'completed',
                winner: currentMatch.winner,
                termination: currentMatch.termination,
                completedAt: currentMatch.completedAt,
              };
              safeEnqueue(encoder.encode(`data: ${JSON.stringify(completionData)}\n\n`));

              setTimeout(() => {
                safeClose();
              }, 1000);
            }
          } catch (error) {
            console.error('SSE polling error:', error);
            safeClose();
          }
        }, 500); // Poll every 500ms

        request.signal.addEventListener('abort', async () => {
          // Decrement spectator count
          await prisma.match.update({
            where: { id },
            data: { spectatorCount: { decrement: 1 } },
          }).catch(() => {});
          safeClose();
        });
      } catch (error) {
        console.error('SSE start error:', error);
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
