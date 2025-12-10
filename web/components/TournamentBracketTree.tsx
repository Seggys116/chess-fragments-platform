'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Trophy, Swords, Clock, CheckCircle } from 'lucide-react';

interface BracketAgent {
    id: string;
    name: string;
    version: number;
    eloRating: number;
}

interface TournamentMatch {
    id: string;
    status: string;
    winner: string | null;
    moves: number;
    termination: string | null;
    whiteAgent: BracketAgent;
    blackAgent: BracketAgent;
    completedAt: string | null;
    startedAt: string | null;
}

interface TournamentBracketTreeProps {
    bracketId: 'challenger' | 'contender' | 'elite';
    agents: BracketAgent[];
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

export default function TournamentBracketTree({ bracketId, agents }: TournamentBracketTreeProps) {
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

    // Organize matches into bracket rounds based on completion time
    useEffect(() => {
        if (agents.length === 0) return;

        // For a proper single-elimination bracket visualization
        // We'll simulate rounds based on the number of agents
        const agentCount = agents.length;

        // Handle special case of 2 agents - just one Finals match
        if (agentCount === 2) {
            // Look for any match between these two agents
            const finalsMatch = matches.find(m => {
                const matchAgentIds = [m.whiteAgent.id, m.blackAgent.id];
                return agents.every(a => matchAgentIds.includes(a.id));
            });

            const slot: MatchSlot = finalsMatch ? {
                match: finalsMatch,
                agent1: finalsMatch.whiteAgent,
                agent2: finalsMatch.blackAgent,
                winnerId: finalsMatch.winner === 'white' ? finalsMatch.whiteAgent.id :
                          finalsMatch.winner === 'black' ? finalsMatch.blackAgent.id : null
            } : {
                // No match yet - show the two agents as awaiting their match
                match: null,
                agent1: agents[0],
                agent2: agents[1],
                winnerId: null
            };

            setRounds([{
                roundNumber: 1,
                label: 'Finals',
                slots: [slot]
            }]);
            return;
        }

        const totalRounds = Math.ceil(Math.log2(agentCount));

        // Group completed matches by approximate "round" based on order
        const completedMatches = matches
            .filter(m => m.status === 'completed')
            .sort((a, b) => {
                const timeA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
                const timeB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
                return timeA - timeB;
            });

        const inProgressMatches = matches.filter(m => m.status === 'in_progress');
        const pendingMatches = matches.filter(m => m.status === 'pending');

        // Calculate how many matches should be in each round
        // Round 1: agentCount/2 matches, Round 2: agentCount/4, etc.
        const roundLabels = ['Round 1', 'Quarter Finals', 'Semi Finals', 'Finals', 'Champion'];
        const newRounds: Round[] = [];

        let matchesPerRound = Math.ceil(agentCount / 2);
        let matchIndex = 0;
        let currentInProgress = [...inProgressMatches];
        let currentPending = [...pendingMatches];

        for (let r = 0; r < totalRounds; r++) {
            const roundSlots: MatchSlot[] = [];
            const slotsNeeded = matchesPerRound;

            for (let s = 0; s < slotsNeeded; s++) {
                // Try to fill slot with completed match first
                if (matchIndex < completedMatches.length) {
                    const match = completedMatches[matchIndex];
                    roundSlots.push({
                        match,
                        agent1: match.whiteAgent,
                        agent2: match.blackAgent,
                        winnerId: match.winner === 'white' ? match.whiteAgent.id :
                                  match.winner === 'black' ? match.blackAgent.id : null
                    });
                    matchIndex++;
                } else if (currentInProgress.length > 0) {
                    // Fill with in-progress match
                    const match = currentInProgress.shift()!;
                    roundSlots.push({
                        match,
                        agent1: match.whiteAgent,
                        agent2: match.blackAgent,
                        winnerId: null
                    });
                } else if (currentPending.length > 0) {
                    // Fill with pending match
                    const match = currentPending.shift()!;
                    roundSlots.push({
                        match,
                        agent1: match.whiteAgent,
                        agent2: match.blackAgent,
                        winnerId: null
                    });
                } else {
                    // Empty slot (TBD)
                    roundSlots.push({
                        match: null,
                        agent1: null,
                        agent2: null,
                        winnerId: null
                    });
                }
            }

            // Determine round label
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

    if (agents.length === 0) {
        return (
            <div className="text-center py-8 text-gray-400">
                No agents in this bracket yet
            </div>
        );
    }

    return (
        <div className="bg-gray-900/60 backdrop-blur border border-purple-500/20 rounded-xl p-4 overflow-x-auto">
            <div className="flex items-center gap-2 mb-4">
                <Trophy className="w-5 h-5 text-purple-400" />
                <h3 className="text-white font-semibold">Tournament Bracket</h3>
                <span className="text-xs text-gray-400 ml-2">
                    {agents.length} agents competing
                </span>
            </div>

            {/* Bracket Tree */}
            <div className="flex gap-4 min-w-max pb-4">
                {rounds.map((round, roundIdx) => (
                    <div key={round.roundNumber} className="flex flex-col">
                        {/* Round Header */}
                        <div className="text-center mb-3">
                            <span className="text-xs text-purple-300 uppercase font-semibold tracking-wide">
                                {round.label}
                            </span>
                        </div>

                        {/* Match Slots */}
                        <div
                            className="flex flex-col justify-around flex-1 gap-2"
                            style={{
                                minHeight: `${Math.pow(2, rounds.length - roundIdx - 1) * 80}px`
                            }}
                        >
                            {round.slots.map((slot, slotIdx) => (
                                <div
                                    key={slotIdx}
                                    className="relative flex items-center"
                                >
                                    {/* Match Box */}
                                    <div
                                        className={`w-44 rounded-lg border p-2 ${getStatusColor(slot.match?.status)}`}
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
                                                        <span className="text-white text-xs font-medium truncate max-w-[100px]">
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
                                                        <span className="text-white text-xs font-medium truncate max-w-[100px]">
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
                                        ) : slot.agent1 && slot.agent2 ? (
                                            // No match yet but we know the agents (awaiting match)
                                            <div>
                                                {/* Agent 1 */}
                                                <div className="flex items-center justify-between p-1.5 rounded">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-2.5 h-2.5 rounded-full bg-purple-500/50 border border-purple-400/50" />
                                                        <span className="text-white text-xs font-medium truncate max-w-[100px]">
                                                            {slot.agent1.name}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Divider with awaiting status */}
                                                <div className="flex items-center justify-center py-0.5">
                                                    <div className="flex-1 h-px bg-gray-600/50" />
                                                    <div className="px-1.5">
                                                        <Clock className="w-3 h-3 text-purple-400" />
                                                    </div>
                                                    <div className="flex-1 h-px bg-gray-600/50" />
                                                </div>

                                                {/* Agent 2 */}
                                                <div className="flex items-center justify-between p-1.5 rounded">
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-2.5 h-2.5 rounded-full bg-purple-500/50 border border-purple-400/50" />
                                                        <span className="text-white text-xs font-medium truncate max-w-[100px]">
                                                            {slot.agent2.name}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="text-center mt-1">
                                                    <span className="text-[10px] text-purple-400">Awaiting match</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center py-4">
                                                <span className="text-xs text-gray-500">TBD</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Connector Lines (SVG) */}
                                    {roundIdx < rounds.length - 1 && (
                                        <svg
                                            className="absolute left-full"
                                            width="24"
                                            height="100%"
                                            style={{ overflow: 'visible' }}
                                        >
                                            <path
                                                d={`M 0 50% L 12 50%`}
                                                stroke="rgba(139, 92, 246, 0.3)"
                                                strokeWidth="2"
                                                fill="none"
                                            />
                                        </svg>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}

                {/* Champion Display */}
                {rounds.length > 0 && rounds[rounds.length - 1].slots[0]?.winnerId && (
                    <div className="flex flex-col justify-center">
                        <div className="text-center mb-3">
                            <span className="text-xs text-yellow-400 uppercase font-semibold tracking-wide">
                                Champion
                            </span>
                        </div>
                        <div className="bg-gradient-to-br from-yellow-900/40 to-amber-900/40 border-2 border-yellow-500/50 rounded-xl p-4 text-center">
                            <Trophy className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                            <div className="text-white font-bold">
                                {rounds[rounds.length - 1].slots[0].winnerId === rounds[rounds.length - 1].slots[0].agent1?.id
                                    ? rounds[rounds.length - 1].slots[0].agent1?.name
                                    : rounds[rounds.length - 1].slots[0].agent2?.name
                                }
                            </div>
                        </div>
                    </div>
                )}
            </div>

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
    );
}
