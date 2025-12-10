'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Radio, Loader2, Zap, Clock, ChevronRight, CheckCircle, WifiOff, Trophy } from 'lucide-react';

interface Piece {
    type: string;
    player: string;
    x: number;
    y: number;
}

interface BoardState {
    pieces: Piece[];
}

interface GameState {
    moveNumber: number;
    boardState: BoardState;
    moveTimeMs?: number;
    moveNotation?: string;
    evaluation?: number;
}

interface LiveMatchData {
    id: string;
    status: string;
    moves: number;
    whiteAgent: { id: string; name: string; version: number; eloRating: number };
    blackAgent: { id: string; name: string; version: number; eloRating: number };
    startedAt: string;
    currentMove: number;
    gameStates: GameState[];
    winner?: string | null;
    termination?: string | null;
}

interface QueuedMatch {
    id: string;
    whiteAgent: { id: string; name: string; version: number };
    blackAgent: { id: string; name: string; version: number };
}

interface LiveMatchOption {
    id: string;
    whiteAgent: { id: string; name: string; version: number; eloRating: number };
    blackAgent: { id: string; name: string; version: number; eloRating: number };
    moves: number;
    startedAt: string;
}

interface RecentComplete {
    id: string;
    winner: string | null;
    whiteAgent: string;
    blackAgent: string;
}

interface TournamentLiveViewerProps {
    bracketId: 'challenger' | 'contender' | 'elite';
    bracketLabel: string;
}

