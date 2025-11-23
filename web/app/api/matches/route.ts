import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status');
    const agentId = searchParams.get('agentId');

    interface WhereClause {
      status?: string;
      OR?: Array<{ whiteAgentId?: string; blackAgentId?: string }>;
    }

    const where: WhereClause = {};
    if (status) {
      where.status = status;
    }
    if (agentId) {
      where.OR = [
        { whiteAgentId: agentId },
        { blackAgentId: agentId },
      ];
    }

    const matches = await prisma.match.findMany({
      where,
      include: {
        whiteAgent: true,
        blackAgent: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    });

    const total = await prisma.match.count({ where });

    const matchList = matches.map(match => ({
      id: match.id,
      status: match.status,
      winner: match.winner,
      moves: match.moves,
      termination: match.termination,
      whiteAgent: {
        id: match.whiteAgent.id,
        name: match.whiteAgent.name,
        version: match.whiteAgent.version,
        owner: 'Anonymous',
      },
      blackAgent: {
        id: match.blackAgent.id,
        name: match.blackAgent.name,
        version: match.blackAgent.version,
        owner: 'Anonymous',
      },
      startedAt: match.startedAt,
      completedAt: match.completedAt,
      createdAt: match.createdAt,
    }));

    return NextResponse.json({
      success: true,
      matches: matchList,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching matches:', error);
    return NextResponse.json(
      { error: 'Failed to fetch matches' },
      { status: 500 }
    );
  }
}
