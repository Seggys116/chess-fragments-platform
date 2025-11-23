'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import AnimatedBackground from '@/components/AnimatedBackground';
import { Activity, ChevronLeft, ChevronRight, Play, Pause, SkipBack, SkipForward, Zap, Loader2 } from 'lucide-react';

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
  move_number: number;
  board_state: BoardState;
  move_time_ms?: number;
  move_notation?: string;
  evaluation?: number;
}

interface LiveMatch {
  id: string;
  whiteAgent: { id: string; name: string; version: number; eloRating: number };
  blackAgent: { id: string; name: string; version: number; eloRating: number };
  status: string;
  moves: number;
  currentMove: number;
  startedAt: string;
}

export default function LiveMatchPage() {
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);
  const [allGameStates, setAllGameStates] = useState<GameState[]>([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGamesList, setShowGamesList] = useState(false);

  const previousStateRef = useRef<GameState | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const isConnectingRef = useRef(false);

  // Extract pieces from board state (handle multiple formats)
  const extractPieces = useCallback((boardData: unknown): Piece[] => {
    let pieces: Piece[] = [];

    if (typeof boardData === 'string') {
      try {
        const parsed = JSON.parse(boardData);
        if (parsed.pieces && Array.isArray(parsed.pieces)) {
          pieces = parsed.pieces;
        } else if (Array.isArray(parsed)) {
          pieces = parsed;
        }
      } catch (e) {
        console.error('Failed to parse board state:', e);
      }
    } else if (Array.isArray(boardData)) {
      pieces = boardData;
    } else if (typeof boardData === 'object' && boardData !== null && 'pieces' in boardData) {
      pieces = (boardData as BoardState).pieces || [];
    }

    return pieces;
  }, []);

  // No animation - pieces teleport instantly

  const fetchLiveMatches = useCallback(async () => {
    try {
      const res = await fetch('/api/matches/live');
      const data = await res.json();

      if (data.matches && data.matches.length > 0) {
        setLiveMatches(data.matches);
        return data.matches;
      }
      return [];
    } catch (err) {
      console.error('Error fetching live matches:', err);
      return [];
    }
  }, []);

  // Connect to streaming endpoint for a specific match
  const connectToMatch = useCallback(async (matchId: string, currentIndex: number) => {
    // Prevent duplicate connections
    if (isConnectingRef.current) {
      console.log('Already connecting, skipping duplicate connection attempt');
      return;
    }

    isConnectingRef.current = true;
    console.log('Connecting to match:', matchId, 'at index:', currentIndex);

    // Clean up existing connection
    if (abortControllerRef.current) {
      console.log('Aborting existing stream connection');
      abortControllerRef.current.abort();
    }

    if (streamReaderRef.current) {
      try {
        await streamReaderRef.current.cancel();
      } catch {
        // Ignore errors on cancel
      }
      streamReaderRef.current = null;
    }

    // Reset state for new match
    setAllGameStates([]);
    setCurrentMoveIndex(0);
    previousStateRef.current = null;
    setIsConnecting(true);
    setError(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch(`/api/matches/${matchId}/ws`, {
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      console.log('Stream connection opened');
      setIsConnecting(false);
      isConnectingRef.current = false;

      const reader = response.body.getReader();
      streamReaderRef.current = reader;

      const decoder = new TextDecoder();
      let buffer = '';

      // Read stream continuously
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('Stream ended');
          break;
        }

        // Decode the chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines (NDJSON format)
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);
            console.log('Stream message received:', data.type);

            if (data.type === 'connected') {
              console.log('Connected to match:', data.matchId);
            } else if (data.type === 'heartbeat') {
              // Heartbeat to keep connection alive - no action needed
              console.log('Heartbeat received');
            } else if (data.type === 'initial') {
              const states = data.gameStates || [];
              console.log('Initial game states received:', states.length);
              setAllGameStates(states);
              const lastIndex = states.length > 0 ? states.length - 1 : 0;
              setCurrentMoveIndex(lastIndex);
              if (states.length > 0) {
                previousStateRef.current = states[lastIndex];
              }
            } else if (data.type === 'move') {
              const newState = data.gameState;
              console.log('New move received:', newState.move_number);

              setAllGameStates(prev => {
                const updated = [...prev, newState];

                previousStateRef.current = newState;

                setCurrentMoveIndex(updated.length - 1);

                return updated;
              });

            } else if (data.type === 'timeout') {
              console.log('Stream timeout received');
              setError('Stream timeout - please refresh the page');
              setIsConnecting(false);
            } else if (data.type === 'completed') {
              console.log('Match completed, switching to next game...');
              // Match completed, refresh and switch to next game
              setTimeout(async () => {
                const matches = await fetchLiveMatches();
                if (matches && matches.length > 0) {
                  const nextIndex = (currentIndex + 1) % matches.length;
                  console.log('Switching to next game:', nextIndex);
                  setSelectedMatchIndex(nextIndex);
                  connectToMatch(matches[nextIndex].id, nextIndex);
                }
              }, 2000);
            }
          } catch (err) {
            console.error('Error parsing stream message:', err, 'Line:', line);
          }
        }
      }
    } catch (err: unknown) {
      isConnectingRef.current = false;

      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Stream aborted');
        return;
      }

      console.error('Stream error:', err);
      setError('Connection lost. Reconnecting...');

      // Reconnect after delay
      setTimeout(async () => {
        const matches = await fetchLiveMatches();
        if (matches.length > 0) {
          const reconnectIndex = Math.min(currentIndex, matches.length - 1);
          connectToMatch(matches[reconnectIndex].id, reconnectIndex);
        }
      }, 2000);
    }
  }, [fetchLiveMatches]);

  const handleMatchChange = useCallback((newIndex: number) => {
    if (newIndex >= 0 && newIndex < liveMatches.length && newIndex !== selectedMatchIndex) {
      console.log('Switching from match index', selectedMatchIndex, 'to', newIndex);
      setSelectedMatchIndex(newIndex);
      connectToMatch(liveMatches[newIndex].id, newIndex);
    }
  }, [liveMatches, selectedMatchIndex, connectToMatch]);

  // Initial fetch and setup polling
  useEffect(() => {
    const init = async () => {
      const matches = await fetchLiveMatches();
      if (matches.length > 0) {
        setSelectedMatchIndex(0);
        connectToMatch(matches[0].id, 0);
      } else {
        setIsConnecting(false);
      }
    };

    init();

    // Poll for new matches every 10 seconds
    pollIntervalRef.current = setInterval(async () => {
      await fetchLiveMatches();
    }, 10000);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (streamReaderRef.current) {
        streamReaderRef.current.cancel().catch(() => {});
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const currentMatch = liveMatches[selectedMatchIndex] || null;
  const currentState = allGameStates[currentMoveIndex];

  // Debug logging
  if (currentMatch && !currentState) {
    console.log('No current state - allGameStates:', allGameStates.length, 'currentMoveIndex:', currentMoveIndex);
  }

  // Render chess piece
  const renderPiece = (piece: Piece, isAnimating: boolean = false, style: React.CSSProperties = {}) => {
    const pieceName = piece.type.toLowerCase();
    const color = piece.player.toLowerCase();
    const imagePath = `/pieces/${color}_${pieceName}.svg`;

    return (
      <img
        src={imagePath}
        alt={`${color} ${pieceName}`}
        width={60}
        height={60}
        className={`${isAnimating ? '' : 'transition-all duration-300'} drop-shadow-lg`}
        style={style}
      />
    );
  };

  // Render board
  const renderBoard = () => {
    const grid: (Piece | null)[][] = Array(5).fill(null).map(() => Array(5).fill(null));

    if (currentState && currentState.board_state) {
      const pieces = extractPieces(currentState.board_state);

      console.log('Rendering board - currentState:', currentState);
      console.log('Extracted pieces:', pieces.length, pieces);

      pieces.forEach(piece => {
        if (piece && piece.y >= 0 && piece.y < 5 && piece.x >= 0 && piece.x < 5) {
          grid[piece.y][piece.x] = piece;
        }
      });
    } else {
      console.log('No currentState or board_state:', currentState);
    }

    return (
      <div className="relative">
        <div className="bg-gray-900/50 p-4 rounded-xl border-2 border-purple-500/50 shadow-2xl shadow-purple-500/20">
          <div className="flex">
            {/* Rank coordinates (left) */}
            <div className="flex flex-col mr-2">
              <div className="h-6"></div>
              {['5', '4', '3', '2', '1'].map(rank => (
                <div key={rank} className="h-20 flex items-center justify-center text-gray-500 text-sm font-semibold w-6">
                  {rank}
                </div>
              ))}
            </div>

            {/* Main board wrapper */}
            <div className="relative">
              {/* File coordinates (top) */}
              <div className="flex mb-2">
                {['a', 'b', 'c', 'd', 'e'].map(file => (
                  <div key={file} className="w-20 text-center text-gray-500 text-sm font-semibold h-6 flex items-center justify-center">
                    {file}
                  </div>
                ))}
              </div>

              {/* Chess board grid */}
              <div className="border border-gray-700/50 relative">
                {grid.map((row, y) => (
                  <div key={y} className="flex">
                    {row.map((piece, x) => {
                      const isLight = (x + y) % 2 === 0;
                      return (
                        <div
                          key={`${x}-${y}`}
                          className={`w-20 h-20 flex items-center justify-center ${
                            isLight
                              ? 'bg-gradient-to-br from-purple-200/20 to-purple-300/20'
                              : 'bg-gradient-to-br from-gray-800/80 to-gray-900/80'
                          }`}
                        >
                          {piece && (
                            <div className="w-16 h-16 flex items-center justify-center">
                              {renderPiece(piece)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* File coordinates (bottom) */}
              <div className="flex mt-2">
                {['a', 'b', 'c', 'd', 'e'].map(file => (
                  <div key={file} className="w-20 text-center text-gray-500 text-sm font-semibold h-6 flex items-center justify-center">
                    {file}
                  </div>
                ))}
              </div>
            </div>

            {/* Rank coordinates (right) */}
            <div className="flex flex-col ml-2">
              <div className="h-6"></div>
              {['5', '4', '3', '2', '1'].map(rank => (
                <div key={rank} className="h-20 flex items-center justify-center text-gray-500 text-sm font-semibold w-6">
                  {rank}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen relative">
      <AnimatedBackground />
      <div className="relative z-10 flex flex-col min-h-screen">
        <Navigation />

        {/* Header with game switcher */}
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Activity className="w-8 h-8 text-purple-400" />
              <h1 className="text-3xl font-bold text-white">Live Battles</h1>
              {isConnecting && (
                <span className="px-3 py-1 bg-yellow-900/50 text-yellow-300 rounded-full text-sm animate-pulse border border-yellow-500/30">
                  Connecting...
                </span>
              )}
              {!isConnecting && liveMatches.length > 0 && (
                <span className="px-3 py-1 bg-green-900/50 text-green-300 rounded-full text-sm animate-pulse border border-green-500/30 flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                  LIVE
                </span>
              )}
            </div>

            {liveMatches.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm">
                  {liveMatches.length} game{liveMatches.length !== 1 ? 's' : ''} in progress
                </span>
                <button
                  onClick={() => setShowGamesList(!showGamesList)}
                  className="bg-purple-600/80 backdrop-blur hover:bg-purple-700/80 text-white px-4 py-2 rounded-lg font-semibold transition-all shadow-lg shadow-purple-500/20"
                >
                  {showGamesList ? 'Hide' : 'Show'} All Games
                </button>
              </div>
            )}
          </div>

          {/* Games list dropdown */}
          {showGamesList && liveMatches.length > 0 && (
            <div className="bg-gray-900/95 backdrop-blur border border-purple-500/30 rounded-xl p-4 mb-4 shadow-xl">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {liveMatches.map((match, idx) => (
                  <button
                    key={match.id}
                    onClick={() => handleMatchChange(idx)}
                    className={`text-left p-4 rounded-lg transition-all ${
                      idx === selectedMatchIndex
                        ? 'bg-purple-600/50 border-2 border-purple-400'
                        : 'bg-gray-800/50 border border-purple-500/20 hover:bg-gray-700/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-400">Game {idx + 1}</span>
                      <span className="text-xs text-purple-400">
                        Move {idx === selectedMatchIndex ? allGameStates.length : match.currentMove}
                      </span>
                    </div>
                    <div className="text-sm">
                      <div className="text-white font-semibold truncate">
                        {match.whiteAgent.name} v{match.whiteAgent.version}
                      </div>
                      <div className="text-gray-400 text-xs">vs</div>
                      <div className="text-white font-semibold truncate">
                        {match.blackAgent.name} v{match.blackAgent.version}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <span className="text-yellow-400">
                        <Zap className="w-3 h-3 inline" /> {match.whiteAgent.eloRating}
                      </span>
                      <span className="text-gray-500">vs</span>
                      <span className="text-yellow-400">
                        <Zap className="w-3 h-3 inline" /> {match.blackAgent.eloRating}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Navigation arrows for switching games */}
          {liveMatches.length > 1 && !showGamesList && (
            <div className="flex items-center justify-center gap-4 mb-4">
              <button
                onClick={() => handleMatchChange(selectedMatchIndex - 1)}
                disabled={selectedMatchIndex === 0}
                className="bg-gray-700/50 backdrop-blur hover:bg-gray-600/50 disabled:opacity-30 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-all shadow-lg flex items-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <span className="text-gray-400">
                Game {selectedMatchIndex + 1} of {liveMatches.length}
              </span>
              <button
                onClick={() => handleMatchChange(selectedMatchIndex + 1)}
                disabled={selectedMatchIndex >= liveMatches.length - 1}
                className="bg-gray-700/50 backdrop-blur hover:bg-gray-600/50 disabled:opacity-30 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-all shadow-lg flex items-center gap-2"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Board centered */}
        <div className="flex-1 flex items-center justify-center px-4 pb-8">
          {liveMatches.length === 0 && !isConnecting ? (
            <div className="backdrop-blur-sm bg-gray-900/30 p-8 rounded-2xl border border-purple-500/20 shadow-2xl text-center">
              <Activity className="w-16 h-16 text-purple-400 mx-auto mb-4 opacity-50" />
              <p className="text-gray-400 text-lg mb-2">No live games at the moment</p>
              <p className="text-sm text-gray-500">Matches run continuously throughout the day</p>
            </div>
          ) : (
            <div className="backdrop-blur-sm bg-gray-900/30 p-8 rounded-2xl border border-purple-500/20 shadow-2xl">
              {renderBoard()}

              {/* Match Info */}
              {currentMatch && (
                <div className="mt-6 text-center space-y-4">
                  {/* Move Counter or Waiting Message */}
                  {allGameStates.length === 0 && !isConnecting ? (
                    <div className="bg-yellow-900/30 backdrop-blur border border-yellow-500/30 rounded-xl p-4 inline-block">
                      <div className="text-xs text-yellow-300 uppercase font-semibold mb-1">Status</div>
                      <div className="text-lg font-bold text-yellow-200">
                        Waiting for game to start...
                      </div>
                      <div className="text-xs text-gray-400 mt-2 flex items-center justify-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Match is being prepared
                      </div>
                    </div>
                  ) : (
                    <div className="bg-purple-900/30 backdrop-blur border border-purple-500/30 rounded-xl p-4 inline-block">
                      <div className="text-xs text-purple-300 uppercase font-semibold mb-1">Live Move</div>
                      <div className="text-4xl font-bold text-white">
                        {allGameStates.length > 0 ? allGameStates.length : currentMatch.currentMove}
                      </div>
                      {currentState?.move_notation && (
                        <div className="text-sm text-purple-300 mt-2">
                          <span className="font-semibold">{currentState.move_notation}</span>
                        </div>
                      )}
                      {currentState?.move_time_ms !== undefined && (
                        <div className={`text-xs mt-1 ${currentState.move_time_ms === null ? 'text-red-400' : 'text-gray-400'}`}>
                          {currentState.move_time_ms === null ? 'Timeout' : `${currentState.move_time_ms}ms`}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-center items-center gap-4">
                    <div className="text-right">
                      <div className="text-white font-semibold">{currentMatch.whiteAgent.name}</div>
                      <div className="text-xs text-gray-400">v{currentMatch.whiteAgent.version}</div>
                      <div className="text-xs text-yellow-400">
                        <Zap className="w-3 h-3 inline" /> {currentMatch.whiteAgent.eloRating}
                      </div>
                    </div>
                    <div className="bg-purple-600/50 backdrop-blur px-4 py-2 rounded-lg border border-purple-400/50">
                      <span className="text-white font-bold">VS</span>
                    </div>
                    <div className="text-left">
                      <div className="text-white font-semibold">{currentMatch.blackAgent.name}</div>
                      <div className="text-xs text-gray-400">v{currentMatch.blackAgent.version}</div>
                      <div className="text-xs text-yellow-400">
                        <Zap className="w-3 h-3 inline" /> {currentMatch.blackAgent.eloRating}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
