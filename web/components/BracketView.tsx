'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, ChevronRight, Loader2, Swords, CheckCircle, Clock, Trophy } from 'lucide-react';

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
}

interface MatchSlot {
    match: TournamentMatch | null;
    agent1: BracketAgent | null;
    agent2: BracketAgent | null;
    winnerId: string | null;
}

interface Round {
    roundNumber: number;
    label: string;
    slots: MatchSlot[];
}

interface BracketViewProps {
    bracketId: 'challenger' | 'contender' | 'elite';
    agents: BracketAgent[];
    eloRange: { min: number; max: number } | null;
}

export default function BracketView({ bracketId, agents }: BracketViewProps) {
    const [matches, setMatches] = useState<TournamentMatch[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [rounds, setRounds] = useState<Round[]>([]);

    const fetchMatches = useCallback(async () => {
        try {
            const res = await fetch(`/api/tournament/matches?bracket=${bracketId}&limit=100`);
            const data = await res.json();
            if (data.success) {
                setMatches(data.matches);
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

    // Organize matches into bracket rounds
    useEffect(() => {
        if (agents.length === 0) return;

        const agentCount = agents.length;
        const totalRounds = Math.max(1, Math.ceil(Math.log2(agentCount)));

        // Sort matches by completion time
        const completedMatches = matches
            .filter(m => m.status === 'completed')
            .sort((a, b) => {
                const timeA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
                const timeB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
                return timeA - timeB;
            });

        const inProgressMatches = matches.filter(m => m.status === 'in_progress');
        const pendingMatches = matches.filter(m => m.status === 'pending');

        const roundLabels = ['Round 1', 'Quarter Finals', 'Semi Finals', 'Finals'];
        const newRounds: Round[] = [];

        let matchesPerRound = Math.ceil(agentCount / 2);
        let matchIndex = 0;
        let currentInProgress = [...inProgressMatches];
        let currentPending = [...pendingMatches];

        for (let r = 0; r < totalRounds; r++) {
            const roundSlots: MatchSlot[] = [];
            const slotsNeeded = matchesPerRound;

            for (let s = 0; s < slotsNeeded; s++) {
                if (matchIndex < completedMatches.length) {
                    const match = completedMatches[matchIndex];
                    roundSlots.push({
                        match,
                        agent1: match.whiteAgent as unknown as BracketAgent,
                        agent2: match.blackAgent as unknown as BracketAgent,
                        winnerId: match.winner === 'white' ? match.whiteAgent.id :
                                  match.winner === 'black' ? match.blackAgent.id : null
                    });
                    matchIndex++;
                } else if (currentInProgress.length > 0) {
                    const match = currentInProgress.shift()!;
                    roundSlots.push({
                        match,
                        agent1: match.whiteAgent as unknown as BracketAgent,
                        agent2: match.blackAgent as unknown as BracketAgent,
                        winnerId: null
                    });
                } else if (currentPending.length > 0) {
                    const match = currentPending.shift()!;
                    roundSlots.push({
                        match,
                        agent1: match.whiteAgent as unknown as BracketAgent,
                        agent2: match.blackAgent as unknown as BracketAgent,
                        winnerId: null
                    });
                } else {
                    roundSlots.push({
                        match: null,
                        agent1: null,
                        agent2: null,
                        winnerId: null
                    });
                }
            }

            let label = roundLabels[0];
            if (totalRounds === 1) {
                label = 'Finals';
            } else if (r === totalRounds - 1) {
                label = 'Finals';
            } else if (r === totalRounds - 2 && totalRounds >= 2) {
                label = 'Semi Finals';
            } else if (r === totalRounds - 3 && totalRounds >= 3) {
                label = 'Quarter Finals';
            } else {
                label = `Round ${r + 1}`;
            }

            newRounds.push({
                roundNumber: r + 1,
                label,
                slots: roundSlots
            });

            matchesPerRound = Math.ceil(matchesPerRound / 2);
        }

        setRounds(newRounds);
    }, [matches, agents]);

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
                return <CheckCircle className="w-3 h-3 text-green-400" />;
            case 'in_progress':
                return <Swords className="w-3 h-3 text-yellow-400 animate-pulse" />;
            case 'pending':
                return <Clock className="w-3 h-3 text-gray-400" />;
            default:
                return null;
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Participants List - No ranking, equal treatment */}
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
                        {agents.map((agent) => (
                            <Link
                                key={agent.id}
                                href={`/agent/${agent.id}`}
                                className="px-3 py-1.5 bg-gray-800/50 rounded-lg border border-purple-500/10 hover:border-purple-500/30 transition-all text-sm"
                            >
                                <span className="text-white font-medium">{agent.name}</span>
                                <span className="text-gray-500 ml-1">v{agent.version}</span>
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            {/* Tournament Bracket Tree */}
            <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-xl p-4 overflow-x-auto">
                <div className="flex items-center gap-2 mb-4">
                    <ChevronRight className="w-5 h-5 text-purple-400" />
                    <h3 className="text-white font-semibold">Tournament Bracket</h3>
                </div>

                {rounds.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">Bracket not yet generated</p>
                ) : (
                    <div className="flex gap-6 min-w-max pb-4">
                        {rounds.map((round, roundIdx) => (
                            <div key={round.roundNumber} className="flex flex-col min-w-[180px]">
                                {/* Round Header */}
                                <div className="text-center mb-3 pb-2 border-b border-purple-500/20">
                                    <span className="text-xs text-purple-300 uppercase font-semibold tracking-wide">
                                        {round.label}
                                    </span>
                                </div>

                                {/* Match Slots */}
                                <div
                                    className="flex flex-col justify-around flex-1 gap-3"
                                    style={{
                                        minHeight: `${Math.max(round.slots.length * 90, 100)}px`
                                    }}
                                >
                                    {round.slots.map((slot, slotIdx) => (
                                        <div key={slotIdx} className="relative">
                                            {/* Match Box */}
                                            <div
                                                className={`rounded-lg border p-2 ${getStatusColor(slot.match?.status)}`}
                                            >
                                                {slot.match ? (
                                                    <Link href={`/match/${slot.match.id}`} className="block">
                                                        {/* White Agent */}
                                                        <div className={`flex items-center justify-between p-1.5 rounded ${
                                                            slot.winnerId === slot.agent1?.id
                                                                ? 'bg-green-900/40'
                                                                : slot.match.status === 'completed' && slot.winnerId !== slot.agent1?.id
                                                                ? 'opacity-50'
                                                                : ''
                                                        }`}>
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="w-2.5 h-2.5 rounded-full bg-white border border-gray-300" />
                                                                <span className="text-white text-xs font-medium truncate max-w-[110px]">
                                                                    {slot.agent1?.name}
                                                                </span>
                                                            </div>
                                                            {slot.winnerId === slot.agent1?.id && (
                                                                <Trophy className="w-3 h-3 text-yellow-400" />
                                                            )}
                                                        </div>

                                                        {/* Divider with status */}
                                                        <div className="flex items-center justify-center py-0.5">
                                                            <div className="flex-1 h-px bg-gray-600/50" />
                                                            <div className="px-1.5">
                                                                {getStatusIcon(slot.match.status)}
                                                            </div>
                                                            <div className="flex-1 h-px bg-gray-600/50" />
                                                        </div>

                                                        {/* Black Agent */}
                                                        <div className={`flex items-center justify-between p-1.5 rounded ${
                                                            slot.winnerId === slot.agent2?.id
                                                                ? 'bg-green-900/40'
                                                                : slot.match.status === 'completed' && slot.winnerId !== slot.agent2?.id
                                                                ? 'opacity-50'
                                                                : ''
                                                        }`}>
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="w-2.5 h-2.5 rounded-full bg-gray-800 border border-gray-500" />
                                                                <span className="text-white text-xs font-medium truncate max-w-[110px]">
                                                                    {slot.agent2?.name}
                                                                </span>
                                                            </div>
                                                            {slot.winnerId === slot.agent2?.id && (
                                                                <Trophy className="w-3 h-3 text-yellow-400" />
                                                            )}
                                                        </div>

                                                        {/* Match info */}
                                                        {slot.match.status === 'completed' && (
                                                            <div className="text-center mt-1">
                                                                <span className="text-[10px] text-gray-500">
                                                                    {slot.match.moves} moves
                                                                </span>
                                                            </div>
                                                        )}
                                                    </Link>
                                                ) : (
                                                    <div className="text-center py-4">
                                                        <span className="text-xs text-gray-500">TBD</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Connector line to next round */}
                                            {roundIdx < rounds.length - 1 && (
                                                <div className="absolute top-1/2 -right-6 w-6 h-px bg-purple-500/30" />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Champion Display */}
                        {rounds.length > 0 && rounds[rounds.length - 1].slots[0]?.winnerId && (
                            <div className="flex flex-col justify-center min-w-[140px]">
                                <div className="text-center mb-3 pb-2 border-b border-yellow-500/30">
                                    <span className="text-xs text-yellow-400 uppercase font-semibold tracking-wide">
                                        Champion
                                    </span>
                                </div>
                                <div className="bg-gradient-to-br from-yellow-900/40 to-amber-900/40 border-2 border-yellow-500/50 rounded-xl p-4 text-center">
                                    <Trophy className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                                    <div className="text-white font-bold text-sm">
                                        {rounds[rounds.length - 1].slots[0].winnerId === rounds[rounds.length - 1].slots[0].agent1?.id
                                            ? rounds[rounds.length - 1].slots[0].agent1?.name
                                            : rounds[rounds.length - 1].slots[0].agent2?.name
                                        }
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Legend */}
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-purple-500/20 text-xs text-gray-400">
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
        </div>
    );
}
