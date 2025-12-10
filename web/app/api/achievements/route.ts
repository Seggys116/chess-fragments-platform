import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

interface AchievementHolder {
    agentId: string;
    agentName: string;
    agentVersion: number;
}

interface Achievement {
    id: string;
    title: string;
    description: string;
    value: string | number;
    category: 'streak' | 'speed' | 'victory' | 'endurance' | 'strategy';
    holders: AchievementHolder[];
    totalHolders: number;
}

export async function GET() {
    try {
        const achievements: Achievement[] = [];

        // Get all uploaded (server) agents with rankings - excludes linked (local) agents
        const agents = await prisma.agent.findMany({
            where: {
                active: true,
                executionMode: 'server',
            },
            include: {
                ranking: true,
            },
        });

        const agentMap = new Map(agents.map(a => [a.id, a]));

        // Helper to create achievement with multiple holders
        const createAchievement = (
            id: string,
            title: string,
            description: string,
            value: string | number,
            category: Achievement['category'],
            holderIds: string[]
        ) => {
            const holders: AchievementHolder[] = [];
            for (const agentId of holderIds) {
                const agent = agentMap.get(agentId);
                if (agent) {
                    holders.push({
                        agentId: agent.id,
                        agentName: agent.name,
                        agentVersion: agent.version,
                    });
                }
            }
            if (holders.length > 0) {
                achievements.push({
                    id,
                    title,
                    description,
                    value,
                    category,
                    holders,
                    totalHolders: holders.length,
                });
            }
        };

        // ==================== STREAK ACHIEVEMENTS ====================

        // 1. Most Consecutive Wins
        const eloHistory = await prisma.eloHistory.findMany({
            orderBy: [
                { agentId: 'asc' },
                { createdAt: 'asc' },
            ],
        });

        const streaksByAgent = new Map<string, { current: number; max: number }>();
        for (const record of eloHistory) {
            if (!streaksByAgent.has(record.agentId)) {
                streaksByAgent.set(record.agentId, { current: 0, max: 0 });
            }
            const streak = streaksByAgent.get(record.agentId)!;
            if (record.result === 'win') {
                streak.current++;
                streak.max = Math.max(streak.max, streak.current);
            } else {
                streak.current = 0;
            }
        }

        let maxStreak = 0;
        for (const [, streak] of streaksByAgent) {
            maxStreak = Math.max(maxStreak, streak.max);
        }
        if (maxStreak >= 2) {
            const streakHolders = Array.from(streaksByAgent.entries())
                .filter(([, s]) => s.max === maxStreak)
                .map(([id]) => id);
            createAchievement('consecutive-wins', 'Win Streak Champion', 'Most consecutive wins', `${maxStreak} wins`, 'streak', streakHolders);
        }

        // 2. Current Hot Streak (currently on a streak)
        let maxCurrentStreak = 0;
        for (const [, streak] of streaksByAgent) {
            maxCurrentStreak = Math.max(maxCurrentStreak, streak.current);
        }
        if (maxCurrentStreak >= 3) {
            const hotStreakHolders = Array.from(streaksByAgent.entries())
                .filter(([, s]) => s.current === maxCurrentStreak)
                .map(([id]) => id);
            createAchievement('hot-streak', 'On Fire', 'Currently on a winning streak', `${maxCurrentStreak} in a row`, 'streak', hotStreakHolders);
        }

        // 3. Undefeated (no losses, min 5 games)
        const undefeatedAgents = agents
            .filter(a => a.ranking && a.ranking.gamesPlayed >= 5 && a.ranking.losses === 0)
            .map(a => a.id);
        if (undefeatedAgents.length > 0) {
            createAchievement('undefeated', 'Undefeated', 'No losses with 5+ games played', 'Perfect record', 'streak', undefeatedAgents);
        }

        // ==================== SPEED ACHIEVEMENTS ====================

        // 4. Fastest Agent
        const fastestAgents = agents
            .filter(a => a.ranking && a.ranking.avgMoveTimeMs && a.ranking.gamesPlayed >= 5)
            .sort((a, b) => (a.ranking!.avgMoveTimeMs || Infinity) - (b.ranking!.avgMoveTimeMs || Infinity));

        if (fastestAgents.length > 0) {
            const fastestTime = fastestAgents[0].ranking!.avgMoveTimeMs;
            const fastestHolders = fastestAgents
                .filter(a => a.ranking!.avgMoveTimeMs === fastestTime)
                .map(a => a.id);
            createAchievement('fastest-agent', 'Speed Demon', 'Fastest average move time (min 5 games)', `${fastestTime}ms avg`, 'speed', fastestHolders);
        }

        // 5. Quickest Victory
        const quickestWins = await prisma.match.findMany({
            where: {
                status: 'completed',
                winner: { in: ['white', 'black'] },
                moves: { gt: 0 },
            },
            include: {
                whiteAgent: true,
                blackAgent: true,
            },
            orderBy: { moves: 'asc' },
            take: 20,
        });

        if (quickestWins.length > 0) {
            const minMoves = quickestWins[0].moves;
            const quickestHolders = quickestWins
                .filter(m => m.moves === minMoves)
                .map(m => m.winner === 'white' ? m.whiteAgent.id : m.blackAgent.id);
            createAchievement('quickest-victory', 'Lightning Strike', 'Fastest victory by move count', `${minMoves} moves`, 'speed', [...new Set(quickestHolders)]);
        }

        // 6. Blitz Master (fastest single move time in a game)
        const fastestMoves = await prisma.gameState.findMany({
            where: {
                moveTimeMs: { gt: 0 },
            },
            include: {
                match: {
                    include: {
                        whiteAgent: true,
                        blackAgent: true,
                    },
                },
            },
            orderBy: { moveTimeMs: 'asc' },
            take: 10,
        });

        if (fastestMoves.length > 0) {
            const fastestMoveTime = fastestMoves[0].moveTimeMs;
            const blitzHolders: string[] = [];
            for (const gs of fastestMoves) {
                if (gs.moveTimeMs === fastestMoveTime) {
                    // Determine who made the move based on move number
                    const isWhiteMove = gs.moveNumber % 2 === 1;
                    blitzHolders.push(isWhiteMove ? gs.match.whiteAgent.id : gs.match.blackAgent.id);
                }
            }
            createAchievement('blitz-master', 'Blitz Master', 'Fastest single move recorded', `${fastestMoveTime}ms`, 'speed', [...new Set(blitzHolders)]);
        }

        // ==================== VICTORY ACHIEVEMENTS ====================

        // 7. Highest ELO
        const highestElo = agents
            .filter(a => a.ranking)
            .sort((a, b) => (b.ranking?.eloRating || 0) - (a.ranking?.eloRating || 0));

        if (highestElo.length > 0 && highestElo[0].ranking) {
            const topElo = highestElo[0].ranking.eloRating;
            const eloHolders = highestElo
                .filter(a => a.ranking?.eloRating === topElo)
                .map(a => a.id);
            createAchievement('highest-elo', 'Peak Performance', 'Highest current ELO rating', `${topElo} ELO`, 'victory', eloHolders);
        }

        // 8. Best Win Rate
        const winRates = agents
            .filter(a => a.ranking && a.ranking.gamesPlayed >= 10)
            .map(a => ({
                id: a.id,
                winRate: Math.round((a.ranking!.wins / a.ranking!.gamesPlayed) * 1000) / 10,
            }))
            .sort((a, b) => b.winRate - a.winRate);

        if (winRates.length > 0) {
            const topRate = winRates[0].winRate;
            const rateHolders = winRates.filter(a => a.winRate === topRate).map(a => a.id);
            createAchievement('best-win-rate', 'Dominator', 'Highest win rate (min 10 games)', `${topRate}%`, 'victory', rateHolders);
        }

        // 9. Most Checkmates
        const checkmateWins = await prisma.match.groupBy({
            by: ['whiteAgentId'],
            where: { status: 'completed', winner: 'white', termination: 'checkmate' },
            _count: true,
        });
        const blackCheckmateWins = await prisma.match.groupBy({
            by: ['blackAgentId'],
            where: { status: 'completed', winner: 'black', termination: 'checkmate' },
            _count: true,
        });

        const checkmateCountByAgent = new Map<string, number>();
        for (const w of checkmateWins) {
            checkmateCountByAgent.set(w.whiteAgentId, (checkmateCountByAgent.get(w.whiteAgentId) || 0) + w._count);
        }
        for (const b of blackCheckmateWins) {
            checkmateCountByAgent.set(b.blackAgentId, (checkmateCountByAgent.get(b.blackAgentId) || 0) + b._count);
        }

        let maxCheckmates = 0;
        for (const [, count] of checkmateCountByAgent) {
            maxCheckmates = Math.max(maxCheckmates, count);
        }
        if (maxCheckmates >= 1) {
            const checkmateHolders = Array.from(checkmateCountByAgent.entries())
                .filter(([, c]) => c === maxCheckmates)
                .map(([id]) => id);
            createAchievement('most-checkmates', 'Checkmate Master', 'Most wins by checkmate', `${maxCheckmates} checkmates`, 'victory', checkmateHolders);
        }

        // 10. Giant Slayer (biggest ELO gain)
        const biggestGains = await prisma.eloHistory.findMany({
            where: { result: 'win', eloChange: { gt: 0 } },
            orderBy: { eloChange: 'desc' },
            take: 10,
        });

        if (biggestGains.length > 0) {
            const maxGain = biggestGains[0].eloChange;
            const giantSlayers = biggestGains.filter(g => g.eloChange === maxGain).map(g => g.agentId);
            createAchievement('biggest-upset', 'Giant Slayer', 'Biggest ELO gain from a single match', `+${maxGain} ELO`, 'victory', [...new Set(giantSlayers)]);
        }

        // 11. Most Wins Total
        const mostWins = agents
            .filter(a => a.ranking && a.ranking.wins > 0)
            .sort((a, b) => (b.ranking?.wins || 0) - (a.ranking?.wins || 0));

        if (mostWins.length > 0 && mostWins[0].ranking) {
            const topWins = mostWins[0].ranking.wins;
            const winHolders = mostWins.filter(a => a.ranking?.wins === topWins).map(a => a.id);
            createAchievement('most-wins', 'Victory Collector', 'Most total wins', `${topWins} wins`, 'victory', winHolders);
        }

        // ==================== ENDURANCE ACHIEVEMENTS ====================

        // 12. Most Games Played
        const mostGamesPlayed = agents
            .filter(a => a.ranking)
            .sort((a, b) => (b.ranking?.gamesPlayed || 0) - (a.ranking?.gamesPlayed || 0));

        if (mostGamesPlayed.length > 0 && mostGamesPlayed[0].ranking) {
            const topGames = mostGamesPlayed[0].ranking.gamesPlayed;
            const gameHolders = mostGamesPlayed.filter(a => a.ranking?.gamesPlayed === topGames).map(a => a.id);
            createAchievement('most-games', 'Iron Will', 'Most games played overall', `${topGames} games`, 'endurance', gameHolders);
        }

        // 13. Longest Game
        const longestGames = await prisma.match.findMany({
            where: { status: 'completed' },
            include: { whiteAgent: true, blackAgent: true },
            orderBy: { moves: 'desc' },
            take: 10,
        });

        if (longestGames.length > 0) {
            const maxMoves = longestGames[0].moves;
            const marathonHolders: string[] = [];
            for (const game of longestGames) {
                if (game.moves === maxMoves) {
                    // Both participants get credit for endurance
                    marathonHolders.push(game.whiteAgent.id, game.blackAgent.id);
                }
            }
            createAchievement('longest-game', 'Marathon Runner', 'Participated in the longest game', `${maxMoves} moves`, 'endurance', [...new Set(marathonHolders)]);
        }

        // 14. Draw Specialist
        const mostDraws = agents
            .filter(a => a.ranking && a.ranking.draws > 0)
            .sort((a, b) => (b.ranking?.draws || 0) - (a.ranking?.draws || 0));

        if (mostDraws.length > 0 && mostDraws[0].ranking && mostDraws[0].ranking.draws >= 2) {
            const topDraws = mostDraws[0].ranking.draws;
            const drawHolders = mostDraws.filter(a => a.ranking?.draws === topDraws).map(a => a.id);
            createAchievement('draw-specialist', 'The Equalizer', 'Most draws achieved', `${topDraws} draws`, 'endurance', drawHolders);
        }

        // 15. Survivor (most losses but still playing)
        const survivors = agents
            .filter(a => a.ranking && a.ranking.losses >= 5 && a.ranking.gamesPlayed >= 10)
            .sort((a, b) => (b.ranking?.losses || 0) - (a.ranking?.losses || 0));

        if (survivors.length > 0 && survivors[0].ranking) {
            const topLosses = survivors[0].ranking.losses;
            const survivorHolders = survivors.filter(a => a.ranking?.losses === topLosses).map(a => a.id);
            createAchievement('survivor', 'Never Give Up', 'Most losses but still competing', `${topLosses} losses`, 'endurance', survivorHolders);
        }

        // ==================== STRATEGY ACHIEVEMENTS ====================

        // 16. White Specialist (best as white)
        const whiteWins = await prisma.match.groupBy({
            by: ['whiteAgentId'],
            where: { status: 'completed', winner: 'white' },
            _count: true,
        });
        const whiteGames = await prisma.match.groupBy({
            by: ['whiteAgentId'],
            where: { status: 'completed' },
            _count: true,
        });

        const whiteWinRates = new Map<string, { wins: number; games: number; rate: number }>();
        for (const g of whiteGames) {
            const wins = whiteWins.find(w => w.whiteAgentId === g.whiteAgentId)?._count || 0;
            if (g._count >= 5) {
                whiteWinRates.set(g.whiteAgentId, {
                    wins,
                    games: g._count,
                    rate: Math.round((wins / g._count) * 1000) / 10,
                });
            }
        }

        let maxWhiteRate = 0;
        for (const [, data] of whiteWinRates) {
            maxWhiteRate = Math.max(maxWhiteRate, data.rate);
        }
        if (maxWhiteRate >= 60) {
            const whiteHolders = Array.from(whiteWinRates.entries())
                .filter(([, d]) => d.rate === maxWhiteRate)
                .map(([id]) => id);
            createAchievement('white-specialist', 'First Mover', 'Best win rate as white (min 5 games)', `${maxWhiteRate}%`, 'strategy', whiteHolders);
        }

        // 17. Black Specialist (best as black)
        const blackWins = await prisma.match.groupBy({
            by: ['blackAgentId'],
            where: { status: 'completed', winner: 'black' },
            _count: true,
        });
        const blackGames = await prisma.match.groupBy({
            by: ['blackAgentId'],
            where: { status: 'completed' },
            _count: true,
        });

        const blackWinRates = new Map<string, { wins: number; games: number; rate: number }>();
        for (const g of blackGames) {
            const wins = blackWins.find(w => w.blackAgentId === g.blackAgentId)?._count || 0;
            if (g._count >= 5) {
                blackWinRates.set(g.blackAgentId, {
                    wins,
                    games: g._count,
                    rate: Math.round((wins / g._count) * 1000) / 10,
                });
            }
        }

        let maxBlackRate = 0;
        for (const [, data] of blackWinRates) {
            maxBlackRate = Math.max(maxBlackRate, data.rate);
        }
        if (maxBlackRate >= 50) {
            const blackHolders = Array.from(blackWinRates.entries())
                .filter(([, d]) => d.rate === maxBlackRate)
                .map(([id]) => id);
            createAchievement('black-specialist', 'Counter Striker', 'Best win rate as black (min 5 games)', `${maxBlackRate}%`, 'strategy', blackHolders);
        }

        // 18. Efficient (best win rate with fewest average moves)
        const efficientAgents = agents
            .filter(a => a.ranking && a.ranking.gamesPlayed >= 5 && a.ranking.wins >= 3);
        // This would require more complex query - simplified for now

        // 19. Consistent (lowest ELO variance)
        // Would need to track ELO history variance

        // 20. Rising Star (biggest ELO gain from starting)
        const risingStars = agents
            .filter(a => a.ranking && a.ranking.gamesPlayed >= 5)
            .map(a => ({
                id: a.id,
                gain: (a.ranking?.eloRating || 1500) - 1500,
            }))
            .filter(a => a.gain > 0)
            .sort((a, b) => b.gain - a.gain);

        if (risingStars.length > 0) {
            const topGain = risingStars[0].gain;
            const risingHolders = risingStars.filter(a => a.gain === topGain).map(a => a.id);
            createAchievement('rising-star', 'Rising Star', 'Biggest ELO gain from starting rating', `+${topGain} ELO`, 'strategy', risingHolders);
        }

        return NextResponse.json({
            success: true,
            achievements,
        });
    } catch (error) {
        console.error('Error fetching statistics:', error);
        return NextResponse.json(
            { error: 'Failed to fetch statistics' },
            { status: 500 }
        );
    }
}
