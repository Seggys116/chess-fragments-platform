'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import AnimatedBackground from '@/components/AnimatedBackground';
import { Trophy, Zap, Clock, ArrowLeft, Play, Pause, SkipBack, SkipForward, FastForward, Award, Timer, Activity } from 'lucide-react';

interface BoardState {
  pieces: Piece[];
}

interface Piece {
  type: string;
  player: string;
  x: number;
  y: number;
}

interface GameState {
  moveNumber: number;
  boardState: BoardState;
  evaluation: number | null;
  moveTimeMs: number | null;
  moveNotation: string | null;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
  version: number;
  eloRating: number;
  avgMoveTimeMs: number | null;
}

interface Match {
  id: string;
  whiteAgent: Agent;
  blackAgent: Agent;
  status: string;
  winner: string | null;
  termination: string | null;
  matchType: string;
  createdAt: string;
  completedAt: string | null;
  spectatorCount: number;
  gameStates: GameState[];
}

export default function MatchViewerPage() {
  const params = useParams();
  const matchId = params.id as string;

  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1500);

  const playbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchMatchData();
    return () => {
      if (playbackTimerRef.current) {
        clearTimeout(playbackTimerRef.current);
      }
    };
  }, [matchId]);

  useEffect(() => {
    if (isPlaying && match && currentMoveIndex < match.gameStates.length - 1) {
      playbackTimerRef.current = setTimeout(() => {
        setCurrentMoveIndex(prev => {
          const next = prev + 1;
          if (next >= match.gameStates.length - 1) {
            setIsPlaying(false);
          }
          return next;
        });
      }, playbackSpeed);

      return () => {
        if (playbackTimerRef.current) {
          clearTimeout(playbackTimerRef.current);
        }
      };
    }
  }, [isPlaying, currentMoveIndex, match, playbackSpeed]);

  const fetchMatchData = async () => {
    try {
      const response = await fetch(`/api/matches/${matchId}`);

      if (!response.ok) {
        throw new Error('Failed to fetch match data');
      }

      const data = await response.json();
      setMatch(data.match);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleStepForward = () => {
    if (match && currentMoveIndex < match.gameStates.length - 1) {
      setIsPlaying(false);
      setCurrentMoveIndex(currentMoveIndex + 1);
    }
  };

  const handleStepBackward = () => {
    if (currentMoveIndex > 0) {
      setIsPlaying(false);
      setCurrentMoveIndex(currentMoveIndex - 1);
    }
  };

  const handleJumpToMove = (index: number) => {
    setIsPlaying(false);
    setCurrentMoveIndex(index);
  };

  const handleJumpToStart = () => {
    setIsPlaying(false);
    setCurrentMoveIndex(0);
  };

  const handleJumpToEnd = () => {
    if (match) {
      setIsPlaying(false);
      setCurrentMoveIndex(match.gameStates.length - 1);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen relative">
        <AnimatedBackground />
        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="text-center text-gray-400 py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
            Loading match replay...
          </div>
        </div>
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="min-h-screen relative">
        <AnimatedBackground />
        <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
          <div className="bg-gray-900/95 backdrop-blur border border-red-500/30 rounded-xl p-8 max-w-md w-full text-center shadow-2xl">
            <h1 className="text-2xl font-bold text-white mb-4">Match Not Found</h1>
            <p className="text-gray-400 mb-6">{error || 'This match does not exist.'}</p>
            <Link
              href="/dashboard"
              className="inline-block bg-purple-600/80 backdrop-blur hover:bg-purple-700/80 text-white px-6 py-3 rounded-lg font-semibold transition-all shadow-lg shadow-purple-500/20"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentState = match.gameStates[currentMoveIndex];

  return (
    <div className="min-h-screen relative">
      <AnimatedBackground />
      <div className="relative z-10">
        <Navigation />
        <div className="container mx-auto py-6 max-w-7xl px-4">
          {/* Header */}
          <div className="mb-6 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Trophy className="w-8 h-8 text-purple-400" />
              <div>
                <h1 className="text-3xl font-bold text-white flex items-center gap-2">
                  {match.matchType === 'exhibition' ? 'Exhibition Match' : 'Ranked Battle'}
                  <span className={`px-3 py-1 rounded-full text-sm ${
                    match.status === 'completed' ? 'bg-gray-700/50 text-gray-300 border border-gray-600/30' : 'bg-green-900/50 text-green-300 border border-green-500/30 animate-pulse'
                  }`}>
                    {match.status === 'completed' ? 'Completed' : 'In Progress'}
                  </span>
                </h1>
                <p className="text-gray-400 text-sm">
                  {new Date(match.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard"
              className="bg-gray-700/50 backdrop-blur hover:bg-gray-600/50 text-white px-6 py-3 rounded-lg font-semibold transition-all shadow-lg flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Player Info & Match Details */}
            <div className="flex flex-col gap-4">
              {/* White Player */}
              <div className={`bg-gray-900/50 backdrop-blur border rounded-xl p-4 transition-all ${
                match.winner === 'white'
                  ? 'border-yellow-500 shadow-lg shadow-yellow-500/20'
                  : 'border-purple-500/20'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gray-100 to-gray-300 shadow-lg" />
                    <span className="text-sm text-gray-400 uppercase font-semibold">White</span>
                  </div>
                  {match.winner === 'white' && (
                    <span className="px-3 py-1 bg-yellow-600/50 text-yellow-300 rounded-full text-xs font-bold border border-yellow-500/30 flex items-center gap-1">
                      <Award className="w-3 h-3" />
                      WINNER
                    </span>
                  )}
                </div>
                <div className="text-xl font-bold text-white mb-1">
                  {match.whiteAgent.name} <span className="text-purple-400 text-sm">v{match.whiteAgent.version}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-yellow-400 flex items-center gap-1">
                    <Zap className="w-4 h-4" />
                    {match.whiteAgent.eloRating} ELO
                  </span>
                  {match.whiteAgent.avgMoveTimeMs !== null && (
                    <span className="text-gray-400 flex items-center gap-1">
                      <Timer className="w-3 h-3" />
                      {match.whiteAgent.avgMoveTimeMs}ms avg
                    </span>
                  )}
                </div>
              </div>

              {/* VS Badge */}
              <div className="flex justify-center -my-2">
                <div className="bg-purple-600/50 backdrop-blur px-6 py-2 rounded-full border border-purple-400/50 shadow-lg shadow-purple-500/20">
                  <span className="text-white font-bold text-lg">VS</span>
                </div>
              </div>

              {/* Black Player */}
              <div className={`bg-gray-900/50 backdrop-blur border rounded-xl p-4 transition-all ${
                match.winner === 'black'
                  ? 'border-yellow-500 shadow-lg shadow-yellow-500/20'
                  : 'border-purple-500/20'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gray-800 to-gray-950 border-2 border-white shadow-lg" />
                    <span className="text-sm text-gray-400 uppercase font-semibold">Black</span>
                  </div>
                  {match.winner === 'black' && (
                    <span className="px-3 py-1 bg-yellow-600/50 text-yellow-300 rounded-full text-xs font-bold border border-yellow-500/30 flex items-center gap-1">
                      <Award className="w-3 h-3" />
                      WINNER
                    </span>
                  )}
                </div>
                <div className="text-xl font-bold text-white mb-1">
                  {match.blackAgent.name} <span className="text-purple-400 text-sm">v{match.blackAgent.version}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-yellow-400 flex items-center gap-1">
                    <Zap className="w-4 h-4" />
                    {match.blackAgent.eloRating} ELO
                  </span>
                  {match.blackAgent.avgMoveTimeMs !== null && (
                    <span className="text-gray-400 flex items-center gap-1">
                      <Timer className="w-3 h-3" />
                      {match.blackAgent.avgMoveTimeMs}ms avg
                    </span>
                  )}
                </div>
              </div>

              {/* Match Info */}
              <div className="bg-gray-900/50 backdrop-blur border border-purple-500/20 rounded-xl p-4 shadow-lg">
                <div className="text-sm font-bold text-purple-400 mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Match Statistics
                </div>
                <div className="space-y-2 text-sm">
                  {match.completedAt && (
                    <div className="flex justify-between p-2 bg-gray-800/50 rounded">
                      <span className="text-gray-400">Duration:</span>
                      <span className="text-white font-semibold">
                        {Math.floor((new Date(match.completedAt).getTime() - new Date(match.createdAt).getTime()) / 1000 / 60)} min
                      </span>
                    </div>
                  )}
                  {match.termination && (
                    <div className="flex justify-between p-2 bg-gray-800/50 rounded">
                      <span className="text-gray-400">Result:</span>
                      <span className="text-white font-semibold capitalize">{match.termination.replace(/_/g, ' ')}</span>
                    </div>
                  )}
                  <div className="flex justify-between p-2 bg-gray-800/50 rounded">
                    <span className="text-gray-400">Total Moves:</span>
                    <span className="text-white font-semibold">{match.gameStates.length}</span>
                  </div>
                  <div className="flex justify-between p-2 bg-purple-900/20 rounded border border-purple-500/30">
                    <span className="text-purple-300">Match Type:</span>
                    <span className="text-white font-semibold capitalize">{match.matchType}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Center & Right Columns - Chess Board & Controls */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              {/* Chess Board */}
              {currentState && (
                <div className="bg-gray-900/50 backdrop-blur border border-purple-500/20 rounded-xl p-6 shadow-lg shadow-purple-500/10">
                  <ChessBoard boardState={currentState.boardState} />
                </div>
              )}

              {/* Current Move Info */}
              {currentState && (
                <div className="bg-gray-900/50 backdrop-blur border border-purple-500/20 rounded-xl p-4 shadow-lg">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                      <div className="text-gray-400 text-xs mb-1">Move</div>
                      <div className="font-bold text-white text-lg">{currentState.moveNumber + 1}</div>
                    </div>
                    {currentState.moveNotation && (
                      <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                        <div className="text-gray-400 text-xs mb-1">Notation</div>
                        <div className="font-bold text-purple-400 text-lg">{currentState.moveNotation}</div>
                      </div>
                    )}
                    {currentState.evaluation !== null && currentState.evaluation !== undefined && (
                      <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                        <div className="text-gray-400 text-xs mb-1">Evaluation</div>
                        <div className={`font-bold text-lg ${
                          currentState.evaluation > 0 ? 'text-green-400' :
                          currentState.evaluation < 0 ? 'text-red-400' : 'text-gray-400'
                        }`}>
                          {currentState.evaluation > 0 ? '+' : ''}{currentState.evaluation.toFixed(2)}
                        </div>
                      </div>
                    )}
                    <div className="bg-gray-800/50 rounded-lg p-3 text-center">
                      <div className="text-gray-400 text-xs mb-1 flex items-center justify-center gap-1">
                        <Clock className="w-3 h-3" />
                        Time
                      </div>
                      <div className={`font-bold text-lg ${currentState.moveTimeMs === null ? 'text-red-400' : 'text-blue-400'}`}>
                        {currentState.moveTimeMs === null ? 'Timeout' : `${currentState.moveTimeMs}ms`}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Playback Controls */}
              <div className="bg-gray-900/50 backdrop-blur border border-purple-500/20 rounded-xl p-4 shadow-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleJumpToStart}
                      disabled={currentMoveIndex === 0}
                      className="bg-gray-700/50 backdrop-blur hover:bg-gray-600/50 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-2 rounded-lg transition-all shadow-lg"
                      title="Jump to start"
                    >
                      <SkipBack className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleStepBackward}
                      disabled={currentMoveIndex === 0}
                      className="bg-gray-700/50 backdrop-blur hover:bg-gray-600/50 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-2 rounded-lg transition-all shadow-lg"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M12.7 14.3l-4.6-4.6 4.6-4.6L11 3.4 4.4 10l6.6 6.6z"/>
                      </svg>
                    </button>
                    <button
                      onClick={handlePlayPause}
                      disabled={match.gameStates.length === 0}
                      className="bg-purple-600/80 backdrop-blur hover:bg-purple-700/80 disabled:opacity-30 px-6 py-2 rounded-lg font-bold transition-all shadow-lg shadow-purple-500/20 flex items-center gap-2"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-4 h-4" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          Play
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleStepForward}
                      disabled={currentMoveIndex >= match.gameStates.length - 1}
                      className="bg-gray-700/50 backdrop-blur hover:bg-gray-600/50 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-2 rounded-lg transition-all shadow-lg"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M7.3 14.3l4.6-4.6-4.6-4.6L9 3.4 15.6 10 9 16.6z"/>
                      </svg>
                    </button>
                    <button
                      onClick={handleJumpToEnd}
                      disabled={currentMoveIndex >= match.gameStates.length - 1}
                      className="bg-gray-700/50 backdrop-blur hover:bg-gray-600/50 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-2 rounded-lg transition-all shadow-lg"
                      title="Jump to end"
                    >
                      <SkipForward className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <FastForward className="w-4 h-4 text-gray-400" />
                    <select
                      value={playbackSpeed}
                      onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                      className="bg-gray-700/50 backdrop-blur text-white px-3 py-2 rounded-lg text-sm border border-purple-500/30 focus:border-purple-500 focus:outline-none transition-all"
                    >
                      <option value={500}>2.0x</option>
                      <option value={1000}>1.0x</option>
                      <option value={1500}>0.67x</option>
                      <option value={2000}>0.5x</option>
                    </select>
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, match.gameStates.length - 1)}
                  value={currentMoveIndex}
                  onChange={(e) => handleJumpToMove(Number(e.target.value))}
                  className="w-full h-2 bg-gray-700/50 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-2">
                  <span>Start</span>
                  <span className="text-purple-400 font-semibold">{currentMoveIndex + 1} / {match.gameStates.length}</span>
                  <span>End</span>
                </div>
              </div>

              {/* Move History */}
              <div className="bg-gray-900/50 backdrop-blur border border-purple-500/20 rounded-xl p-4 shadow-lg flex-1 flex flex-col min-h-0">
                <div className="text-sm font-bold text-purple-400 mb-3">Move History</div>
                <div className="flex-1 overflow-y-auto space-y-1 min-h-0 pr-2">
                  {match.gameStates.map((state, index) => (
                    <button
                      key={index}
                      onClick={() => handleJumpToMove(index)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                        index === currentMoveIndex
                          ? 'bg-purple-600/80 backdrop-blur text-white shadow-lg shadow-purple-500/20'
                          : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/50'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">{index + 1}. {state.moveNotation || 'N/A'}</span>
                        <div className="flex items-center gap-3">
                          {state.evaluation !== null && state.evaluation !== undefined && (
                            <span className={`text-xs ${
                              state.evaluation > 0 ? 'text-green-400' :
                              state.evaluation < 0 ? 'text-red-400' : 'text-gray-400'
                            }`}>
                              {state.evaluation > 0 ? '+' : ''}{state.evaluation.toFixed(2)}
                            </span>
                          )}
                          <span className={`text-xs flex items-center gap-1 ${state.moveTimeMs === null ? 'text-red-400' : 'text-gray-500'}`}>
                            <Clock className="w-3 h-3" />
                            {state.moveTimeMs === null ? 'Timeout' : `${state.moveTimeMs}ms`}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ChessBoardProps {
  boardState: BoardState;
}

function ChessBoard({ boardState }: ChessBoardProps) {
  const parseBoardState = (state: BoardState): (Piece | null)[][] => {
    const grid: (Piece | null)[][] = Array(5).fill(null).map(() => Array(5).fill(null));
    if (!state || !state.pieces) return grid;
    state.pieces.forEach((piece: Piece) => {
      if (piece.y >= 0 && piece.y < 5 && piece.x >= 0 && piece.x < 5) {
        grid[piece.y][piece.x] = piece;
      }
    });
    return grid;
  };

  const renderPiece = (piece: Piece) => {
    const pieceName = piece.type.toLowerCase();
    const color = piece.player.toLowerCase();
    return (
      <img
        src={`/pieces/${color}_${pieceName}.svg`}
        alt={`${color} ${pieceName}`}
        width={60}
        height={60}
        className="transition-all duration-200 drop-shadow-lg"
      />
    );
  };

  const board = parseBoardState(boardState);

  return (
    <div className="flex items-center justify-center">
      <div>
        {/* File coordinates (top) */}
        <div className="flex mb-2 ml-8">
          {['a', 'b', 'c', 'd', 'e'].map(file => (
            <div key={file} className="w-20 text-center text-gray-500 text-sm font-semibold">
              {file}
            </div>
          ))}
        </div>

        <div className="flex">
          {/* Rank coordinates (left) */}
          <div className="flex flex-col mr-2">
            {['5', '4', '3', '2', '1'].map(rank => (
              <div key={rank} className="h-20 flex items-center justify-center text-gray-500 text-sm font-semibold w-6">
                {rank}
              </div>
            ))}
          </div>

          {/* Chess board */}
          <div className="inline-block bg-gray-900 p-2 rounded-lg border-2 border-purple-500/50">
            {board.map((row, y) => (
              <div key={y} className="flex">
                {row.map((piece, x) => {
                  const isLight = (x + y) % 2 === 0;
                  return (
                    <div
                      key={`${x}-${y}`}
                      className={`w-20 h-20 flex items-center justify-center transition-all ${
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

          {/* Rank coordinates (right) */}
          <div className="flex flex-col ml-2">
            {['5', '4', '3', '2', '1'].map(rank => (
              <div key={rank} className="h-20 flex items-center justify-center text-gray-500 text-sm font-semibold w-6">
                {rank}
              </div>
            ))}
          </div>
        </div>

        {/* File coordinates (bottom) */}
        <div className="flex mt-2 ml-8">
          {['a', 'b', 'c', 'd', 'e'].map(file => (
            <div key={file} className="w-20 text-center text-gray-500 text-sm font-semibold">
              {file}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
