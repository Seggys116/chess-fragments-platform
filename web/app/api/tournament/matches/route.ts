import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

interface SwissStanding {
    agentId: string;
    points: number;
    matchesPlayed: number;
    buchholz: number;
    opponents: string[];
}

function computeSwissStandings(
    bracketAgentIds: string[],
    matches: Array<{ whiteAgentId: string; blackAgentId: string; winner: string | null; status: string }>
): SwissStanding[] {
    // Initialize standings for all agents
    const standings: Record<string, SwissStanding> = {};
    for (const agentId of bracketAgentIds) {
        standings[agentId] = {
            agentId,
            points: 0,
            matchesPlayed: 0,
            buchholz: 0,
            opponents: [],
        };
    }

    // Process completed matches
    for (const match of matches) {
        if (match.status !== 'completed') continue;

        const whiteId = match.whiteAgentId;
        const blackId = match.blackAgentId;

        if (!standings[whiteId] || !standings[blackId]) continue;

        // Update opponents (only if not already recorded)
        if (!standings[whiteId].opponents.includes(blackId)) {
            standings[whiteId].opponents.push(blackId);
            standings[whiteId].matchesPlayed++;
        }
        if (!standings[blackId].opponents.includes(whiteId)) {
            standings[blackId].opponents.push(whiteId);
            standings[blackId].matchesPlayed++;
        }

        // Update points
        if (match.winner === 'white') {
            standings[whiteId].points += 1;
        } else if (match.winner === 'black') {
            standings[blackId].points += 1;
        } else {
            // Draw
            standings[whiteId].points += 0.5;
            standings[blackId].points += 0.5;
        }
    }

    // Calculate Buchholz (sum of opponents' points)
    for (const agentId of Object.keys(standings)) {
        let buchholz = 0;
        for (const oppId of standings[agentId].opponents) {
            if (standings[oppId]) {
                buchholz += standings[oppId].points;
            }
        }
        standings[agentId].buchholz = buchholz;
    }

    // Convert to array and sort by points desc, buchholz desc
    return Object.values(standings).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return b.buchholz - a.buchholz;
    });
}

function calculateTotalRounds(numAgents: number): number {
    if (numAgents < 2) return 0;
    // For Swiss: min of ceil(log2(n)) and (n-1) since each player can only play n-1 unique opponents
    const logRounds = Math.ceil(Math.log2(numAgents));
    const maxPossibleRounds = numAgents - 1;
    // Use at least 3 rounds if we have enough agents, but cap at max possible
    return Math.min(Math.max(3, logRounds), maxPossibleRounds);
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const bracketId = searchParams.get('bracket'); // challenger, contender, elite
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');

        if (!bracketId || !['challenger', 'contender', 'elite'].includes(bracketId)) {
            return NextResponse.json(
                { error: 'Invalid bracket ID. Must be challenger, contender, or elite.' },
                { status: 400 }
            );
        }

        // Fetch all active SERVER agents with rankings for bracket calculation
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

        const total = sorted.length;

        // Get agent IDs for the requested bracket
        // IMPORTANT: Match the backend logic - if < 8 agents, all go to contender
        let bracketAgentIds: string[] = [];

        if (total < 8) {
            // All agents go to contender when < 8 total
            if (bracketId === 'contender') {
                bracketAgentIds = sorted.map((r) => r.agentId);
            }
            // challenger and elite are empty when < 8 agents
        } else {
            const bottom25End = Math.max(1, Math.round(total * 0.25));
            const top25Start = Math.max(bottom25End, Math.round(total * 0.75));

            if (bracketId === 'challenger') {
                bracketAgentIds = sorted.slice(0, bottom25End).map((r) => r.agentId);
            } else if (bracketId === 'contender') {
                bracketAgentIds = sorted.slice(bottom25End, top25Start).map((r) => r.agentId);
            } else if (bracketId === 'elite') {
                bracketAgentIds = sorted.slice(top25Start).map((r) => r.agentId);
            }
        }

        if (bracketAgentIds.length === 0) {
            return NextResponse.json({
                success: true,
                matches: [],
                standings: [],
                currentRound: 0,
                totalRounds: 0,
                tournamentComplete: true,
                total: 0,
                bracket: bracketId,
            });
        }

        // Fetch tournament matches for this bracket
        const matches = await prisma.match.findMany({
            where: {
                matchType: 'tournament',
                whiteAgentId: { in: bracketAgentIds },
                blackAgentId: { in: bracketAgentIds },
            },
            include: {
                whiteAgent: {
                    include: { ranking: true },
                },
                blackAgent: {
                    include: { ranking: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
        });

        // Also get ALL matches for standings calculation
        const allMatches = await prisma.match.findMany({
            where: {
                matchType: 'tournament',
                whiteAgentId: { in: bracketAgentIds },
                blackAgentId: { in: bracketAgentIds },
            },
            select: {
                whiteAgentId: true,
                blackAgentId: true,
                winner: true,
                status: true,
            },
        });

        const totalMatches = await prisma.match.count({
            where: {
                matchType: 'tournament',
                whiteAgentId: { in: bracketAgentIds },
                blackAgentId: { in: bracketAgentIds },
            },
        });

        // Compute Swiss standings
        const standings = computeSwissStandings(bracketAgentIds, allMatches);

        // Calculate round info
        const totalRounds = calculateTotalRounds(bracketAgentIds.length);
        const maxMatchesPlayed = standings.length > 0 ? Math.max(...standings.map(s => s.matchesPlayed)) : 0;
        const minMatchesPlayed = standings.length > 0 ? Math.min(...standings.map(s => s.matchesPlayed)) : 0;

        // Current round: if everyone has played same number of matches, we're in next round
        // Otherwise we're still in the current round (some matches pending)
        const currentRound = minMatchesPlayed === maxMatchesPlayed
            ? Math.min(maxMatchesPlayed + 1, totalRounds)
            : Math.min(maxMatchesPlayed, totalRounds);

        // Tournament complete when everyone has played totalRounds matches
        const tournamentComplete = minMatchesPlayed >= totalRounds;

        // Map matches for response
        const matchList = matches.map((match) => ({
            id: match.id,
            status: match.status,
            winner: match.winner,
            moves: match.moves,
            termination: match.termination,
            whiteAgent: {
                id: match.whiteAgent.id,
                name: match.whiteAgent.name,
                version: match.whiteAgent.version,
                eloRating: match.whiteAgent.ranking?.eloRating ?? 1500,
            },
            blackAgent: {
                id: match.blackAgent.id,
                name: match.blackAgent.name,
                version: match.blackAgent.version,
                eloRating: match.blackAgent.ranking?.eloRating ?? 1500,
            },
            startedAt: match.startedAt,
            completedAt: match.completedAt,
            createdAt: match.createdAt,
        }));

        return NextResponse.json({
            success: true,
            matches: matchList,
            standings,
            currentRound,
            totalRounds,
            tournamentComplete,
            total: totalMatches,
            bracket: bracketId,
            agentCount: bracketAgentIds.length,
            limit,
            offset,
        });
    } catch (error) {
        console.error('Error fetching tournament matches:', error);
        return NextResponse.json(
            { error: 'Failed to fetch tournament matches' },
            { status: 500 }
        );
    }
}
