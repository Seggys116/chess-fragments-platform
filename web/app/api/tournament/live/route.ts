import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const bracketId = searchParams.get('bracket'); // challenger, contender, elite

        if (!bracketId || !['challenger', 'contender', 'elite'].includes(bracketId)) {
            return NextResponse.json(
                { error: 'Invalid bracket ID. Must be challenger, contender, or elite.' },
                { status: 400 }
            );
        }

        // Fetch all active agents with rankings for bracket calculation
        const rankings = await prisma.ranking.findMany({
            where: {
                gamesPlayed: { gt: 0 },
                agent: { active: true },
            },
            include: { agent: true },
            orderBy: { eloRating: 'asc' },
        });

        // Dedupe by agent
        const bestByAgent = new Map<string, typeof rankings[number]>();
        for (const ranking of rankings) {
            if (!ranking.agent.active) continue;
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
        let bracketAgentIds: string[] = [];

        // If fewer than 8 agents, everyone is in "contender" as single bracket
        if (total < 8) {
            if (bracketId === 'contender') {
                bracketAgentIds = sorted.map((r) => r.agentId);
            }
            // Other brackets are empty when < 8 agents
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
                match: null,
                bracket: bracketId,
                queuedMatches: [],
                recentMatches: [],
            });
        }

        // Fetch live tournament match for this bracket (in_progress status)
        const liveMatch = await prisma.match.findFirst({
            where: {
                matchType: 'tournament',
                status: 'in_progress',
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
                gameStates: {
                    orderBy: { moveNumber: 'asc' },
                },
            },
            orderBy: { startedAt: 'desc' },
        });

        // Fetch pending/queued matches for this bracket
        const queuedMatches = await prisma.match.findMany({
            where: {
                matchType: 'tournament',
                status: 'pending',
                whiteAgentId: { in: bracketAgentIds },
                blackAgentId: { in: bracketAgentIds },
            },
            include: {
                whiteAgent: true,
                blackAgent: true,
            },
            orderBy: { createdAt: 'asc' },
            take: 5,
        });

        // Fetch recently completed matches (last 60 seconds)
        const recentCutoff = new Date(Date.now() - 60 * 1000);
        const recentMatches = await prisma.match.findMany({
            where: {
                matchType: 'tournament',
                status: 'completed',
                whiteAgentId: { in: bracketAgentIds },
                blackAgentId: { in: bracketAgentIds },
                completedAt: { gte: recentCutoff },
            },
            include: {
                whiteAgent: true,
                blackAgent: true,
            },
            orderBy: { completedAt: 'desc' },
            take: 5,
        });

        const queuedMatchesData = queuedMatches.map((m) => ({
            id: m.id,
            status: m.status,
            whiteAgent: {
                id: m.whiteAgent.id,
                name: m.whiteAgent.name,
                version: m.whiteAgent.version,
            },
            blackAgent: {
                id: m.blackAgent.id,
                name: m.blackAgent.name,
                version: m.blackAgent.version,
            },
        }));

        const recentMatchesData = recentMatches.map((m) => ({
            id: m.id,
            winner: m.winner,
            moves: m.moves,
            whiteAgent: {
                id: m.whiteAgent.id,
                name: m.whiteAgent.name,
            },
            blackAgent: {
                id: m.blackAgent.id,
                name: m.blackAgent.name,
            },
            completedAt: m.completedAt?.toISOString() || null,
        }));

        if (!liveMatch) {
            return NextResponse.json({
                success: true,
                match: null,
                bracket: bracketId,
                queuedMatches: queuedMatchesData,
                recentMatches: recentMatchesData,
            });
        }

        const matchData = {
            id: liveMatch.id,
            status: liveMatch.status,
            moves: liveMatch.moves,
            winner: liveMatch.winner,
            termination: liveMatch.termination,
            whiteAgent: {
                id: liveMatch.whiteAgent.id,
                name: liveMatch.whiteAgent.name,
                version: liveMatch.whiteAgent.version,
                eloRating: liveMatch.whiteAgent.ranking?.eloRating ?? 1500,
            },
            blackAgent: {
                id: liveMatch.blackAgent.id,
                name: liveMatch.blackAgent.name,
                version: liveMatch.blackAgent.version,
                eloRating: liveMatch.blackAgent.ranking?.eloRating ?? 1500,
            },
            startedAt: liveMatch.startedAt,
            currentMove: liveMatch.gameStates.length,
            gameStates: liveMatch.gameStates.map((gs) => ({
                moveNumber: gs.moveNumber,
                boardState: gs.boardState,
                moveTimeMs: gs.moveTimeMs,
                moveNotation: gs.moveNotation,
                evaluation: gs.evaluation,
            })),
        };

        return NextResponse.json({
            success: true,
            match: matchData,
            bracket: bracketId,
            queuedMatches: queuedMatchesData,
            recentMatches: recentMatchesData,
        });
    } catch (error) {
        console.error('Error fetching live tournament match:', error);
        return NextResponse.json(
            { error: 'Failed to fetch live tournament match' },
            { status: 500 }
        );
    }
}
