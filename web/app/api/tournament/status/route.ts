import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCachedBrackets } from '@/lib/tournament-cache';

interface BracketStatus {
    pending: number;
    in_progress: number;
    completed: number;
    agents: number;
    currentRound: number;
    totalRounds: number;
    tournamentStatus: string;
}

function calculateTotalRounds(numAgents: number): number {
    if (numAgents < 2) return 0;
    // For Swiss: min of ceil(log2(n)) and (n-1) since each player can only play n-1 unique opponents
    const logRounds = Math.ceil(Math.log2(numAgents));
    const maxPossibleRounds = numAgents - 1;
    // Use at least 3 rounds if we have enough agents, but cap at max possible
    return Math.min(Math.max(3, logRounds), maxPossibleRounds);
}

function computeSwissRoundInfo(
    bracketAgentIds: string[],
    matches: Array<{ whiteAgentId: string; blackAgentId: string; winner: string | null; status: string }>
): { currentRound: number; totalRounds: number; isComplete: boolean } {
    if (bracketAgentIds.length < 2) {
        return { currentRound: 0, totalRounds: 0, isComplete: true };
    }

    const totalRounds = calculateTotalRounds(bracketAgentIds.length);

    // Count matches played per agent (completed only)
    const matchesPlayed: Record<string, number> = {};
    for (const agentId of bracketAgentIds) {
        matchesPlayed[agentId] = 0;
    }

    const completedMatches = matches.filter(m => m.status === 'completed');
    for (const match of completedMatches) {
        if (matchesPlayed[match.whiteAgentId] !== undefined) {
            matchesPlayed[match.whiteAgentId]++;
        }
        if (matchesPlayed[match.blackAgentId] !== undefined) {
            matchesPlayed[match.blackAgentId]++;
        }
    }

    const matchCounts = Object.values(matchesPlayed);
    const maxMatchesPlayed = matchCounts.length > 0 ? Math.max(...matchCounts) : 0;
    const minMatchesPlayed = matchCounts.length > 0 ? Math.min(...matchCounts) : 0;

    // Current round calculation
    const currentRound = minMatchesPlayed === maxMatchesPlayed
        ? Math.min(maxMatchesPlayed + 1, totalRounds)
        : Math.min(maxMatchesPlayed, totalRounds);

    const isComplete = minMatchesPlayed >= totalRounds;

    return { currentRound, totalRounds, isComplete };
}

export async function GET() {
    try {
        // Get tournament match statistics per bracket
        const stats: Record<string, BracketStatus> = {
            challenger: { pending: 0, in_progress: 0, completed: 0, agents: 0, currentRound: 0, totalRounds: 0, tournamentStatus: 'pending' },
            contender: { pending: 0, in_progress: 0, completed: 0, agents: 0, currentRound: 0, totalRounds: 0, tournamentStatus: 'pending' },
            elite: { pending: 0, in_progress: 0, completed: 0, agents: 0, currentRound: 0, totalRounds: 0, tournamentStatus: 'pending' },
        };

        // Try to use cached brackets first (fixed at tournament start)
        const cachedBrackets = await getCachedBrackets();

        let bracketAgentIds: Record<string, string[]>;
        let total: number;

        if (cachedBrackets) {
            // Use cached bracket assignments - these are fixed for the entire tournament
            bracketAgentIds = {
                challenger: cachedBrackets.challenger,
                contender: cachedBrackets.contender,
                elite: cachedBrackets.elite,
            };
            total = cachedBrackets.challenger.length + cachedBrackets.contender.length + cachedBrackets.elite.length;
        } else {
            // Fallback to dynamic calculation if no cache (tournament not started)
            // Fetch all active SERVER agents with rankings
            const rankings = await prisma.ranking.findMany({
                where: {
                    gamesPlayed: { gt: 0 },
                    agent: {
                        active: true,
                        executionMode: 'server'
                    },
                },
                include: { agent: true },
                orderBy: { eloRating: 'asc' },
            });

            // Dedupe by agent
            const bestByAgent = new Map<string, typeof rankings[number]>();
            for (const ranking of rankings) {
                if (!ranking.agent.active || ranking.agent.executionMode !== 'server') continue;
                const existing = bestByAgent.get(ranking.agentId);
                if (!existing || ranking.eloRating > existing.eloRating) {
                    bestByAgent.set(ranking.agentId, ranking);
                }
            }

            const sorted = Array.from(bestByAgent.values()).sort(
                (a, b) => a.eloRating - b.eloRating
            );

            total = sorted.length;

            // Get agent IDs per bracket - handle < 8 agents case
            if (total < 8) {
                // All agents go to contender bracket when < 8 total
                bracketAgentIds = {
                    challenger: [],
                    contender: sorted.map((r) => r.agentId),
                    elite: [],
                };
            } else {
                const bottom25End = Math.max(1, Math.round(total * 0.25));
                const top25Start = Math.max(bottom25End, Math.round(total * 0.75));

                bracketAgentIds = {
                    challenger: sorted.slice(0, bottom25End).map((r) => r.agentId),
                    contender: sorted.slice(bottom25End, top25Start).map((r) => r.agentId),
                    elite: sorted.slice(top25Start).map((r) => r.agentId),
                };
            }
        }

        // Update agent counts
        stats.challenger.agents = bracketAgentIds.challenger.length;
        stats.contender.agents = bracketAgentIds.contender.length;
        stats.elite.agents = bracketAgentIds.elite.length;

        // Fetch tournament match counts and compute Swiss round info per bracket
        for (const [bracketId, agentIds] of Object.entries(bracketAgentIds)) {
            if (agentIds.length === 0) {
                stats[bracketId].tournamentStatus = 'completed';
                continue;
            }

            // Get all tournament matches for this bracket
            const bracketMatches = await prisma.match.findMany({
                where: {
                    matchType: 'tournament',
                    whiteAgentId: { in: agentIds },
                    blackAgentId: { in: agentIds },
                },
                select: {
                    whiteAgentId: true,
                    blackAgentId: true,
                    winner: true,
                    status: true,
                },
            });

            // Count by status
            for (const match of bracketMatches) {
                if (match.status === 'pending') {
                    stats[bracketId].pending++;
                } else if (match.status === 'in_progress') {
                    stats[bracketId].in_progress++;
                } else if (match.status === 'completed') {
                    stats[bracketId].completed++;
                }
            }

            // Compute Swiss round info
            const { currentRound, totalRounds, isComplete } = computeSwissRoundInfo(agentIds, bracketMatches);
            stats[bracketId].currentRound = currentRound;
            stats[bracketId].totalRounds = totalRounds;
            stats[bracketId].tournamentStatus = isComplete ? 'completed' : (bracketMatches.length > 0 ? 'in_progress' : 'pending');
        }

        // Check if tournament is complete based on all brackets
        const tournamentComplete = Object.entries(bracketAgentIds).every(([bracketId, agentIds]) => {
            if (agentIds.length < 2) return true; // Brackets with < 2 agents are "complete"
            return stats[bracketId].tournamentStatus === 'completed';
        });

        return NextResponse.json({
            success: true,
            status: stats,
            totalAgents: total,
            tournamentComplete,
        });
    } catch (error) {
        console.error('Error fetching tournament status:', error);
        return NextResponse.json(
            { error: 'Failed to fetch tournament status' },
            { status: 500 }
        );
    }
}
