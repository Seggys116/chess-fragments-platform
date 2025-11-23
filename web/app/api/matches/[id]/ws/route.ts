import { NextRequest } from 'next/server';
import { gameBufferManager } from '@/lib/gameBufferManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get buffered game
  const bufferedGame = gameBufferManager.getGame(id);

  if (!bufferedGame) {
    return new Response('Game not found in buffer', { status: 404 });
  }

  // Use streaming with NDJSON for controlled playback
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let interval: NodeJS.Timeout | null = null;
      let isClosed = false;
      let timeout: NodeJS.Timeout | null = null;

      const safeClose = () => {
        if (!isClosed) {
          isClosed = true;
          if (interval) clearInterval(interval);
          if (timeout) clearTimeout(timeout);
          try {
            controller.close();
          } catch {
          }
        }
      };

      const sendMessage = (data: unknown) => {
        if (!isClosed) {
          try {
            const message = JSON.stringify(data);
            controller.enqueue(encoder.encode(`${message}\n`));
          } catch {
            safeClose();
          }
        }
      };

      try {
        sendMessage({ type: 'connected', matchId: id });

        sendMessage({
          type: 'initial',
          gameStates: [],
        });

        // Set 3-minute timeout - after 3 minutes, send refresh message and close
        timeout = setTimeout(() => {
          sendMessage({
            type: 'timeout',
            message: 'Stream timeout - please refresh',
          });
          safeClose();
        }, 3 * 60 * 1000); // 3 minutes

        // Copy all moves to streaming buffer
        const moveBuffer = [...bufferedGame.moves];
        let moveIndex = 0;

        // Stream moves at controlled rate: 1 move per 250ms (4 moves/sec)
        interval = setInterval(() => {
          if (isClosed) {
            if (interval) clearInterval(interval);
            return;
          }

          try {
            if (moveIndex < moveBuffer.length) {
              const moveToSend = moveBuffer[moveIndex];
              sendMessage({
                type: 'move',
                gameState: moveToSend,
              });
              moveIndex++;
            } else {
              // All moves streamed, send completion
              sendMessage({
                type: 'completed',
                winner: bufferedGame.winner,
                termination: bufferedGame.termination,
                completedAt: bufferedGame.completedAt,
              });

              // Mark game as completed in buffer manager
              gameBufferManager.markGameAsCompleted(id);

              setTimeout(safeClose, 1000);
              if (interval) clearInterval(interval);
            }
          } catch (error) {
            console.error('Streaming error:', error);
            safeClose();
          }
        }, 250); // Stream 1 move every 250ms (4 moves/second)

        request.signal.addEventListener('abort', () => {
          safeClose();
        });
      } catch (error) {
        console.error('Stream start error:', error);
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
