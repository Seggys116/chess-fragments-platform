import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { userRateLimit } from '@/lib/security/rateLimiter';

function hasMultiprocessingImport(code: string | null | undefined): boolean {
    if (!code) return false;

    return /\bimport\s+multiprocessing\b/.test(code) || /\bfrom\s+multiprocessing\b/.test(code);
}

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

        if (active !== undefined && typeof active !== 'boolean') {
            return NextResponse.json(
                { error: 'Active flag must be a boolean' },
                { status: 400 }
            );
        }

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

        if (active === true && hasMultiprocessingImport(agent.codeText)) {
            return NextResponse.json(
                { error: 'Agents using multiprocessing are not allowed. Remove multiprocessing before activating.' },
                { status: 400 }
            );
        }

        const updatedAgent = await prisma.$transaction(async (tx) => {
            const agentUpdate = await tx.agent.update({
                where: { id },
                data: updateData,
            });

            if (active === true) {
                // Keep only the two most recent active agents for the user
                const excessActive = await tx.agent.findMany({
                    where: { userId: user.id, active: true },
                    orderBy: { createdAt: 'desc' },
                    skip: 2,
                    select: { id: true },
                });

                if (excessActive.length > 0) {
                    await tx.agent.updateMany({
                        where: { id: { in: excessActive.map((a) => a.id) } },
                        data: { active: false },
                    });
                }
            }

            return agentUpdate;
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
