'use client';

import Link from 'next/link';
import { Trophy, Clock } from 'lucide-react';

export interface LeaderboardEntry {
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
    lossPercentage?: string;
    avgMoveTimeMs: number | null;
}

interface LeaderboardTableProps {
    entries: LeaderboardEntry[];
    userAgentIds?: Set<string>;
    showPodium?: boolean;
    compact?: boolean;
    title?: string;
}

export default function LeaderboardTable({
    entries,
    userAgentIds = new Set(),
    showPodium = true,
    compact = false,
    title,
}: LeaderboardTableProps) {
    const getMedalIcon = (rank: number) => {
        if (rank === 1) return <Trophy className="w-6 h-6 text-yellow-400" />;
        if (rank === 2) return <Trophy className="w-6 h-6 text-gray-300" />;
        if (rank === 3) return <Trophy className="w-6 h-6 text-orange-600" />;
        return null;
    };

    if (entries.length === 0) {
        return (
            <div className="bg-gray-800/50 backdrop-blur border border-purple-500/20 rounded-lg p-8 text-center">
                <Trophy className="w-12 h-12 text-purple-400 opacity-50 mx-auto mb-4" />
                <p className="text-gray-400">No entries to display</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {title && (
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-purple-400" />
                    {title}
                </h3>
            )}

            {/* Podium for top 3 */}
            {showPodium && entries.length >= 3 && entries[0]?.rank === 1 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    {/* 2nd Place */}
                    <div className="order-2 md:order-1">
                        <div className={`bg-gradient-to-br from-gray-700/50 to-gray-800/50 backdrop-blur rounded-lg border p-4 md:p-6 transform md:translate-y-4 hover:scale-105 transition-all duration-300 ${userAgentIds.has(entries[1].agentId) ? 'border-purple-500 ring-2 ring-purple-500' : 'border-gray-500/30'}`}>
                            <div className="text-center mb-2">
                                <Trophy className="w-10 h-10 text-gray-300 mx-auto mb-1" />
                                <div className="text-3xl font-bold text-gray-300">2nd</div>
                            </div>
                            <div className="text-center">
                                <div className="flex items-center justify-center gap-2">
                                    <Link href={`/agent/${entries[1].agentId}`} className="text-white font-bold text-lg hover:text-purple-300">
                                        {entries[1].agentName}
                                    </Link>
                                    {userAgentIds.has(entries[1].agentId) && (
                                        <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full font-semibold">YOU</span>
                                    )}
                                </div>
                                <div className="text-gray-400 text-sm">v{entries[1].version}</div>
                                <div className="text-2xl font-bold text-gray-300 mt-2">{entries[1].eloRating}</div>
                                <div className="text-xs text-gray-500">ELO Rating</div>
                                <div className="mt-2 text-sm">
                                    <span className="text-green-400">{entries[1].winPercentage}%</span> Win Rate
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 1st Place */}
                    <div className="order-1 md:order-2">
                        <div className={`bg-gradient-to-br from-yellow-600/30 to-yellow-800/30 backdrop-blur rounded-lg border-2 p-4 md:p-6 transform hover:scale-105 transition-all duration-300 shadow-xl ${userAgentIds.has(entries[0].agentId) ? 'border-purple-500 ring-2 ring-purple-500 shadow-purple-500/20' : 'border-yellow-500/50 shadow-yellow-500/20'}`}>
                            <div className="text-center mb-2">
                                <Trophy className="w-14 h-14 text-yellow-400 mx-auto mb-1" />
                                <div className="text-4xl font-bold text-yellow-400">1st</div>
                            </div>
                            <div className="text-center">
                                <div className="flex items-center justify-center gap-2">
                                    <Link href={`/agent/${entries[0].agentId}`} className="text-white font-bold text-xl hover:text-purple-300">
                                        {entries[0].agentName}
                                    </Link>
                                    {userAgentIds.has(entries[0].agentId) && (
                                        <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full font-semibold">YOU</span>
                                    )}
                                </div>
                                <div className="text-gray-400 text-sm">v{entries[0].version}</div>
                                <div className="text-3xl font-bold text-yellow-400 mt-2">{entries[0].eloRating}</div>
                                <div className="text-xs text-gray-500">ELO Rating</div>
                                <div className="mt-2 text-sm">
                                    <span className="text-green-400">{entries[0].winPercentage}%</span> Win Rate
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 3rd Place */}
                    <div className="order-3">
                        <div className={`bg-gradient-to-br from-orange-700/30 to-orange-900/30 backdrop-blur rounded-lg border p-4 md:p-6 transform md:translate-y-8 hover:scale-105 transition-all duration-300 ${userAgentIds.has(entries[2].agentId) ? 'border-purple-500 ring-2 ring-purple-500' : 'border-orange-600/30'}`}>
                            <div className="text-center mb-2">
                                <Trophy className="w-8 h-8 text-orange-600 mx-auto mb-1" />
                                <div className="text-2xl font-bold text-orange-600">3rd</div>
                            </div>
                            <div className="text-center">
                                <div className="flex items-center justify-center gap-2">
                                    <Link href={`/agent/${entries[2].agentId}`} className="text-white font-bold text-lg hover:text-purple-300">
                                        {entries[2].agentName}
                                    </Link>
                                    {userAgentIds.has(entries[2].agentId) && (
                                        <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full font-semibold">YOU</span>
                                    )}
                                </div>
                                <div className="text-gray-400 text-sm">v{entries[2].version}</div>
                                <div className="text-2xl font-bold text-orange-600 mt-2">{entries[2].eloRating}</div>
                                <div className="text-xs text-gray-500">ELO Rating</div>
                                <div className="mt-2 text-sm">
                                    <span className="text-green-400">{entries[2].winPercentage}%</span> Win Rate
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Table */}
            <div className="bg-gray-800/50 backdrop-blur rounded-lg border border-purple-500/20 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-900/50">
                            <tr>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-purple-400">Rank</th>
                                <th className="px-4 py-3 text-left text-sm font-semibold text-purple-400">Agent</th>
                                <th className="px-4 py-3 text-center text-sm font-semibold text-purple-400">ELO</th>
                                {!compact && (
                                    <>
                                        <th className="px-4 py-3 text-center text-sm font-semibold text-purple-400">Games</th>
                                        <th className="px-4 py-3 text-center text-sm font-semibold text-purple-400">W/L/D</th>
                                    </>
                                )}
                                <th className="px-4 py-3 text-center text-sm font-semibold text-purple-400">Win Rate</th>
                                {!compact && (
                                    <th className="px-4 py-3 text-center text-sm font-semibold text-purple-400">Avg Time</th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-purple-500/10">
                            {entries.map((entry, index) => (
                                <tr
                                    key={entry.agentId}
                                    className={`hover:bg-purple-900/20 transition-all duration-200 ${index < 3 ? 'bg-gradient-to-r from-transparent via-purple-900/10 to-transparent' : ''} ${userAgentIds.has(entry.agentId) ? 'ring-2 ring-purple-500 ring-inset bg-purple-900/30' : ''}`}
                                >
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            {getMedalIcon(entry.rank)}
                                            <span className={`font-bold ${entry.rank <= 3 ? 'text-xl' : 'text-lg'} text-white`}>
                                                {entry.rank}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
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
                                    <td className="px-4 py-3 text-center">
                                        <span className={`text-xl font-bold ${entry.eloRating >= 1600 ? 'text-yellow-400' :
                                                entry.eloRating >= 1400 ? 'text-green-400' :
                                                    'text-gray-400'
                                            }`}>
                                            {entry.eloRating}
                                        </span>
                                    </td>
                                    {!compact && (
                                        <>
                                            <td className="px-4 py-3 text-center">
                                                <div className="text-white font-semibold">{entry.gamesPlayed}</div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex justify-center gap-1">
                                                    <span className="bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded text-xs font-semibold">{entry.wins}W</span>
                                                    <span className="bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded text-xs font-semibold">{entry.losses}L</span>
                                                    <span className="bg-gray-700/50 text-gray-400 px-1.5 py-0.5 rounded text-xs font-semibold">{entry.draws}D</span>
                                                </div>
                                            </td>
                                        </>
                                    )}
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <div className="w-16 bg-gray-700 rounded-full h-1.5 overflow-hidden">
                                                <div
                                                    className={`h-full ${parseFloat(entry.winPercentage) >= 60 ? 'bg-green-400' :
                                                            parseFloat(entry.winPercentage) >= 40 ? 'bg-yellow-400' :
                                                                'bg-red-400'
                                                        }`}
                                                    style={{ width: `${entry.winPercentage}%` }}
                                                />
                                            </div>
                                            <span className={`text-sm font-semibold ${parseFloat(entry.winPercentage) >= 60 ? 'text-green-400' :
                                                    parseFloat(entry.winPercentage) >= 40 ? 'text-yellow-400' :
                                                        'text-red-400'
                                                }`}>
                                                {entry.winPercentage}%
                                            </span>
                                        </div>
                                    </td>
                                    {!compact && (
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <Clock className="w-4 h-4 text-gray-500" />
                                                <span className="text-gray-300 text-sm">
                                                    {entry.avgMoveTimeMs ? `${entry.avgMoveTimeMs}ms` : '-'}
                                                </span>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
