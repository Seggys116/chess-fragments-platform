'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import AnimatedBackground from '@/components/AnimatedBackground';
import { Trophy, Zap, Clock, Target, Activity, TrendingUp, Shield, ChartBar, Eye, ArrowLeft, Sword, Timer } from 'lucide-react';
import { authenticatedFetch } from '@/lib/clientAuth';

interface VersionHistory {
  id: string;
  version: number;
  active: boolean;
  createdAt: string;
  ranking: {
    eloRating: number;
    gamesPlayed: number;
    wins: number;
    losses: number;
  } | null;
}

interface Analytics {
  agent: {
    id: string;
    name: string;
    version: number;
    ranking: {
      eloRating: number;
      gamesPlayed: number;
      wins: number;
      losses: number;
      draws: number;
    } | null;
  };
  moveTimeStats: {
    min: number | null;
    max: number | null;
    avg: number | null;
    stdDev: number | null;
    count: number;
    timeoutCount: number;
    timeoutPercentage: number;
  };
  evaluationStats: {
    min: number | null;
    max: number | null;
    avg: number | null;
    stdDev: number | null;
    count: number;
  };
  gameStats: {
    quickestWin: number | null;
    longestGame: number | null;
    avgGameLength: number | null;
    quickestLoss: number | null;
  };
  extremeMoves: {
    bestMoveEval: number | null;
    worstMoveEval: number | null;
    bestMoveMatchId: string | null;
    worstMoveMatchId: string | null;
  };
  performanceOverTime: Array<{
    matchNumber: number;
    result: string;
    opponent: string;
    date: string;
    avgMoveTime: number;
  }>;
  headToHead: Array<{
    opponentId: string;
    opponentName: string;
    wins: number;
    losses: number;
    draws: number;
    total: number;
  }>;
  totalMatches: number;
  versionHistory: VersionHistory[];
}

interface Match {
  id: string;
  matchType: string;
  status: string;
  result: string;
  color: string;
  opponent: {
    name: string;
    version: number;
    eloRating: number | null;
  };
  moves: number;
  termination: string | null;
  createdAt: string;
  completedAt: string | null;
}

