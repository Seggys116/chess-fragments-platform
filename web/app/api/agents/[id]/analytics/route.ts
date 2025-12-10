import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);

        const h2hLimit = Math.min(Math.max(parseInt(searchParams.get('h2hLimit') || '10'), 1), 100);
        const h2hOffset = Math.max(parseInt(searchParams.get('h2hOffset') || '0'), 0);

        const user = await getUserFromRequest(request);

        if (!user) {
            return NextResponse.json(
                { error: 'Authentication required' },
                { status: 401 }
            );
        }

        const agent = await prisma.agent.findUnique({
            where: { id },
            include: {
                ranking: true,
                user: {
                    select: {
                        id: true,
                    }
                }
            },
        });

        if (!agent) {
            return NextResponse.json(
                { error: 'Agent not found' },
                { status: 404 }
            );
        }

        if (agent.user.id !== user.id) {
            return NextResponse.json(
                { error: 'Unauthorized - You can only view analytics for your own agents' },
                { status: 403 }
            );
        }

        const moveTimeStatsResult = await prisma.$queryRaw<Array<{
            min: number | null;
            max: number | null;
            avg: number | null;
            stddev: number | null;
            count: bigint;
            timeout_count: bigint;
        }>>`
      SELECT
        MIN(gs.move_time_ms) FILTER (WHERE gs.move_time_ms > 0 AND gs.move_time_ms <= 14000)::float as min,
        MAX(gs.move_time_ms) FILTER (WHERE gs.move_time_ms > 0 AND gs.move_time_ms <= 14000)::float as max,
        AVG(gs.move_time_ms) FILTER (WHERE gs.move_time_ms > 0 AND gs.move_time_ms <= 14000)::float as avg,
        STDDEV(gs.move_time_ms) FILTER (WHERE gs.move_time_ms > 0 AND gs.move_time_ms <= 14000)::float as stddev,
        COUNT(*) FILTER (WHERE gs.move_time_ms IS NOT NULL AND gs.move_time_ms > 0 AND gs.move_time_ms <= 14000) as count,
        COUNT(*) FILTER (WHERE gs.move_time_ms IS NULL OR gs.move_time_ms > 14000) as timeout_count
      FROM game_states gs
      INNER JOIN matches m ON gs.match_id = m.id
      WHERE (m.white_agent_id = ${id} OR m.black_agent_id = ${id})
        AND m.status = 'completed'
        AND (
          (m.white_agent_id = ${id} AND gs.move_number % 2 = 1) OR
          (m.black_agent_id = ${id} AND gs.move_number % 2 = 0)
        )
    `;

        const moveTimeStats = moveTimeStatsResult[0] ? {
            min: moveTimeStatsResult[0].min !== null ? Math.round(moveTimeStatsResult[0].min * 100) / 100 : null,
            max: moveTimeStatsResult[0].max !== null ? Math.round(moveTimeStatsResult[0].max * 100) / 100 : null,
            avg: moveTimeStatsResult[0].avg !== null ? Math.round(moveTimeStatsResult[0].avg * 100) / 100 : null,
            stdDev: moveTimeStatsResult[0].stddev !== null ? Math.round(moveTimeStatsResult[0].stddev * 100) / 100 : null,
            count: Number(moveTimeStatsResult[0].count),
            timeoutCount: Number(moveTimeStatsResult[0].timeout_count),
            timeoutPercentage: (Number(moveTimeStatsResult[0].count) + Number(moveTimeStatsResult[0].timeout_count)) > 0
                ? Math.round((Number(moveTimeStatsResult[0].timeout_count) / (Number(moveTimeStatsResult[0].count) + Number(moveTimeStatsResult[0].timeout_count))) * 10000) / 100
                : 0,
        } : { min: null, max: null, avg: null, stdDev: null, count: 0, timeoutCount: 0, timeoutPercentage: 0 };

        const evaluationStatsResult = await prisma.$queryRaw<Array<{
            min: number | null;
            max: number | null;
            avg: number | null;
            stddev: number | null;
            count: bigint;
        }>>`
      SELECT
        MIN(CASE WHEN m.white_agent_id = ${id} THEN gs.evaluation ELSE -gs.evaluation END)::float as min,
        MAX(CASE WHEN m.white_agent_id = ${id} THEN gs.evaluation ELSE -gs.evaluation END)::float as max,
        AVG(CASE WHEN m.white_agent_id = ${id} THEN gs.evaluation ELSE -gs.evaluation END)::float as avg,
        STDDEV(CASE WHEN m.white_agent_id = ${id} THEN gs.evaluation ELSE -gs.evaluation END)::float as stddev,
        COUNT(gs.evaluation) as count
      FROM game_states gs
      INNER JOIN matches m ON gs.match_id = m.id
      WHERE (m.white_agent_id = ${id} OR m.black_agent_id = ${id})
        AND m.status = 'completed'
        AND gs.evaluation IS NOT NULL
    `;

        const evaluationStats = evaluationStatsResult[0] ? {
            min: evaluationStatsResult[0].min ? Math.round(evaluationStatsResult[0].min * 100) / 100 : null,
            max: evaluationStatsResult[0].max ? Math.round(evaluationStatsResult[0].max * 100) / 100 : null,
            avg: evaluationStatsResult[0].avg ? Math.round(evaluationStatsResult[0].avg * 100) / 100 : null,
            stdDev: evaluationStatsResult[0].stddev ? Math.round(evaluationStatsResult[0].stddev * 100) / 100 : null,
            count: Number(evaluationStatsResult[0].count),
        } : { min: null, max: null, avg: null, stdDev: null, count: 0 };

        const totalMatches = await prisma.match.count({
            where: {
                OR: [
                    { whiteAgentId: id },
                    { blackAgentId: id },
                ],
                status: 'completed',
            },
        });

        const recentMatches = await prisma.match.findMany({
            where: {
                OR: [
                    { whiteAgentId: id },
                    { blackAgentId: id },
                ],
                status: 'completed',
            },
            include: {
                whiteAgent: { select: { name: true, version: true } },
                blackAgent: { select: { name: true, version: true } },
                gameStates: {
                    select: {
                        moveNumber: true,
                        moveTimeMs: true,
                    },
                    where: {
                        moveTimeMs: { not: null },
                    },
                },
            },
            orderBy: {
                completedAt: 'desc',
            },
            take: 20,
        });

        const performanceOverTime = recentMatches.reverse().map((match, index) => {
            const isWhite = match.whiteAgentId === id;
            const agentMoves = match.gameStates.filter((s) => {
                const isWhiteMove = s.moveNumber % 2 === 1;
                return isWhite ? isWhiteMove : !isWhiteMove;
            });

            // Exclude 0ms moves from average calculation
            const validMoves = agentMoves.filter(s => s.moveTimeMs && s.moveTimeMs > 0);
            const avgMoveTime = validMoves.length > 0
                ? validMoves.reduce((sum, s) => sum + (s.moveTimeMs || 0), 0) / validMoves.length
                : 0;

            return {
                matchNumber: index + 1,
                result: match.winner === null ? 'draw' :
                    (match.whiteAgentId === id && match.winner === 'white') ||
                        (match.blackAgentId === id && match.winner === 'black') ? 'win' : 'loss',
                opponent: match.whiteAgentId === id
                    ? `${match.blackAgent.name} v${match.blackAgent.version}`
                    : `${match.whiteAgent.name} v${match.whiteAgent.version}`,
                date: match.completedAt,
                avgMoveTime: Math.round(avgMoveTime),
            };
        });

        const h2hTotalResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT
        CASE WHEN m.white_agent_id = ${id} THEN m.black_agent_id ELSE m.white_agent_id END
      ) as count
      FROM matches m
      WHERE (m.white_agent_id = ${id} OR m.black_agent_id = ${id})
        AND m.status = 'completed'
    `;
        const h2hTotal = Number(h2hTotalResult[0]?.count || 0);

        const headToHeadResult = await prisma.$queryRaw<Array<{
            opponent_id: string;
            opponent_name: string;
            opponent_elo: number;
            wins: bigint;
            losses: bigint;
            draws: bigint;
            total: bigint;
            elo_change: bigint | null;
        }>>`
      WITH opponent_matches AS (
        SELECT
          CASE WHEN m.white_agent_id = ${id} THEN m.black_agent_id ELSE m.white_agent_id END as opponent_id,
          CASE
            WHEN m.winner IS NULL THEN 'draw'
            WHEN (m.white_agent_id = ${id} AND m.winner = 'white') OR (m.black_agent_id = ${id} AND m.winner = 'black') THEN 'win'
            ELSE 'loss'
          END as result,
          CASE
            WHEN m.white_agent_id = ${id} THEN a2.name || ' v' || a2.version
            ELSE a1.name || ' v' || a1.version
          END as opponent_name,
          m.id as match_id
        FROM matches m
        INNER JOIN agents a1 ON m.white_agent_id = a1.id
        INNER JOIN agents a2 ON m.black_agent_id = a2.id
        WHERE (m.white_agent_id = ${id} OR m.black_agent_id = ${id})
          AND m.status = 'completed'
      )
      SELECT
        om.opponent_id,
        MAX(om.opponent_name) as opponent_name,
        COALESCE(r.elo_rating, 1500) as opponent_elo,
        COUNT(*) FILTER (WHERE om.result = 'win') as wins,
        COUNT(*) FILTER (WHERE om.result = 'loss') as losses,
        COUNT(*) FILTER (WHERE om.result = 'draw') as draws,
        COUNT(*) as total,
        SUM(eh.elo_change) as elo_change
      FROM opponent_matches om
      LEFT JOIN rankings r ON om.opponent_id = r.agent_id
      LEFT JOIN elo_history eh ON eh.match_id = om.match_id AND eh.agent_id = ${id}
      GROUP BY om.opponent_id, r.elo_rating
      ORDER BY total DESC
      LIMIT ${h2hLimit}
      OFFSET ${h2hOffset}
    `;

        const headToHead = headToHeadResult.map(row => ({
            opponentId: row.opponent_id,
            opponentName: row.opponent_name,
            opponentElo: row.opponent_elo || 1500,
            wins: Number(row.wins),
            losses: Number(row.losses),
            draws: Number(row.draws),
            total: Number(row.total),
            eloChange: row.elo_change !== null ? Number(row.elo_change) : null,
        }));

        const gameStatsResult = await prisma.$queryRaw<Array<{
            quickest_win_moves: number | null;
            longest_game_moves: number | null;
            avg_game_length: number | null;
            quickest_loss_moves: number | null;
        }>>`
      SELECT
        MIN(CASE WHEN (
          (m.white_agent_id = ${id} AND m.winner = 'white') OR
          (m.black_agent_id = ${id} AND m.winner = 'black')
        ) THEN m.moves END) as quickest_win_moves,
        MAX(m.moves) as longest_game_moves,
        AVG(m.moves)::float as avg_game_length,
        MIN(CASE WHEN (
          (m.white_agent_id = ${id} AND m.winner = 'black') OR
          (m.black_agent_id = ${id} AND m.winner = 'white')
        ) THEN m.moves END) as quickest_loss_moves
      FROM matches m
      WHERE (m.white_agent_id = ${id} OR m.black_agent_id = ${id})
        AND m.status = 'completed'
        AND m.moves > 1
    `;

        const gameStats = gameStatsResult[0] ? {
            quickestWin: gameStatsResult[0].quickest_win_moves || null,
            longestGame: gameStatsResult[0].longest_game_moves || null,
            avgGameLength: gameStatsResult[0].avg_game_length ? Math.round(gameStatsResult[0].avg_game_length * 10) / 10 : null,
            quickestLoss: gameStatsResult[0].quickest_loss_moves || null,
        } : { quickestWin: null, longestGame: null, avgGameLength: null, quickestLoss: null };

        const extremeMovesResult = await prisma.$queryRaw<Array<{
            best_move_eval: number | null;
            worst_move_eval: number | null;
            best_move_match_id: string | null;
            worst_move_match_id: string | null;
        }>>`
      WITH agent_moves AS (
        SELECT
          gs.evaluation,
          gs.match_id,
          gs.move_number,
          CASE WHEN m.white_agent_id = ${id} THEN gs.evaluation ELSE -gs.evaluation END as adjusted_eval
        FROM game_states gs
        INNER JOIN matches m ON gs.match_id = m.id
        WHERE (m.white_agent_id = ${id} OR m.black_agent_id = ${id})
          AND m.status = 'completed'
          AND gs.evaluation IS NOT NULL
          AND (
            (m.white_agent_id = ${id} AND gs.move_number % 2 = 1) OR
            (m.black_agent_id = ${id} AND gs.move_number % 2 = 0)
          )
      )
      SELECT
        MAX(adjusted_eval)::float as best_move_eval,
        MIN(adjusted_eval)::float as worst_move_eval,
        (SELECT match_id FROM agent_moves WHERE adjusted_eval = (SELECT MAX(adjusted_eval) FROM agent_moves) LIMIT 1) as best_move_match_id,
        (SELECT match_id FROM agent_moves WHERE adjusted_eval = (SELECT MIN(adjusted_eval) FROM agent_moves) LIMIT 1) as worst_move_match_id
      FROM agent_moves
    `;

        const extremeMoves = extremeMovesResult[0] ? {
            bestMoveEval: extremeMovesResult[0].best_move_eval ? Math.round(extremeMovesResult[0].best_move_eval * 100) / 100 : null,
            worstMoveEval: extremeMovesResult[0].worst_move_eval ? Math.round(extremeMovesResult[0].worst_move_eval * 100) / 100 : null,
            bestMoveMatchId: extremeMovesResult[0].best_move_match_id,
            worstMoveMatchId: extremeMovesResult[0].worst_move_match_id,
        } : { bestMoveEval: null, worstMoveEval: null, bestMoveMatchId: null, worstMoveMatchId: null };

        const versionHistory = await prisma.agent.findMany({
            where: {
                userId: agent.userId,
                name: agent.name,
            },
            select: {
                id: true,
                version: true,
                active: true,
                createdAt: true,
                ranking: {
                    select: {
                        eloRating: true,
                        gamesPlayed: true,
                        wins: true,
                        losses: true,
                    }
                }
            },
            orderBy: {
                version: 'desc'
            }
        });

        console.log('Analytics accessed', {
            userId: user.id,
            agentId: id,
            agentName: agent.name,
            timestamp: new Date().toISOString()
        });

        return NextResponse.json({
            agent: {
                id: agent.id,
                name: agent.name,
                version: agent.version,
                ranking: agent.ranking ? {
                    eloRating: agent.ranking.eloRating,
                    gamesPlayed: agent.ranking.gamesPlayed,
                    wins: agent.ranking.wins,
                    losses: agent.ranking.losses,
                    draws: agent.ranking.draws,
                } : null,
            },
            moveTimeStats,
            evaluationStats,
            gameStats,
            extremeMoves,
            performanceOverTime,
            headToHead,
            h2hTotal,
            totalMatches,
            versionHistory: versionHistory.map(v => ({
                id: v.id,
                version: v.version,
                active: v.active,
                createdAt: v.createdAt,
                ranking: v.ranking,
            })),
        });

    } catch (err) {
        console.error('Analytics error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to fetch analytics' },
            { status: 500 }
        );
    }
}