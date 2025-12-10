import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCachedBrackets } from '@/lib/tournament-cache';

export type BracketId = 'challenger' | 'contender' | 'elite';

export interface BracketAgent {
    id: string;
    name: string;
    version: number;
    eloRating: number;
    gamesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
}

export interface TournamentBracket {
    id: BracketId;
    label: string;
    percentLabel: string;
    description: string;
    agents: BracketAgent[];
    eloRange: { min: number; max: number } | null;
}

type RankingWithAgent = {
    agentId: string;
    eloRating: number;
    gamesPlayed: number;
    wins: number;
    losses: number;
    draws: number;
    agent: {
        id: string;
        name: string;
        version: number;
        active: boolean;
        executionMode: string;
    };
};

export async function GET() {
    try {
        // Try to use cached brackets first (fixed at tournament start)
        const cachedBrackets = await getCachedBrackets();

        // Fetch all rankings we might need
        const rankings = await prisma.ranking.findMany({
            where: {
                gamesPlayed: { gt: 0 },
                agent: {
                    executionMode: 'server'
                },
            },
            include: { agent: true },
            orderBy: { eloRating: 'asc' },
        });

        // Dedupe by agent (keep highest ELO per agent)
        const bestByAgent = new Map<string, typeof rankings[number]>();
        for (const ranking of rankings) {
            if (ranking.agent.executionMode !== 'server') continue;
            const existing = bestByAgent.get(ranking.agentId);
            if (!existing || ranking.eloRating > existing.eloRating) {
                bestByAgent.set(ranking.agentId, ranking);
            }
        }

        // Helper functions
        const mapAgents = (slice: RankingWithAgent[]): BracketAgent[] =>
            slice.map((r) => ({
                id: r.agentId,
                name: r.agent.name,
                version: r.agent.version,
                eloRating: r.eloRating,
                gamesPlayed: r.gamesPlayed,
                wins: r.wins,
                losses: r.losses,
                draws: r.draws,
            }));

        const getRange = (slice: RankingWithAgent[]) =>
            slice.length > 0
                ? { min: slice[0].eloRating, max: slice[slice.length - 1].eloRating }
                : null;

        // Use cached brackets if available
        if (cachedBrackets) {
            const getAgentsForBracket = (agentIds: string[]): RankingWithAgent[] => {
                const agents: RankingWithAgent[] = [];
                for (const agentId of agentIds) {
                    const ranking = bestByAgent.get(agentId);
                    if (ranking) {
                        agents.push(ranking as RankingWithAgent);
                    }
                }
                return agents.sort((a, b) => a.eloRating - b.eloRating);
            };

            const challengerAgents = getAgentsForBracket(cachedBrackets.challenger);
            const contenderAgents = getAgentsForBracket(cachedBrackets.contender);
            const eliteAgents = getAgentsForBracket(cachedBrackets.elite);
            const total = cachedBrackets.challenger.length + cachedBrackets.contender.length + cachedBrackets.elite.length;

            // If only contender has agents (< 8 total case)
            if (cachedBrackets.challenger.length === 0 && cachedBrackets.elite.length === 0 && cachedBrackets.contender.length > 0) {
                const allAgentsBracket: TournamentBracket = {
                    id: 'contender',
                    label: 'Tournament Bracket',
                    percentLabel: 'All Agents',
                    description: 'All tournament participants.',
                    agents: mapAgents(contenderAgents),
                    eloRange: getRange(contenderAgents),
                };

                return NextResponse.json({
                    success: true,
                    brackets: total >= 2 ? [allAgentsBracket] : [],
                    totalAgents: total,
                });
            }

            const brackets: TournamentBracket[] = [
                {
                    id: 'challenger',
                    label: 'Challenger Bracket',
                    percentLabel: 'Bottom 25%',
                    description: 'Entry ladder for newer agents building their rating.',
                    agents: mapAgents(challengerAgents),
                    eloRange: getRange(challengerAgents),
                },
                {
                    id: 'contender',
                    label: 'Contender Bracket',
                    percentLabel: 'Middle 50%',
                    description: 'Main tournament field battling for promotion.',
                    agents: mapAgents(contenderAgents),
                    eloRange: getRange(contenderAgents),
                },
                {
                    id: 'elite',
                    label: 'Elite Bracket',
                    percentLabel: 'Top 25%',
                    description: 'Premier bracket for the highest rated agents.',
                    agents: mapAgents(eliteAgents),
                    eloRange: getRange(eliteAgents),
                },
            ];

            const activeBrackets = brackets.filter((b) => b.agents.length >= 2);

            return NextResponse.json({
                success: true,
                brackets: activeBrackets,
                totalAgents: total,
            });
        }

        // Fallback to dynamic calculation if no cache (tournament not started)
        // Filter to only active agents for dynamic calculation
        const activeAgents = Array.from(bestByAgent.values()).filter(
            r => r.agent.active
        );

        // Sort by ELO ascending for bracket splitting
        const sorted = activeAgents.sort(
            (a, b) => a.eloRating - b.eloRating
        ) as RankingWithAgent[];

        const total = sorted.length;

        // If fewer than 8 agents total, all go to contender bracket (match backend logic)
        if (total < 8) {
            const allAgentsBracket: TournamentBracket = {
                id: 'contender',
                label: 'Tournament Bracket',
                percentLabel: 'All Agents',
                description: 'All tournament participants.',
                agents: mapAgents(sorted),
                eloRange: getRange(sorted),
            };

            return NextResponse.json({
                success: true,
                brackets: total >= 2 ? [allAgentsBracket] : [],
                totalAgents: total,
            });
        }

        // Calculate bracket boundaries
        const bottom25End = Math.max(1, Math.round(total * 0.25));
        const top25Start = Math.max(bottom25End, Math.round(total * 0.75));

        // Split into brackets
        const challengerSlice = sorted.slice(0, bottom25End);
        const contenderSlice = sorted.slice(bottom25End, top25Start);
        const eliteSlice = sorted.slice(top25Start);

        const brackets: TournamentBracket[] = [
            {
                id: 'challenger',
                label: 'Challenger Bracket',
                percentLabel: 'Bottom 25%',
                description: 'Entry ladder for newer agents building their rating.',
                agents: mapAgents(challengerSlice),
                eloRange: getRange(challengerSlice),
            },
            {
                id: 'contender',
                label: 'Contender Bracket',
                percentLabel: 'Middle 50%',
                description: 'Main tournament field battling for promotion.',
                agents: mapAgents(contenderSlice),
                eloRange: getRange(contenderSlice),
            },
            {
                id: 'elite',
                label: 'Elite Bracket',
                percentLabel: 'Top 25%',
                description: 'Premier bracket for the highest rated agents.',
                agents: mapAgents(eliteSlice),
                eloRange: getRange(eliteSlice),
            },
        ];

        // Filter out brackets with fewer than 2 agents (need at least 2 for a match)
        const activeBrackets = brackets.filter((b) => b.agents.length >= 2);

        return NextResponse.json({
            success: true,
            brackets: activeBrackets,
            totalAgents: total,
        });
    } catch (error) {
        console.error('Error fetching tournament brackets:', error);
        return NextResponse.json(
            { error: 'Failed to fetch tournament brackets' },
            { status: 500 }
        );
    }
}