export default function AgentAnalyticsPage() {
  const params = useParams();
  const agentId = params.id as string;

  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Use authenticatedFetch which handles token refresh automatically
    Promise.all([
      authenticatedFetch(`/api/agents/${agentId}/analytics`).then(r => r.json()),
      authenticatedFetch(`/api/agents/${agentId}/matches?limit=20`).then(r => r.json()),
    ])
      .then(([analyticsData, matchesData]) => {
        if (analyticsData.error) throw new Error(analyticsData.error);
        if (matchesData.error) throw new Error(matchesData.error);

        setAnalytics(analyticsData);
        setMatches(matchesData.matches);
        setError('');
      })
      .catch(err => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [agentId]);

  if (loading) {
    return (
      <div className="min-h-screen relative">
        <AnimatedBackground />
        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="text-center text-gray-400 py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
            Loading analytics...
          </div>
        </div>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="min-h-screen relative">
        <AnimatedBackground />
        <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
          <div className="bg-gray-900/95 backdrop-blur border border-red-500/30 rounded-xl p-8 max-w-md w-full text-center shadow-2xl">
            <h1 className="text-2xl font-bold text-white mb-4">Error</h1>
            <p className="text-gray-400 mb-6">{error || 'Failed to load analytics'}</p>
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

  const { agent, moveTimeStats, gameStats, extremeMoves, performanceOverTime, headToHead, versionHistory } = analytics;

  return (
    <div className="min-h-screen relative">
      <AnimatedBackground />
      <div className="relative z-10">
        <Navigation />
        <div className="container mx-auto py-8 max-w-7xl px-4">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Shield className="w-10 h-10 text-purple-400" />
                <div>
                  <h1 className="text-4xl font-bold text-white">
                    {agent.name} <span className="text-purple-400 text-2xl">v{agent.version}</span>
                  </h1>
                  <p className="text-gray-400">Deep Analytics & Performance Metrics</p>
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
          </div>

          {/* Overall Stats */}
          {agent.ranking && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              <div className="bg-gradient-to-br from-yellow-900/30 to-yellow-800/30 backdrop-blur rounded-xl p-4 border border-yellow-500/20 shadow-lg shadow-yellow-500/10">
                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  ELO Rating
                </div>
                <div className="text-3xl font-bold text-yellow-400">{agent.ranking.eloRating}</div>
              </div>
              <div className="bg-gradient-to-br from-gray-800/50 to-gray-700/50 backdrop-blur rounded-xl p-4 border border-gray-600/20 shadow-lg">
                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  Games
                </div>
                <div className="text-3xl font-bold text-white">{agent.ranking.gamesPlayed}</div>
              </div>
              <div className="bg-gradient-to-br from-green-900/30 to-green-800/30 backdrop-blur rounded-xl p-4 border border-green-500/20 shadow-lg shadow-green-500/10">
                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Wins
                </div>
                <div className="text-3xl font-bold text-green-400">{agent.ranking.wins}</div>
              </div>
              <div className="bg-gradient-to-br from-red-900/30 to-red-800/30 backdrop-blur rounded-xl p-4 border border-red-500/20 shadow-lg shadow-red-500/10">
                <div className="text-gray-400 text-xs mb-1">Losses</div>
                <div className="text-3xl font-bold text-red-400">{agent.ranking.losses}</div>
              </div>
              <div className="bg-gradient-to-br from-blue-900/30 to-blue-800/30 backdrop-blur rounded-xl p-4 border border-blue-500/20 shadow-lg shadow-blue-500/10">
                <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  Win Rate
                </div>
                <div className="text-3xl font-bold text-blue-400">
                  {agent.ranking.gamesPlayed > 0
                    ? ((agent.ranking.wins / agent.ranking.gamesPlayed) * 100).toFixed(1)
                    : 0}%
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Move Time Statistics */}
            <div className="bg-gray-900/50 backdrop-blur border border-purple-500/20 rounded-xl p-6 shadow-lg shadow-purple-500/10">
              <div className="flex items-center gap-2 mb-4">
                <Timer className="w-6 h-6 text-purple-400" />
                <h2 className="text-2xl font-bold text-white">Move Time Analysis</h2>
              </div>
              {moveTimeStats.count > 0 ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                    <span className="text-gray-400">Fastest Move:</span>
                    <span className="text-green-400 font-bold">{moveTimeStats.min !== null ? `${moveTimeStats.min}ms` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                    <span className="text-gray-400">Slowest Move:</span>
                    <span className="text-red-400 font-bold">{moveTimeStats.max !== null ? `${moveTimeStats.max}ms` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                    <span className="text-gray-400">Average Time:</span>
                    <span className="text-purple-400 font-bold">{moveTimeStats.avg !== null ? `${moveTimeStats.avg}ms` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                    <span className="text-gray-400">Std Deviation:</span>
                    <span className="text-blue-400 font-bold">{moveTimeStats.stdDev !== null ? `${moveTimeStats.stdDev}ms` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                    <span className="text-gray-400">Timeout Rate:</span>
                    <span className={`font-bold ${moveTimeStats.timeoutPercentage > 10 ? 'text-red-400' : moveTimeStats.timeoutPercentage > 5 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {moveTimeStats.timeoutPercentage.toFixed(2)}% ({moveTimeStats.timeoutCount} timeouts)
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-purple-900/20 rounded-lg border border-purple-500/30">
                    <span className="text-purple-300">Total Moves Analyzed:</span>
                    <span className="text-white font-bold">{moveTimeStats.count}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Clock className="w-12 h-12 text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-500">No move data available yet</p>
                </div>
              )}
            </div>

            {/* Game Statistics */}
            <div className="bg-gray-900/50 backdrop-blur border border-purple-500/20 rounded-xl p-6 shadow-lg shadow-purple-500/10">
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="w-6 h-6 text-purple-400" />
                <h2 className="text-2xl font-bold text-white">Game Statistics</h2>
              </div>
              {gameStats && (gameStats.quickestWin !== null || gameStats.longestGame !== null) ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                    <span className="text-gray-400">Quickest Win:</span>
                    <span className="text-green-400 font-bold">{gameStats.quickestWin !== null ? `${gameStats.quickestWin} moves` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                    <span className="text-gray-400">Quickest Loss:</span>
                    <span className="text-red-400 font-bold">{gameStats.quickestLoss !== null ? `${gameStats.quickestLoss} moves` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                    <span className="text-gray-400">Longest Game:</span>
                    <span className="text-blue-400 font-bold">{gameStats.longestGame !== null ? `${gameStats.longestGame} moves` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                    <span className="text-gray-400">Average Game Length:</span>
                    <span className="text-purple-400 font-bold">{gameStats.avgGameLength !== null ? `${gameStats.avgGameLength} moves` : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                    <span className="text-gray-400">Best Position:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 font-bold">{extremeMoves.bestMoveEval !== null ? `+${extremeMoves.bestMoveEval}` : 'N/A'}</span>
                      {extremeMoves.bestMoveMatchId && (
                        <a href={`/match/${extremeMoves.bestMoveMatchId}`} className="text-purple-400 hover:text-purple-300 text-xs underline">
                          View
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                    <span className="text-gray-400">Worst Position:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-red-400 font-bold">{extremeMoves.worstMoveEval !== null ? extremeMoves.worstMoveEval : 'N/A'}</span>
                      {extremeMoves.worstMoveMatchId && (
                        <a href={`/match/${extremeMoves.worstMoveMatchId}`} className="text-purple-400 hover:text-purple-300 text-xs underline">
                          View
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Trophy className="w-12 h-12 text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-500">No game data available yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Version History */}
          {versionHistory && versionHistory.length > 1 && (
            <div className="bg-gray-900/50 backdrop-blur border border-purple-500/20 rounded-xl p-6 mb-8 shadow-lg shadow-purple-500/10">
              <div className="flex items-center gap-2 mb-6">
                <Shield className="w-6 h-6 text-purple-400" />
                <h2 className="text-2xl font-bold text-white">Version History</h2>
                <span className="text-sm text-gray-400">({versionHistory.length} versions)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-900/50">
                    <tr>
                      <th className="px-4 py-4 text-left text-sm font-semibold text-purple-400">Version</th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-purple-400">Status</th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-purple-400">Created</th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-purple-400">ELO</th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-purple-400">Games</th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-purple-400">Win Rate</th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-purple-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-500/10">
                    {versionHistory.map(version => (
                      <tr key={version.id} className={`hover:bg-purple-900/20 transition-all duration-200 ${version.id === agent.id ? 'bg-purple-900/10' : ''}`}>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <span className={`text-lg font-bold ${version.id === agent.id ? 'text-purple-400' : 'text-white'}`}>
                              v{version.version}
                            </span>
                            {version.id === agent.id && (
                              <span className="px-2 py-1 bg-purple-900/50 text-purple-300 text-xs rounded-full border border-purple-500/30">
                                Current
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold ${
                              version.active
                                ? 'bg-green-900/50 text-green-300 border border-green-500/30'
                                : 'bg-gray-800/50 text-gray-400 border border-gray-600/30'
                            }`}
                          >
                            {version.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center text-gray-300 text-sm">
                          {new Date(version.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className={`font-bold ${
                            version.ranking
                              ? version.ranking.eloRating >= 1600 ? 'text-yellow-400' :
                                version.ranking.eloRating >= 1400 ? 'text-green-400' :
                                'text-gray-400'
                              : 'text-gray-600'
                          }`}>
                            {version.ranking ? version.ranking.eloRating : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center text-white font-semibold">
                          {version.ranking ? version.ranking.gamesPlayed : 0}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {version.ranking && version.ranking.gamesPlayed > 0 ? (
                            <span className={`font-semibold ${
                              ((version.ranking.wins / version.ranking.gamesPlayed) * 100) >= 60 ? 'text-green-400' :
                              ((version.ranking.wins / version.ranking.gamesPlayed) * 100) >= 40 ? 'text-yellow-400' :
                              'text-red-400'
                            }`}>
                              {((version.ranking.wins / version.ranking.gamesPlayed) * 100).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-gray-600">-</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {version.id !== agent.id && (
                            <Link
                              href={`/agent/${version.id}`}
                              className="text-purple-400 hover:text-purple-300 text-sm underline"
                            >
                              View
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Head to Head Records */}
          {headToHead.length > 0 && (
            <div className="bg-gray-900/50 backdrop-blur border border-purple-500/20 rounded-xl p-6 mb-8 shadow-lg shadow-purple-500/10">
              <div className="flex items-center gap-2 mb-6">
                <Sword className="w-6 h-6 text-purple-400" />
                <h2 className="text-2xl font-bold text-white">Head-to-Head Records</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-900/50">
                    <tr>
                      <th className="px-4 py-4 text-left text-sm font-semibold text-purple-400">Opponent</th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-purple-400">Wins</th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-purple-400">Losses</th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-purple-400">Draws</th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-purple-400">Total</th>
                      <th className="px-4 py-4 text-center text-sm font-semibold text-purple-400">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-500/10">
                    {headToHead.map(record => (
                      <tr key={record.opponentId} className="hover:bg-purple-900/20 transition-all duration-200">
                        <td className="px-4 py-4 text-white font-semibold">{record.opponentName}</td>
                        <td className="px-4 py-4 text-center">
                          <span className="px-3 py-1 bg-green-900/50 text-green-300 rounded-full text-sm font-bold border border-green-500/30">
                            {record.wins}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className="px-3 py-1 bg-red-900/50 text-red-300 rounded-full text-sm font-bold border border-red-500/30">
                            {record.losses}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className="px-3 py-1 bg-gray-800/50 text-gray-300 rounded-full text-sm font-bold border border-gray-600/30">
                            {record.draws}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center text-white font-bold">{record.total}</td>
                        <td className="px-4 py-4 text-center">
                          <span className="px-3 py-1 bg-blue-900/50 text-blue-300 rounded-full text-sm font-bold border border-blue-500/30">
                            {record.total > 0
                              ? ((record.wins / record.total) * 100).toFixed(1)
                              : 0}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Match History */}
          <div className="bg-gray-900/50 backdrop-blur border border-purple-500/20 rounded-xl p-6 shadow-lg shadow-purple-500/10">
            <div className="flex items-center gap-2 mb-6">
              <Trophy className="w-6 h-6 text-purple-400" />
              <h2 className="text-2xl font-bold text-white">Recent Battle History</h2>
            </div>
            {matches.length > 0 ? (
              <div className="space-y-3">
                {matches.map(match => (
                  <Link
                    key={match.id}
                    href={`/match/${match.id}`}
                    className="block bg-gray-800/50 backdrop-blur hover:bg-gray-700/50 border border-purple-500/20 rounded-xl p-4 transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/10"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-4">
                        <div className={`px-4 py-2 rounded-lg font-bold text-sm border ${
                          match.result === 'win' ? 'bg-green-900/50 text-green-300 border-green-500/30' :
                          match.result === 'loss' ? 'bg-red-900/50 text-red-300 border-red-500/30' :
                          match.result === 'draw' || match.result === 'stalemate' ||
                          match.result === 'insufficient_material' || match.result === 'max_moves' ?
                          'bg-gray-800/50 text-gray-300 border-gray-600/30' :
                          'bg-blue-900/50 text-blue-300 border-blue-500/30'
                        }`}>
                          {match.result.toUpperCase().replace(/_/g, ' ')}
                        </div>
                        <div>
                          <div className="text-white font-semibold flex items-center gap-2">
                            <span>vs {match.opponent.name} v{match.opponent.version}</span>
                            {match.opponent.eloRating && (
                              <span className="text-yellow-400 text-xs">
                                <Zap className="w-3 h-3 inline" /> {match.opponent.eloRating}
                              </span>
                            )}
                          </div>
                          <div className="text-gray-400 text-sm flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              match.color === 'white' ? 'bg-gray-300 text-gray-900' : 'bg-gray-900 text-gray-300'
                            }`}>
                              {match.color === 'white' ? 'White' : 'Black'}
                            </span>
                            <span>•</span>
                            <span>{match.moves} moves</span>
                            <span>•</span>
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              match.matchType === 'exhibition' ? 'bg-purple-900/50 text-purple-300' : 'bg-blue-900/50 text-blue-300'
                            }`}>
                              {match.matchType === 'exhibition' ? 'Exhibition' : 'Ranked'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-gray-400 text-sm">
                          {new Date(match.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(match.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Trophy className="w-12 h-12 text-gray-600 mx-auto mb-2" />
                <p className="text-gray-500">No matches yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
