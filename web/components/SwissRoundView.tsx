'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Loader2, Swords, CheckCircle, Clock, Trophy } from 'lucide-react';

interface BracketAgent {
    id: string;
    name: string;
    version: number;
    eloRating: number;
    gamesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
}

interface TournamentMatch {
    id: string;
    status: string;
    winner: string | null;
    moves: number;
    termination: string | null;
    whiteAgent: { id: string; name: string; version: number; eloRating: number };
    blackAgent: { id: string; name: string; version: number; eloRating: number };
    completedAt: string | null;
    startedAt: string | null;
    createdAt: string;
}

interface SwissStanding {
    agentId: string;
    points: number;
    matchesPlayed: number;
    buchholz: number;
    opponents: string[];
}

interface SwissRoundViewProps {
    bracketId: 'challenger' | 'contender' | 'elite';
    agents: BracketAgent[];
    eloRange: { min: number; max: number } | null;
}

export default function SwissRoundView({ bracketId, agents }: SwissRoundViewProps) {
    const [matches, setMatches] = useState<TournamentMatch[]>([]);
    const [standings, setStandings] = useState<SwissStanding[]>([]);
    const [currentRound, setCurrentRound] = useState(0);
    const [totalRounds, setTotalRounds] = useState(0);
    const [tournamentComplete, setTournamentComplete] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [showStandings, setShowStandings] = useState(false);

    const fetchMatches = useCallback(async () => {
        try {
            const res = await fetch(`/api/tournament/matches?bracket=${bracketId}&limit=200`);
            const data = await res.json();
            if (data.success) {
                setMatches(data.matches || []);
                setStandings(data.standings || []);
                setCurrentRound(data.currentRound || 0);
                setTotalRounds(data.totalRounds || 0);
                setTournamentComplete(data.tournamentComplete || false);
            }
        } catch (err) {
            console.error('Error fetching bracket matches:', err);
        } finally {
            setIsLoading(false);
        }
    }, [bracketId]);

    useEffect(() => {
        fetchMatches();
        const interval = setInterval(fetchMatches, 5000);
        return () => clearInterval(interval);
    }, [fetchMatches]);

    // Auto-switch to standings when tournament completes
    useEffect(() => {
        if (tournamentComplete && !showStandings) {
            setShowStandings(true);
        }
    }, [tournamentComplete, showStandings]);

    // Get agent info by ID
    const getAgentInfo = useCallback((agentId: string) => {
        return agents.find(a => a.id === agentId);
    }, [agents]);

    // Get standing for an agent
    const getStanding = useCallback((agentId: string) => {
        return standings.find(s => s.agentId === agentId);
    }, [standings]);

    const getStatusColor = (status: string | undefined) => {
        if (!status) return 'bg-gray-700/50 border-gray-600/50';
        switch (status) {
            case 'completed':
                return 'bg-green-900/30 border-green-500/40';
            case 'in_progress':
                return 'bg-yellow-900/30 border-yellow-500/40';
            case 'pending':
                return 'bg-gray-800/50 border-gray-600/40';
            default:
                return 'bg-gray-700/50 border-gray-600/50';
        }
    };

    const getStatusIcon = (status: string | undefined) => {
        if (!status) return null;
        switch (status) {
            case 'completed':
                return <CheckCircle className="w-4 h-4 text-green-400" />;
            case 'in_progress':
                return <Swords className="w-4 h-4 text-yellow-400 animate-pulse" />;
            case 'pending':
                return <Clock className="w-4 h-4 text-gray-400" />;
            default:
                return null;
        }
    };

    // Sort matches: in_progress first, then pending, then completed (newest first)
    const sortedMatches = [...matches].sort((a, b) => {
        const statusOrder: Record<string, number> = { 'in_progress': 0, 'pending': 1, 'completed': 2 };
        const orderA = statusOrder[a.status] ?? 3;
        const orderB = statusOrder[b.status] ?? 3;
        if (orderA !== orderB) return orderA - orderB;
        // For same status, sort by createdAt desc
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const activeMatches = sortedMatches.filter(m => m.status === 'in_progress' || m.status === 'pending');
    const completedMatches = sortedMatches.filter(m => m.status === 'completed');

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Tournament Complete Banner */}
            {tournamentComplete && standings.length > 0 && (
                <div className="bg-gradient-to-r from-yellow-900/40 via-amber-900/40 to-yellow-900/40 backdrop-blur border-2 border-yellow-500/50 rounded-xl p-6 text-center">
                    <Trophy className="w-12 h-12 text-yellow-400 mx-auto mb-3" />
                    <h2 className="text-2xl font-bold text-white mb-2">Tournament Complete!</h2>
                    {standings[0] && (
                        <div className="mt-4">
                            <p className="text-gray-300 mb-2">Winner</p>
                            <Link
                                href={`/agent/${standings[0].agentId}`}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-500/20 rounded-lg border border-yellow-500/40 hover:border-yellow-400 transition-colors"
                            >
                                <Trophy className="w-5 h-5 text-yellow-400" />
                                <span className="text-xl font-bold text-white">
                                    {getAgentInfo(standings[0].agentId)?.name || 'Unknown'}
                                </span>
                                <span className="text-yellow-300 font-semibold">
                                    {standings[0].points} pts
                                </span>
                            </Link>
                        </div>
                    )}
                </div>
            )}

            {/* Tournament Progress */}
            {totalRounds > 0 && (
                <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-white font-semibold">Swiss Tournament Progress</h3>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                            tournamentComplete
                                ? 'bg-green-600/20 text-green-300 border border-green-500/40'
                                : 'bg-purple-600/20 text-purple-300 border border-purple-500/40'
                        }`}>
                            {tournamentComplete ? 'Complete' : 'In Progress'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-800/50 rounded-full h-3 overflow-hidden">
                            <div
                                className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-500"
                                style={{ width: `${tournamentComplete ? 100 : (currentRound / totalRounds) * 100}%` }}
                            />
                        </div>
                        <span className="text-sm text-gray-400">
                            {tournamentComplete ? `${totalRounds} / ${totalRounds}` : `Round ${currentRound} / ${totalRounds}`}
                        </span>
                    </div>
                </div>
            )}

            {/* View Toggle */}
            <div className="flex gap-2">
                <button
                    onClick={() => setShowStandings(false)}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                        !showStandings
                            ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40'
                            : 'bg-gray-800/50 text-gray-400 border border-gray-600/40 hover:border-purple-500/40'
                    }`}
                >
                    Matchups
                </button>
                <button
                    onClick={() => setShowStandings(true)}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                        showStandings
                            ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40'
                            : 'bg-gray-800/50 text-gray-400 border border-gray-600/40 hover:border-purple-500/40'
                    }`}
                >
                    Standings
                </button>
            </div>

            {showStandings ? (
                /* Standings View */
                <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <Trophy className="w-5 h-5 text-yellow-400" />
                        <h3 className="text-white font-semibold">Swiss Standings</h3>
                    </div>

                    {standings.length === 0 ? (
                        <p className="text-gray-500 text-center py-4">No standings available yet</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-purple-500/20">
                                        <th className="py-2 px-2 text-left text-gray-400 font-medium">#</th>
                                        <th className="py-2 px-2 text-left text-gray-400 font-medium">Agent</th>
                                        <th className="py-2 px-2 text-center text-gray-400 font-medium">Pts</th>
                                        <th className="py-2 px-2 text-center text-gray-400 font-medium">Played</th>
                                        <th className="py-2 px-2 text-center text-gray-400 font-medium">Buchholz</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {standings.map((standing, idx) => {
                                        const agent = getAgentInfo(standing.agentId);
                                        return (
                                            <tr key={standing.agentId} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                                                <td className="py-2 px-2">
                                                    {idx === 0 && <span className="text-yellow-400 font-bold">1</span>}
                                                    {idx === 1 && <span className="text-gray-300 font-bold">2</span>}
                                                    {idx === 2 && <span className="text-amber-600 font-bold">3</span>}
                                                    {idx > 2 && <span className="text-gray-500">{idx + 1}</span>}
                                                </td>
                                                <td className="py-2 px-2">
                                                    {agent ? (
                                                        <Link href={`/agent/${agent.id}`} className="text-white hover:text-purple-300 transition-colors">
                                                            {agent.name}
                                                            <span className="text-gray-500 ml-1">v{agent.version}</span>
                                                        </Link>
                                                    ) : (
                                                        <span className="text-gray-500">Unknown</span>
                                                    )}
                                                </td>
                                                <td className="py-2 px-2 text-center">
                                                    <span className="text-white font-bold">{standing.points}</span>
                                                </td>
                                                <td className="py-2 px-2 text-center text-gray-400">
                                                    {standing.matchesPlayed}
                                                </td>
                                                <td className="py-2 px-2 text-center text-gray-400">
                                                    {standing.buchholz.toFixed(1)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            ) : (
                /* Matchups View */
                <>
                    {/* Active Matches */}
                    {activeMatches.length > 0 && (
                        <div className="bg-gray-900/60 backdrop-blur border border-yellow-500/30 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Swords className="w-5 h-5 text-yellow-400" />
                                    <h3 className="text-white font-semibold">Active Matches</h3>
                                </div>
                                <span className="text-xs text-yellow-400">
                                    {activeMatches.length} {activeMatches.length === 1 ? 'match' : 'matches'}
                                </span>
                            </div>

                            <div className="space-y-3">
                                {activeMatches.map((match) => {
                                    const whiteStanding = getStanding(match.whiteAgent.id);
                                    const blackStanding = getStanding(match.blackAgent.id);

                                    return (
                                        <Link
                                            key={match.id}
                                            href={`/match/${match.id}`}
                                            className={`block rounded-xl border p-4 transition-colors hover:brightness-110 ${getStatusColor(match.status)}`}
                                        >
                                            <div className="flex items-center justify-between">
                                                {/* White Agent */}
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-4 h-4 rounded-full bg-white border-2 border-gray-300" />
                                                        <span className="text-white font-medium">
                                                            {match.whiteAgent.name}
                                                        </span>
                                                        <span className="text-gray-500 text-sm">v{match.whiteAgent.version}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-1 ml-6 text-xs text-gray-400">
                                                        <span>ELO: {match.whiteAgent.eloRating}</span>
                                                        {whiteStanding && (
                                                            <span className="text-purple-300">{whiteStanding.points} pts</span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* VS / Status */}
                                                <div className="flex flex-col items-center px-4">
                                                    {getStatusIcon(match.status)}
                                                    <span className="text-xs text-gray-500 mt-1">
                                                        {match.status === 'in_progress' ? 'Live' : 'Pending'}
                                                    </span>
                                                </div>

                                                {/* Black Agent */}
                                                <div className="flex-1 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <span className="text-gray-500 text-sm">v{match.blackAgent.version}</span>
                                                        <span className="text-white font-medium">
                                                            {match.blackAgent.name}
                                                        </span>
                                                        <div className="w-4 h-4 rounded-full bg-gray-800 border-2 border-gray-500" />
                                                    </div>
                                                    <div className="flex items-center justify-end gap-3 mt-1 mr-6 text-xs text-gray-400">
                                                        {blackStanding && (
                                                            <span className="text-purple-300">{blackStanding.points} pts</span>
                                                        )}
                                                        <span>ELO: {match.blackAgent.eloRating}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Completed Matches */}
                    <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <CheckCircle className="w-5 h-5 text-green-400" />
                                <h3 className="text-white font-semibold">Completed Matches</h3>
                            </div>
                            <span className="text-xs text-gray-400">
                                {completedMatches.length} {completedMatches.length === 1 ? 'match' : 'matches'}
                            </span>
                        </div>

                        {completedMatches.length === 0 ? (
                            <div className="text-center py-8">
                                <Clock className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                                <p className="text-gray-500">No matches completed yet</p>
                            </div>
                        ) : (
                            <div className="space-y-3 max-h-[400px] overflow-y-auto overflow-x-hidden">
                                {completedMatches.map((match) => {
                                    const whiteStanding = getStanding(match.whiteAgent.id);
                                    const blackStanding = getStanding(match.blackAgent.id);
                                    const isWhiteWinner = match.winner === 'white';
                                    const isBlackWinner = match.winner === 'black';
                                    const isDraw = match.status === 'completed' && !match.winner;

                                    return (
                                        <Link
                                            key={match.id}
                                            href={`/match/${match.id}`}
                                            className={`block rounded-xl border p-4 transition-colors hover:brightness-110 ${getStatusColor(match.status)}`}
                                        >
                                            <div className="flex items-center justify-between">
                                                {/* White Agent */}
                                                <div className={`flex-1 ${isBlackWinner ? 'opacity-50' : ''}`}>
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-4 h-4 rounded-full bg-white border-2 border-gray-300" />
                                                        <span className="text-white font-medium">
                                                            {match.whiteAgent.name}
                                                        </span>
                                                        <span className="text-gray-500 text-sm">v{match.whiteAgent.version}</span>
                                                        {isWhiteWinner && <Trophy className="w-4 h-4 text-yellow-400" />}
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-1 ml-6 text-xs text-gray-400">
                                                        <span>ELO: {match.whiteAgent.eloRating}</span>
                                                        {whiteStanding && (
                                                            <span className="text-purple-300">{whiteStanding.points} pts</span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* VS / Status */}
                                                <div className="flex flex-col items-center px-4">
                                                    {getStatusIcon(match.status)}
                                                    <span className="text-xs text-gray-500 mt-1">
                                                        {isDraw ? 'Draw' : `${match.moves} moves`}
                                                    </span>
                                                </div>

                                                {/* Black Agent */}
                                                <div className={`flex-1 text-right ${isWhiteWinner ? 'opacity-50' : ''}`}>
                                                    <div className="flex items-center justify-end gap-2">
                                                        {isBlackWinner && <Trophy className="w-4 h-4 text-yellow-400" />}
                                                        <span className="text-gray-500 text-sm">v{match.blackAgent.version}</span>
                                                        <span className="text-white font-medium">
                                                            {match.blackAgent.name}
                                                        </span>
                                                        <div className="w-4 h-4 rounded-full bg-gray-800 border-2 border-gray-500" />
                                                    </div>
                                                    <div className="flex items-center justify-end gap-3 mt-1 mr-6 text-xs text-gray-400">
                                                        {blackStanding && (
                                                            <span className="text-purple-300">{blackStanding.points} pts</span>
                                                        )}
                                                        <span>ELO: {match.blackAgent.eloRating}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Participants List */}
            <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-xl p-4">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-purple-400" />
                        <h3 className="text-white font-semibold">Participants</h3>
                    </div>
                    <span className="text-xs text-gray-400">
                        {agents.length} competing
                    </span>
                </div>

                {agents.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No agents in this bracket yet</p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {agents.map((agent) => {
                            const standing = getStanding(agent.id);
                            return (
                                <Link
                                    key={agent.id}
                                    href={`/agent/${agent.id}`}
                                    className="px-3 py-1.5 bg-gray-800/50 rounded-lg border border-purple-500/10 hover:border-purple-500/30 transition-all text-sm group"
                                >
                                    <span className="text-white font-medium group-hover:text-purple-300">{agent.name}</span>
                                    <span className="text-gray-500 ml-1">v{agent.version}</span>
                                    {standing && standing.matchesPlayed > 0 && (
                                        <span className="ml-2 text-purple-400 text-xs">({standing.points} pts)</span>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-400">
                <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-3 h-3 text-green-400" />
                    <span>Completed</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Swords className="w-3 h-3 text-yellow-400" />
                    <span>In Progress</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-gray-400" />
                    <span>Pending</span>
                </div>
            </div>
        </div>
    );
}
