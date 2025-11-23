import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionCookie } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const accessCode = request.headers.get('x-access-code') || await getSessionCookie();

    if (!accessCode) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const agent = await prisma.agent.findUnique({
      where: { id },
      include: { user: true },
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

    return NextResponse.json({
      success: true,
      agent: {
        id: agent.id,
        name: agent.name,
        version: agent.version,
        codeText: agent.codeText,
        createdAt: agent.createdAt,
      },
    });
  } catch (error) {
    console.error('Error fetching agent code:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agent code' },
      { status: 500 }
    );
  }
}
