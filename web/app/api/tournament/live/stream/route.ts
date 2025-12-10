import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { getCachedBrackets } from '@/lib/tournament-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const bracketId = searchParams.get('bracket');
    const requestedMatchId = searchParams.get('matchId'); // Optional: specific match to track

    if (!bracketId || !['challenger', 'contender', 'elite'].includes(bracketId)) {
        return new Response('Invalid bracket ID', { status: 400 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            let interval: NodeJS.Timeout | null = null;
            let isClosed = false;
            let currentMatchId: string | null = null;
            let lastMoveNumber = -1;
            let lastMatchStatus = '';

            const safeClose = () => {
                if (!isClosed) {
                    isClosed = true;
                    if (interval) clearInterval(interval);
                    try {
                        controller.close();
                    } catch {
                        // Already closed
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

            const sendEvent = (type: string, data: unknown) => {
                safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data as object })}\n\n`));
            };

            // Get bracket agent IDs - use cached brackets if available
            const getBracketAgentIds = async (): Promise<string[]> => {
                // Try cached brackets first (fixed at tournament start)
                const cachedBrackets = await getCachedBrackets();
                if (cachedBrackets) {
                    const bracketKey = bracketId as keyof typeof cachedBrackets;
                    return cachedBrackets[bracketKey] || [];
                }

                // Fallback to dynamic calculation if no cache
                const rankings = await prisma.ranking.findMany({
                    where: {
                        gamesPlayed: { gt: 0 },
                        agent: { active: true },
                    },
                    include: { agent: true },
                    orderBy: { eloRating: 'asc' },
                });

                const bestByAgent = new Map<string, typeof rankings[number]>();
                for (const ranking of rankings) {
                    if (!ranking.agent.active) continue;
                    const existing = bestByAgent.get(ranking.agentId);
                    if (!existing || ranking.eloRating > existing.eloRating) {
                        bestByAgent.set(ranking.agentId, ranking);
                    }
                }

                const sorted = Array.from(bestByAgent.values()).sort(
                    (a, b) => a.eloRating - b.eloRating
                );

                const total = sorted.length;
                if (total < 8) {
                    return bracketId === 'contender' ? sorted.map(r => r.agentId) : [];
                }

                const bottom25End = Math.max(1, Math.round(total * 0.25));
                const top25Start = Math.max(bottom25End, Math.round(total * 0.75));

                if (bracketId === 'challenger') {
                    return sorted.slice(0, bottom25End).map(r => r.agentId);
                } else if (bracketId === 'contender') {
                    return sorted.slice(bottom25End, top25Start).map(r => r.agentId);
                } else {
                    return sorted.slice(top25Start).map(r => r.agentId);
                }
            };

            try {
                // Send connected event
                sendEvent('connected', { bracket: bracketId });

                const bracketAgentIds = await getBracketAgentIds();

                if (bracketAgentIds.length === 0) {
                    sendEvent('no_bracket', { message: 'No agents in bracket' });
                    safeClose();
                    return;
                }

                // Poll for live match updates every 300ms for real-time feel
                interval = setInterval(async () => {
                    if (isClosed) {
                        if (interval) clearInterval(interval);
                        return;
                    }

                    try {
                        // Find ALL live tournament matches in this bracket
                        const allLiveMatches = await prisma.match.findMany({
                            where: {
                                matchType: 'tournament',
                                status: 'in_progress',
                                whiteAgentId: { in: bracketAgentIds },
                                blackAgentId: { in: bracketAgentIds },
                            },
                            include: {
                                whiteAgent: {
                                    include: { ranking: true },
                                },
                                blackAgent: {
                                    include: { ranking: true },
                                },
                                gameStates: {
                                    orderBy: { moveNumber: 'asc' },
                                },
                            },
                            orderBy: { startedAt: 'desc' },
                        });

                        // Use requested match if specified, otherwise first live match
                        let liveMatch = allLiveMatches.length > 0 ? allLiveMatches[0] : null;
                        if (requestedMatchId) {
                            const requested = allLiveMatches.find(m => m.id === requestedMatchId);
                            if (requested) {
                                liveMatch = requested;
                            }
                        }

                        // Check for recently completed match
                        const recentComplete = await prisma.match.findFirst({
                            where: {
                                matchType: 'tournament',
                                status: 'completed',
                                whiteAgentId: { in: bracketAgentIds },
                                blackAgentId: { in: bracketAgentIds },
                                completedAt: { gte: new Date(Date.now() - 30000) }, // Last 30 seconds
                            },
                            include: {
                                whiteAgent: true,
                                blackAgent: true,
                            },
                            orderBy: { completedAt: 'desc' },
                        });

                        // Check for queued matches
                        const queuedMatches = await prisma.match.findMany({
                            where: {
                                matchType: 'tournament',
                                status: 'pending',
                                whiteAgentId: { in: bracketAgentIds },
                                blackAgentId: { in: bracketAgentIds },
                            },
                            include: {
                                whiteAgent: true,
                                blackAgent: true,
                            },
                            orderBy: { createdAt: 'asc' },
                            take: 3,
                        });

                        // Send live_matches event with all available matches
                        if (allLiveMatches.length > 0) {
                            sendEvent('live_matches', {
                                matches: allLiveMatches.map(m => ({
                                    id: m.id,
                                    whiteAgent: {
                                        id: m.whiteAgent.id,
                                        name: m.whiteAgent.name,
                                        version: m.whiteAgent.version,
                                        eloRating: m.whiteAgent.ranking?.eloRating ?? 1500,
                                    },
                                    blackAgent: {
                                        id: m.blackAgent.id,
                                        name: m.blackAgent.name,
                                        version: m.blackAgent.version,
                                        eloRating: m.blackAgent.ranking?.eloRating ?? 1500,
                                    },
                                    moves: m.gameStates.length,
                                    startedAt: m.startedAt,
                                })),
                            });
                        }

                        // Handle match state changes
                        if (liveMatch) {
                            // New match started
                            if (currentMatchId !== liveMatch.id) {
                                currentMatchId = liveMatch.id;
                                lastMoveNumber = -1;
                                lastMatchStatus = liveMatch.status;

                                // Send match_start event with full match info
                                sendEvent('match_start', {
                                    matchId: liveMatch.id,
                                    whiteAgent: {
                                        id: liveMatch.whiteAgent.id,
                                        name: liveMatch.whiteAgent.name,
                                        version: liveMatch.whiteAgent.version,
                                        eloRating: liveMatch.whiteAgent.ranking?.eloRating ?? 1500,
                                    },
                                    blackAgent: {
                                        id: liveMatch.blackAgent.id,
                                        name: liveMatch.blackAgent.name,
                                        version: liveMatch.blackAgent.version,
                                        eloRating: liveMatch.blackAgent.ranking?.eloRating ?? 1500,
                                    },
                                    startedAt: liveMatch.startedAt,
                                    gameStates: liveMatch.gameStates.map((gs: { moveNumber: number; boardState: unknown; moveTimeMs: number | null; moveNotation: string | null; evaluation: number | null }) => ({
                                        moveNumber: gs.moveNumber,
                                        boardState: gs.boardState,
                                        moveTimeMs: gs.moveTimeMs,
                                        moveNotation: gs.moveNotation,
                                        evaluation: gs.evaluation,
                                    })),
                                });

                                lastMoveNumber = liveMatch.gameStates.length > 0
                                    ? liveMatch.gameStates[liveMatch.gameStates.length - 1].moveNumber
                                    : -1;
                            } else {
                                // Same match - check for new moves
                                const newMoves = liveMatch.gameStates.filter(
                                    (gs: { moveNumber: number }) => gs.moveNumber > lastMoveNumber
                                );

                                for (const move of newMoves) {
                                    sendEvent('move', {
                                        matchId: liveMatch.id,
                                        gameState: {
                                            moveNumber: move.moveNumber,
                                            boardState: move.boardState,
                                            moveTimeMs: move.moveTimeMs,
                                            moveNotation: move.moveNotation,
                                            evaluation: move.evaluation,
                                        },
                                    });
                                    lastMoveNumber = move.moveNumber;
                                }
                            }
                        } else if (currentMatchId && lastMatchStatus === 'in_progress') {
                            // Match was live but now not found - check if completed
                            const completedMatch = await prisma.match.findUnique({
                                where: { id: currentMatchId },
                                include: {
                                    whiteAgent: true,
                                    blackAgent: true,
                                    gameStates: {
                                        orderBy: { moveNumber: 'asc' },
                                    },
                                },
                            });

                            if (completedMatch && completedMatch.status === 'completed') {
                                // Send any remaining moves
                                const remainingMoves = completedMatch.gameStates.filter(
                                    gs => gs.moveNumber > lastMoveNumber
                                );
                                for (const move of remainingMoves) {
                                    sendEvent('move', {
                                        matchId: completedMatch.id,
                                        gameState: {
                                            moveNumber: move.moveNumber,
                                            boardState: move.boardState,
                                            moveTimeMs: move.moveTimeMs,
                                            moveNotation: move.moveNotation,
                                            evaluation: move.evaluation,
                                        },
                                    });
                                }

                                // Send match complete event
                                sendEvent('match_complete', {
                                    matchId: completedMatch.id,
                                    winner: completedMatch.winner,
                                    termination: completedMatch.termination,
                                    moves: completedMatch.moves,
                                    whiteAgent: completedMatch.whiteAgent.name,
                                    blackAgent: completedMatch.blackAgent.name,
                                });

                                currentMatchId = null;
                                lastMoveNumber = -1;
                                lastMatchStatus = '';
                            }
                        } else if (!liveMatch && !currentMatchId) {
                            // Check if bracket is complete (no pending matches and no in_progress matches)
                            const pendingCount = await prisma.match.count({
                                where: {
                                    matchType: 'tournament',
                                    status: 'pending',
                                    whiteAgentId: { in: bracketAgentIds },
                                    blackAgentId: { in: bracketAgentIds },
                                },
                            });

                            const inProgressCount = await prisma.match.count({
                                where: {
                                    matchType: 'tournament',
                                    status: 'in_progress',
                                    whiteAgentId: { in: bracketAgentIds },
                                    blackAgentId: { in: bracketAgentIds },
                                },
                            });

                            const completedCount = await prisma.match.count({
                                where: {
                                    matchType: 'tournament',
                                    status: 'completed',
                                    whiteAgentId: { in: bracketAgentIds },
                                    blackAgentId: { in: bracketAgentIds },
                                },
                            });

                            // Bracket is complete only if Swiss rounds are finished
                            // Calculate expected rounds and check if all agents have played enough
                            const totalRounds = Math.min(Math.max(3, Math.ceil(Math.log2(bracketAgentIds.length))), bracketAgentIds.length - 1);

                            // Count matches per agent to verify completion
                            const matchesPerAgent: Record<string, number> = {};
                            bracketAgentIds.forEach(id => matchesPerAgent[id] = 0);

                            const allCompletedMatches = await prisma.match.findMany({
                                where: {
                                    matchType: 'tournament',
                                    status: 'completed',
                                    whiteAgentId: { in: bracketAgentIds },
                                    blackAgentId: { in: bracketAgentIds },
                                },
                                select: { whiteAgentId: true, blackAgentId: true },
                            });

                            for (const m of allCompletedMatches) {
                                if (matchesPerAgent[m.whiteAgentId] !== undefined) matchesPerAgent[m.whiteAgentId]++;
                                if (matchesPerAgent[m.blackAgentId] !== undefined) matchesPerAgent[m.blackAgentId]++;
                            }

                            const minMatchesPlayed = Math.min(...Object.values(matchesPerAgent));
                            const bracketActuallyComplete = minMatchesPlayed >= totalRounds && pendingCount === 0 && inProgressCount === 0;

                            if (bracketActuallyComplete) {
                                sendEvent('bracket_complete', {
                                    bracket: bracketId,
                                    totalMatches: completedCount,
                                });
                            } else {
                                // No live match - send idle state with queue info
                                sendEvent('idle', {
                                    queuedMatches: queuedMatches.map(m => ({
                                        id: m.id,
                                        whiteAgent: { id: m.whiteAgent.id, name: m.whiteAgent.name, version: m.whiteAgent.version },
                                        blackAgent: { id: m.blackAgent.id, name: m.blackAgent.name, version: m.blackAgent.version },
                                    })),
                                    recentComplete: recentComplete ? {
                                        id: recentComplete.id,
                                        winner: recentComplete.winner,
                                        whiteAgent: recentComplete.whiteAgent.name,
                                        blackAgent: recentComplete.blackAgent.name,
                                    } : null,
                                });
                            }
                        }

                        // Always send queue update
                        if (queuedMatches.length > 0 || recentComplete) {
                            sendEvent('queue_update', {
                                queuedMatches: queuedMatches.map(m => ({
                                    id: m.id,
                                    whiteAgent: { id: m.whiteAgent.id, name: m.whiteAgent.name, version: m.whiteAgent.version },
                                    blackAgent: { id: m.blackAgent.id, name: m.blackAgent.name, version: m.blackAgent.version },
                                })),
                            });
                        }

                    } catch (error) {
                        console.error('Tournament SSE polling error:', error);
                    }
                }, 300); // Poll every 300ms for real-time updates

                // Handle client disconnect
                request.signal.addEventListener('abort', () => {
                    safeClose();
                });

            } catch (error) {
                console.error('Tournament SSE start error:', error);
                safeClose();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
