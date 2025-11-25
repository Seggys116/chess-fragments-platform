'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import AnimatedBackground from '@/components/AnimatedBackground';
import { Trophy, TrendingUp, TrendingDown, Clock, Target, Award } from 'lucide-react';

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  version: number;
  eloRating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winPercentage: string;
  lossPercentage: string;
  avgMoveTimeMs: number | null;
}

export default function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userAgentIds, setUserAgentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchLeaderboard();
    fetchUserAgents();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchLeaderboard, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchUserAgents = async () => {
    try {
      const response = await fetch('/api/dashboard/agents');
      if (response.ok) {
        const data = await response.json();
        setUserAgentIds(new Set(data.agents.map((a: { id: string }) => a.id)));
      }
    } catch {
      // Not authenticated or error - ignore silently
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch('/api/leaderboard?limit=50');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch leaderboard');
      }

      setLeaderboard(data.leaderboard);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Get medal icon for top 3
  const getMedalIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="w-6 h-6 text-yellow-400" />;
    if (rank === 2) return <Trophy className="w-6 h-6 text-gray-300" />;
    if (rank === 3) return <Trophy className="w-6 h-6 text-orange-600" />;
    return null;
  };

  return (
    <div className="min-h-screen relative">
      <AnimatedBackground />
      <div className="relative z-10">
        <Navigation />
        <div className="container mx-auto py-8 px-4">
          <div className="mb-6 sm:mb-8 text-center">
            <div className="inline-flex items-center gap-2 sm:gap-3 mb-4">
              <Trophy className="w-8 sm:w-10 h-8 sm:h-10 text-purple-400" />
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white">Global Leaderboard</h1>
              <Trophy className="w-8 sm:w-10 h-8 sm:h-10 text-purple-400" />
            </div>
            <p className="text-gray-400 text-base sm:text-lg">Top ranked chess AI agents competing for glory</p>
          </div>

          {!loading && leaderboard.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-8">
              <div className="bg-gray-800/50 backdrop-blur p-4 rounded-lg border border-purple-500/20 text-center">
                <div className="text-3xl font-bold text-purple-400">{leaderboard.length}</div>
                <div className="text-sm text-gray-400">Active Agents</div>
              </div>
              <div className="bg-gray-800/50 backdrop-blur p-4 rounded-lg border border-purple-500/20 text-center">
                <div className="text-3xl font-bold text-yellow-400">{leaderboard[0]?.eloRating || '-'}</div>
                <div className="text-sm text-gray-400">Highest ELO</div>
              </div>
              <div className="bg-gray-800/50 backdrop-blur p-4 rounded-lg border border-purple-500/20 text-center">
                <div className="text-3xl font-bold text-green-400">
                  {leaderboard.reduce((sum, e) => sum + e.gamesPlayed, 0)}
                </div>
                <div className="text-sm text-gray-400">Total Games</div>
              </div>
              <div className="bg-gray-800/50 backdrop-blur p-4 rounded-lg border border-purple-500/20 text-center">
                <div className="text-3xl font-bold text-blue-400">
                  {Math.round(leaderboard.reduce((sum, e) => sum + (e.avgMoveTimeMs || 0), 0) / leaderboard.filter(e => e.avgMoveTimeMs).length)}ms
                </div>
                <div className="text-sm text-gray-400">Avg Move Time</div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center text-gray-400 py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
              Loading leaderboard...
            </div>
          ) : error ? (
            <div className="bg-red-900/50 backdrop-blur border border-red-600 rounded-lg p-4">
              <p className="text-red-200">{error}</p>
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="bg-gray-800/50 backdrop-blur border border-purple-500/20 rounded-lg p-8 text-center">
              <p className="text-gray-400 mb-4">No agents yet. Be the first to upload!</p>
              <Link
                href="/upload"
                className="inline-block bg-purple-600/80 backdrop-blur hover:bg-purple-700/80 text-white px-6 py-3 rounded-lg font-semibold transition-all shadow-lg shadow-purple-500/20"
              >
                Upload Your Agent
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.length >= 3 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                  <div className="order-2 md:order-1">
                    <div className={`bg-gradient-to-br from-gray-700/50 to-gray-800/50 backdrop-blur rounded-lg border p-6 transform md:translate-y-4 hover:scale-105 transition-all duration-300 ${userAgentIds.has(leaderboard[1].agentId) ? 'border-purple-500 ring-2 ring-purple-500' : 'border-gray-500/30'}`}>
                      <div className="text-center mb-3">
                        <Trophy className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                        <div className="text-4xl font-bold text-gray-300">2nd</div>
                      </div>
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-white font-bold text-lg">{leaderboard[1].agentName}</span>
                          {userAgentIds.has(leaderboard[1].agentId) && (
                            <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full font-semibold">YOU</span>
                          )}
                        </div>
                        <div className="text-gray-400 text-sm">v{leaderboard[1].version}</div>
                        <div className="text-2xl font-bold text-gray-300 mt-2">{leaderboard[1].eloRating}</div>
                        <div className="text-xs text-gray-500">ELO Rating</div>
                        <div className="mt-2 text-sm">
                          <span className="text-green-400">{leaderboard[1].winPercentage}%</span> Win Rate
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="order-1 md:order-2">
                    <div className={`bg-gradient-to-br from-yellow-600/30 to-yellow-800/30 backdrop-blur rounded-lg border-2 p-6 transform hover:scale-105 transition-all duration-300 shadow-xl ${userAgentIds.has(leaderboard[0].agentId) ? 'border-purple-500 ring-2 ring-purple-500 shadow-purple-500/20' : 'border-yellow-500/50 shadow-yellow-500/20'}`}>
                      <div className="text-center mb-3">
                        <Trophy className="w-16 h-16 text-yellow-400 mx-auto mb-2" />
                        <div className="text-5xl font-bold text-yellow-400">1st</div>
                      </div>
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-white font-bold text-xl">{leaderboard[0].agentName}</span>
                          {userAgentIds.has(leaderboard[0].agentId) && (
                            <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full font-semibold">YOU</span>
                          )}
                        </div>
                        <div className="text-gray-400 text-sm">v{leaderboard[0].version}</div>
                        <div className="text-3xl font-bold text-yellow-400 mt-2">{leaderboard[0].eloRating}</div>
                        <div className="text-xs text-gray-500">ELO Rating</div>
                        <div className="mt-2 text-sm">
                          <span className="text-green-400">{leaderboard[0].winPercentage}%</span> Win Rate
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="order-3">
                    <div className={`bg-gradient-to-br from-orange-700/30 to-orange-900/30 backdrop-blur rounded-lg border p-6 transform md:translate-y-8 hover:scale-105 transition-all duration-300 ${userAgentIds.has(leaderboard[2].agentId) ? 'border-purple-500 ring-2 ring-purple-500' : 'border-orange-600/30'}`}>
                      <div className="text-center mb-3">
                        <Trophy className="w-10 h-10 text-orange-600 mx-auto mb-2" />
                        <div className="text-3xl font-bold text-orange-600">3rd</div>
                      </div>
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-white font-bold text-lg">{leaderboard[2].agentName}</span>
                          {userAgentIds.has(leaderboard[2].agentId) && (
                            <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full font-semibold">YOU</span>
                          )}
                        </div>
                        <div className="text-gray-400 text-sm">v{leaderboard[2].version}</div>
                        <div className="text-2xl font-bold text-orange-600 mt-2">{leaderboard[2].eloRating}</div>
                        <div className="text-xs text-gray-500">ELO Rating</div>
                        <div className="mt-2 text-sm">
                          <span className="text-green-400">{leaderboard[2].winPercentage}%</span> Win Rate
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-gray-800/50 backdrop-blur rounded-lg border border-purple-500/20 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-900/50">
                      <tr>
                        <th className="px-6 py-4 text-left text-sm font-semibold text-purple-400">Rank</th>
                        <th className="px-6 py-4 text-left text-sm font-semibold text-purple-400">Agent</th>
                        <th className="px-6 py-4 text-center text-sm font-semibold text-purple-400">ELO</th>
                        <th className="px-6 py-4 text-center text-sm font-semibold text-purple-400">Games</th>
                        <th className="px-6 py-4 text-center text-sm font-semibold text-purple-400">W/L/D</th>
                        <th className="px-6 py-4 text-center text-sm font-semibold text-purple-400">Win Rate</th>
                        <th className="px-6 py-4 text-center text-sm font-semibold text-purple-400">Avg Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-purple-500/10">
                      {leaderboard.map((entry, index) => (
                        <tr key={entry.agentId} className={`hover:bg-purple-900/20 transition-all duration-200 ${index < 3 ? 'bg-gradient-to-r from-transparent via-purple-900/10 to-transparent' : ''} ${userAgentIds.has(entry.agentId) ? 'ring-2 ring-purple-500 ring-inset bg-purple-900/30' : ''}`}>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              {getMedalIcon(entry.rank)}
                              <span className={`font-bold ${entry.rank <= 3 ? 'text-2xl' : 'text-lg'} text-white`}>
                                {entry.rank}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <Link href={`/agent/${entry.agentId}`} className="hover:text-purple-400 transition-colors">
                              <div className="flex items-center gap-2">
                                <span className="text-white font-medium">{entry.agentName}</span>
                                {userAgentIds.has(entry.agentId) && (
                                  <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full font-semibold">
                                    YOU
                                  </span>
                                )}
                              </div>
                              <div className="text-gray-500 text-sm">v{entry.version}</div>
                            </Link>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex flex-col items-center">
                              <span className={`text-2xl font-bold ${
                                entry.eloRating >= 1600 ? 'text-yellow-400' :
                                entry.eloRating >= 1400 ? 'text-green-400' :
                                'text-gray-400'
                              }`}>
                                {entry.eloRating}
                              </span>
                              {index > 0 && (
                                <span className={`text-xs ${
                                  entry.eloRating > leaderboard[index - 1].eloRating
                                    ? 'text-green-400'
                                    : 'text-red-400'
                                }`}>
                                  {entry.eloRating > leaderboard[index - 1].eloRating ? '↑' : '↓'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="text-white font-semibold">{entry.gamesPlayed}</div>
                            <div className="text-xs text-gray-500">matches</div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex justify-center gap-2">
                              <span className="bg-green-900/50 text-green-400 px-2 py-1 rounded text-sm font-semibold">{entry.wins}W</span>
                              <span className="bg-red-900/50 text-red-400 px-2 py-1 rounded text-sm font-semibold">{entry.losses}L</span>
                              <span className="bg-gray-700/50 text-gray-400 px-2 py-1 rounded text-sm font-semibold">{entry.draws}D</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-20 bg-gray-700 rounded-full h-2 overflow-hidden">
                                <div
                                  className={`h-full ${
                                    parseFloat(entry.winPercentage) >= 60 ? 'bg-green-400' :
                                    parseFloat(entry.winPercentage) >= 40 ? 'bg-yellow-400' :
                                    'bg-red-400'
                                  }`}
                                  style={{ width: `${entry.winPercentage}%` }}
                                />
                              </div>
                              <span className={`font-semibold ${
                                parseFloat(entry.winPercentage) >= 60 ? 'text-green-400' :
                                parseFloat(entry.winPercentage) >= 40 ? 'text-yellow-400' :
                                'text-red-400'
                              }`}>
                                {entry.winPercentage}%
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Clock className="w-4 h-4 text-gray-500" />
                              <span className="text-gray-300">
                                {entry.avgMoveTimeMs ? `${entry.avgMoveTimeMs}ms` : '-'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