export default function TournamentLiveViewer({ bracketId, bracketLabel }: TournamentLiveViewerProps) {
    const [match, setMatch] = useState<LiveMatchData | null>(null);
    const [gameStates, setGameStates] = useState<GameState[]>([]);
    const [queuedMatches, setQueuedMatches] = useState<QueuedMatch[]>([]);
    const [recentComplete, setRecentComplete] = useState<RecentComplete | null>(null);
    const [liveMatches, setLiveMatches] = useState<LiveMatchOption[]>([]);
    const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [showMatchComplete, setShowMatchComplete] = useState(false);
    const [bracketComplete, setBracketComplete] = useState(false);
    const [completedMatchResult, setCompletedMatchResult] = useState<{
        winner: string | null;
        termination: string | null;
        whiteAgent: string;
        blackAgent: string;
    } | null>(null);

    const eventSourceRef = useRef<EventSource | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttempts = useRef(0);

    const extractPieces = useCallback((boardData: unknown): Piece[] => {
        if (typeof boardData === 'string') {
            try {
                const parsed = JSON.parse(boardData);
                if (parsed.pieces && Array.isArray(parsed.pieces)) {
                    return parsed.pieces;
                }
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            } catch {
                return [];
            }
        } else if (Array.isArray(boardData)) {
            return boardData;
        } else if (typeof boardData === 'object' && boardData !== null && 'pieces' in boardData) {
            return (boardData as BoardState).pieces || [];
        }
        return [];
    }, []);

    const connectSSE = useCallback(() => {
        // Clean up existing connection
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        const url = selectedMatchId
            ? `/api/tournament/live/stream?bracket=${bracketId}&matchId=${selectedMatchId}`
            : `/api/tournament/live/stream?bracket=${bracketId}`;
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
            setIsConnected(true);
            setIsLoading(false);
            reconnectAttempts.current = 0;
        };

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                switch (data.type) {
                    case 'connected':
                        setIsConnected(true);
                        setIsLoading(false);
                        break;

                    case 'match_start':
                        // New match started
                        setShowMatchComplete(false);
                        setCompletedMatchResult(null);
                        setMatch({
                            id: data.matchId,
                            status: 'in_progress',
                            moves: data.gameStates?.length || 0,
                            whiteAgent: data.whiteAgent,
                            blackAgent: data.blackAgent,
                            startedAt: data.startedAt,
                            currentMove: data.gameStates?.length || 0,
                            gameStates: data.gameStates || [],
                        });
                        setGameStates(data.gameStates || []);
                        break;

                    case 'move':
                        // New move received
                        setGameStates(prev => {
                            // Avoid duplicates
                            if (prev.some(gs => gs.moveNumber === data.gameState.moveNumber)) {
                                return prev;
                            }
                            return [...prev, data.gameState];
                        });
                        setMatch(prev => prev ? {
                            ...prev,
                            moves: data.gameState.moveNumber,
                            currentMove: data.gameState.moveNumber,
                        } : null);
                        break;

                    case 'match_complete':
                        // Match completed
                        setCompletedMatchResult({
                            winner: data.winner,
                            termination: data.termination,
                            whiteAgent: data.whiteAgent,
                            blackAgent: data.blackAgent,
                        });
                        setShowMatchComplete(true);
                        // Clear match after showing result
                        setTimeout(() => {
                            setShowMatchComplete(false);
                            setMatch(null);
                            setGameStates([]);
                            setCompletedMatchResult(null);
                        }, 3000);
                        break;

                    case 'idle':
                        // No live match
                        if (!showMatchComplete) {
                            setMatch(null);
                            setGameStates([]);
                        }
                        if (data.queuedMatches) {
                            setQueuedMatches(data.queuedMatches);
                        }
                        if (data.recentComplete) {
                            setRecentComplete(data.recentComplete);
                        }
                        break;

                    case 'queue_update':
                        if (data.queuedMatches) {
                            setQueuedMatches(data.queuedMatches);
                        }
                        break;

                    case 'live_matches':
                        if (data.matches) {
                            setLiveMatches(data.matches);
                            // Auto-select first match if none selected
                            if (!selectedMatchId && data.matches.length > 0) {
                                setSelectedMatchId(data.matches[0].id);
                            }
                            // Clear selection if selected match is no longer live
                            if (selectedMatchId && !data.matches.find((m: LiveMatchOption) => m.id === selectedMatchId)) {
                                if (data.matches.length > 0) {
                                    setSelectedMatchId(data.matches[0].id);
                                } else {
                                    setSelectedMatchId(null);
                                }
                            }
                        }
                        break;

                    case 'bracket_complete':
                        // Refresh the page to show final results
                        window.location.reload();
                        break;

                    case 'no_bracket':
                        setIsLoading(false);
                        break;
                }
            } catch (err) {
                console.error('Error parsing SSE message:', err);
            }
        };

        eventSource.onerror = () => {
            setIsConnected(false);
            eventSource.close();

            // Exponential backoff reconnect
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
            reconnectAttempts.current++;

            reconnectTimeoutRef.current = setTimeout(() => {
                connectSSE();
            }, delay);
        };
    }, [bracketId, showMatchComplete, selectedMatchId]);

    // Reset all state when bracket changes
    useEffect(() => {
        setBracketComplete(false);
        setMatch(null);
        setGameStates([]);
        setQueuedMatches([]);
        setLiveMatches([]);
        setSelectedMatchId(null);
        setIsLoading(true);
    }, [bracketId]);

    // Connect/reconnect SSE when bracket or selected match changes
    useEffect(() => {
        connectSSE();

        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, [connectSSE]);

    const currentState = gameStates.length > 0 ? gameStates[gameStates.length - 1] : null;

    const renderPiece = (piece: Piece) => {
        const pieceName = piece.type.toLowerCase();
        const color = piece.player.toLowerCase();
        const imagePath = `/pieces/${color}_${pieceName}.svg`;

        return (
            <img
                src={imagePath}
                alt={`${color} ${pieceName}`}
                className="w-10 h-10 drop-shadow-lg transition-all duration-150"
            />
        );
    };

    const renderBoard = () => {
        const grid: (Piece | null)[][] = Array(5).fill(null).map(() => Array(5).fill(null));

        if (currentState && currentState.boardState) {
            const pieces = extractPieces(currentState.boardState);
            pieces.forEach(piece => {
                if (piece && piece.y >= 0 && piece.y < 5 && piece.x >= 0 && piece.x < 5) {
                    grid[piece.y][piece.x] = piece;
                }
            });
        }

        return (
            <div className="border border-gray-700/50 relative">
                {/* Live indicator overlay */}
                {match && isConnected && (
                    <div className="absolute -top-2 -right-2 z-10">
                        <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                        </span>
                    </div>
                )}
                {grid.map((row, y) => (
                    <div key={y} className="flex">
                        {row.map((piece, x) => {
                            const isLight = (x + y) % 2 === 0;
                            return (
                                <div
                                    key={`${x}-${y}`}
                                    className={`w-12 h-12 flex items-center justify-center transition-colors duration-150 ${isLight
                                        ? 'bg-gradient-to-br from-purple-200/20 to-purple-300/20'
                                        : 'bg-gradient-to-br from-gray-800/80 to-gray-900/80'
                                    }`}
                                >
                                    {piece && renderPiece(piece)}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        );
    };

    if (isLoading) {
        return (
            <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-xl p-6 flex flex-col items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-4" />
                <p className="text-gray-400">Connecting to {bracketLabel} stream...</p>
            </div>
        );
    }

    // Show bracket complete state
    if (bracketComplete) {
        return (
            <div className="bg-gray-900/60 backdrop-blur border border-yellow-500/30 rounded-xl p-6 flex flex-col items-center justify-center min-h-[400px]">
                <Trophy className="w-12 h-12 text-yellow-400 mb-4" />
                <p className="text-white font-semibold text-lg">{bracketLabel} Complete</p>
                <p className="text-gray-400 text-sm mt-2">All matches in this bracket have finished.</p>
                <p className="text-gray-500 text-xs mt-2">View the final standings in the panel on the right.</p>
            </div>
        );
    }

    // Show match completed transition
    if (showMatchComplete && completedMatchResult) {
        return (
            <div className="bg-gray-900/60 backdrop-blur border border-green-500/30 rounded-xl p-6 flex flex-col items-center justify-center min-h-[400px]">
                <CheckCircle className="w-12 h-12 text-green-400 mb-4" />
                <p className="text-white font-semibold text-lg">Match Complete</p>
                <p className="text-gray-300 text-sm mt-2">
                    {completedMatchResult.winner === 'white'
                        ? `${completedMatchResult.whiteAgent} wins!`
                        : completedMatchResult.winner === 'black'
                        ? `${completedMatchResult.blackAgent} wins!`
                        : 'Draw'}
                </p>
                <p className="text-gray-500 text-xs mt-1">Loading next match...</p>
            </div>
        );
    }

    if (!match) {
        return (
            <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-xl p-6 space-y-4">
                {/* Connection status */}
                <div className="flex items-center justify-center gap-2">
                    {isConnected ? (
                        <span className="flex items-center gap-1.5 text-xs text-green-400">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                            Connected
                        </span>
                    ) : (
                        <span className="flex items-center gap-1.5 text-xs text-yellow-400">
                            <WifiOff className="w-3 h-3" />
                            Reconnecting...
                        </span>
                    )}
                </div>

                <div className="flex flex-col items-center justify-center py-6">
                    <Radio className="w-12 h-12 text-purple-400 opacity-50 mb-4" />
                    <p className="text-gray-300 font-semibold text-lg">No live game in {bracketLabel}</p>
                    <p className="text-gray-500 text-sm mt-2">Waiting for tournament matches...</p>
                </div>

                {/* Show recent complete */}
                {recentComplete && (
                    <div className="border-t border-purple-500/20 pt-4">
                        <div className="flex items-center gap-2 mb-3">
                            <CheckCircle className="w-4 h-4 text-green-400" />
                            <span className="text-sm text-gray-300 font-medium">Just Finished</span>
                        </div>
                        <div className="p-3 bg-green-900/20 border border-green-500/30 rounded-lg">
                            <div className="flex items-center justify-between text-sm">
                                <span className={recentComplete.winner === 'white' ? 'text-green-400 font-semibold' : 'text-gray-400'}>
                                    {recentComplete.whiteAgent}
                                </span>
                                <span className="text-gray-500 text-xs">vs</span>
                                <span className={recentComplete.winner === 'black' ? 'text-green-400 font-semibold' : 'text-gray-400'}>
                                    {recentComplete.blackAgent}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Show match queue */}
                {queuedMatches.length > 0 && (
                    <div className="border-t border-purple-500/20 pt-4">
                        <div className="flex items-center gap-2 mb-3">
                            <Clock className="w-4 h-4 text-purple-400" />
                            <span className="text-sm text-gray-300 font-medium">Up Next</span>
                        </div>
                        <div className="space-y-2">
                            {queuedMatches.slice(0, 3).map((qm, idx) => (
                                <div key={qm.id} className="flex items-center justify-between p-2 bg-gray-800/40 rounded-lg text-xs">
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-500">{idx + 1}.</span>
                                        <span className="text-white">{qm.whiteAgent.name}</span>
                                        <span className="text-gray-500">vs</span>
                                        <span className="text-white">{qm.blackAgent.name}</span>
                                    </div>
                                    <span className="text-yellow-400/70 text-[10px]">PENDING</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Radio className="w-5 h-5 text-green-400 animate-pulse" />
                    <span className="text-white font-semibold">Live: {bracketLabel}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="relative flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-600/20 text-green-200 border border-green-500/40 text-xs">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        LIVE
                    </span>
                    <Link
                        href={`/match/${match.id}`}
                        className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                    >
                        View Full
                    </Link>
                </div>
            </div>

            {/* Match Selector - show when multiple matches are live */}
            {liveMatches.length > 1 && (
                <div className="border-t border-purple-500/20 pt-3">
                    <div className="text-xs text-gray-400 mb-2">{liveMatches.length} matches live - select one to watch:</div>
                    <div className="flex flex-wrap gap-2">
                        {liveMatches.map((lm) => (
                            <button
                                key={lm.id}
                                onClick={() => setSelectedMatchId(lm.id)}
                                className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                                    selectedMatchId === lm.id
                                        ? 'bg-purple-600/30 border-purple-500/50 text-white'
                                        : 'bg-gray-800/40 border-gray-700/50 text-gray-400 hover:border-purple-500/30 hover:text-gray-200'
                                }`}
                            >
                                {lm.whiteAgent.name} vs {lm.blackAgent.name}
                                <span className="ml-2 text-gray-500">({lm.moves} moves)</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex justify-center">
                {renderBoard()}
            </div>

            <div className="text-center">
                <div className="bg-purple-900/30 backdrop-blur border border-purple-500/30 rounded-xl p-3 inline-block">
                    <div className="text-xs text-purple-300 uppercase font-semibold">Move</div>
                    <div className="text-2xl font-bold text-white">{gameStates.length}</div>
                    {currentState?.moveNotation && (
                        <div className="text-sm text-purple-300">{currentState.moveNotation}</div>
                    )}
                    {currentState?.moveTimeMs !== undefined && (
                        <div className="text-xs text-gray-500 mt-1">{currentState.moveTimeMs}ms</div>
                    )}
                </div>
            </div>

            <div className="flex justify-center items-center gap-4">
                <div className="flex items-center gap-2 text-right">
                    <div>
                        <div className="text-white font-semibold text-sm">{match.whiteAgent.name}</div>
                        <div className="text-xs text-gray-400">v{match.whiteAgent.version}</div>
                        <div className="text-xs text-yellow-400">
                            <Zap className="w-3 h-3 inline" /> {match.whiteAgent.eloRating}
                        </div>
                    </div>
                    <div className="w-4 h-4 rounded-full bg-white border border-gray-300 shadow-md"></div>
                </div>
                <div className="bg-purple-600/50 backdrop-blur px-3 py-1 rounded-lg border border-purple-400/50">
                    <span className="text-white font-bold text-sm">VS</span>
                </div>
                <div className="flex items-center gap-2 text-left">
                    <div className="w-4 h-4 rounded-full bg-gray-800 border border-gray-500 shadow-md"></div>
                    <div>
                        <div className="text-white font-semibold text-sm">{match.blackAgent.name}</div>
                        <div className="text-xs text-gray-400">v{match.blackAgent.version}</div>
                        <div className="text-xs text-yellow-400">
                            <Zap className="w-3 h-3 inline" /> {match.blackAgent.eloRating}
                        </div>
                    </div>
                </div>
            </div>

            {/* Match Queue - show upcoming matches */}
            {queuedMatches.length > 0 && (
                <div className="border-t border-purple-500/20 pt-4">
                    <div className="flex items-center gap-2 mb-2">
                        <ChevronRight className="w-4 h-4 text-purple-400" />
                        <span className="text-xs text-gray-400">Up Next</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {queuedMatches.slice(0, 2).map((qm) => (
                            <div key={qm.id} className="text-[10px] px-2 py-1 bg-gray-800/40 rounded text-gray-400">
                                {qm.whiteAgent.name} vs {qm.blackAgent.name}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
