import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionCookie } from '@/lib/auth';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const accessCode = request.headers.get('x-access-code') || await getSessionCookie();

    if (!accessCode) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { agentId, opponentId } = body;

    if (!agentId) {
      return NextResponse.json(
        { error: 'Missing required field: agentId' },
        { status: 400 }
      );
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        user: true,
        ranking: true,
      },
    });

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    if (agent.user.accessCode !== accessCode) {
      return NextResponse.json(
        { error: 'Unauthorized - you do not own this agent' },
        { status: 403 }
      );
    }

    if (!agent.active) {
      return NextResponse.json(
        { error: 'Agent is not active' },
        { status: 400 }
      );
    }

    let opponent;

    if (opponentId) {
      // User specified an opponent - fetch it
      opponent = await prisma.agent.findUnique({
        where: { id: opponentId },
        include: {
          ranking: true,
          user: true,
        },
      });

      if (!opponent) {
        return NextResponse.json(
          { error: 'Opponent agent not found' },
          { status: 404 }
        );
      }

      if (!opponent.active) {
        return NextResponse.json(
          { error: 'Opponent agent is not active' },
          { status: 400 }
        );
      }

      // Allow matches between own agents (no ownership check)
    } else {
      // No opponent specified - find one automatically
      const myElo = agent.ranking?.eloRating || 1500;

      // Find opponent with similar ELO (±100 points), excluding the requesting agent
      const opponents = await prisma.agent.findMany({
        where: {
          id: { not: agentId },
          active: true,
          ranking: {
            eloRating: {
              gte: myElo - 100,
              lte: myElo + 100,
            },
          },
        },
        include: {
          ranking: true,
        },
        take: 10,
      });

      if (opponents.length === 0) {
        // Fallback: find ANY active opponent
        const fallbackOpponents = await prisma.agent.findMany({
          where: {
            id: { not: agentId },
            active: true,
          },
          include: {
            ranking: true,
          },
          take: 5,
        });

        if (fallbackOpponents.length === 0) {
          return NextResponse.json(
            { error: 'No opponents available' },
            { status: 404 }
          );
        }

        opponents.push(...fallbackOpponents);
      }

      // Pick random opponent
      opponent = opponents[Math.floor(Math.random() * opponents.length)];
    }

    // Randomly assign colors
    const isWhite = Math.random() > 0.5;

    // Create exhibition match
    const match = await prisma.match.create({
      data: {
        whiteAgentId: isWhite ? agent.id : opponent.id,
        blackAgentId: isWhite ? opponent.id : agent.id,
        matchType: 'exhibition',
        status: 'pending',
      },
      include: {
        whiteAgent: true,
        blackAgent: true,
      },
    });

    // Trigger Celery task immediately for exhibition match
    try {
      // Use Redis to publish task to Celery
      const redisModule = await import('@/lib/redis');
      const redis = redisModule.default;

      // Ensure Redis is connected
      if (!redis.isOpen) {
        await redis.connect();
      }

      // Queue task in Celery format
      const taskId = crypto.randomUUID();
      const task = {
        task: 'tasks.match_runner.run_match',
        id: taskId,
        args: [match.id],
        kwargs: {},
        retries: 0,
      };

      await redis.lPush('celery', JSON.stringify(task));
      console.log(`Queued exhibition match ${match.id} to Celery`);
    } catch (error) {
      console.error('Failed to queue match to Celery:', error);
      // Match is still created and will be picked up by periodic scheduler
    }

    return NextResponse.json({
      success: true,
      match: {
        id: match.id,
        whiteAgent: {
          id: match.whiteAgent.id,
          name: match.whiteAgent.name,
          version: match.whiteAgent.version,
        },
        blackAgent: {
          id: match.blackAgent.id,
          name: match.blackAgent.name,
          version: match.blackAgent.version,
        },
        matchType: match.matchType,
        status: match.status,
      },
      message: `Exhibition match created! ${match.whiteAgent.name} (White) vs ${match.blackAgent.name} (Black)`,
    });
  } catch (error) {
    console.error('Error creating exhibition match:', error);
    return NextResponse.json(
      { error: 'Failed to create exhibition match' },
      { status: 500 }
    );
  }
}
