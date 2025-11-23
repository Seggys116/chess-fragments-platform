import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { userRateLimit } from '@/lib/security/rateLimiter';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Rate limit: 5 agent updates per hour per user
    const rateLimitResult = await userRateLimit(user.id, 'update');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many update operations. Please try again later.' },
        { status: 429 }
      );
    }

    const agent = await prisma.agent.findUnique({
      where: { id },
    });

    if (!agent || agent.userId !== user.id) {
      return NextResponse.json(
        { error: 'Agent not found or unauthorized' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { active, name } = body;

    if (name !== undefined) {
      if (typeof name !== 'string') {
        return NextResponse.json(
          { error: 'Name must be a string' },
          { status: 400 }
        );
      }

      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        return NextResponse.json(
          { error: 'Name cannot be empty' },
          { status: 400 }
        );
      }

      if (trimmedName.length > 100) {
        return NextResponse.json(
          { error: 'Name must be 100 characters or less' },
          { status: 400 }
        );
      }
    }

    // Build update data object
    const updateData: { active?: boolean; name?: string } = {};
    if (active !== undefined) {
      updateData.active = active;
    }
    if (name !== undefined) {
      updateData.name = name.trim();
    }

    const updatedAgent = await prisma.agent.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      agent: updatedAgent,
    });
  } catch (error) {
    console.error('Error updating agent:', error);
    return NextResponse.json(
      { error: 'Failed to update agent' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Rate limit: 5 delete operations per hour per user
    const rateLimitResult = await userRateLimit(user.id, 'update');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many delete operations. Please try again later.' },
        { status: 429 }
      );
    }

    const agent = await prisma.agent.findUnique({
      where: { id },
    });

    if (!agent || agent.userId !== user.id) {
      return NextResponse.json(
        { error: 'Agent not found or unauthorized' },
        { status: 404 }
      );
    }

    // Delete agent (cascading deletes will handle ranking and matches)
    await prisma.agent.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: 'Agent deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting agent:', error);
    return NextResponse.json(
      { error: 'Failed to delete agent' },
      { status: 500 }
    );
  }
}
