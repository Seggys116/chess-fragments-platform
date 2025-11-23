import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const logs = await prisma.uploadLog.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        uploadedAt: 'desc',
      },
      take: 20,
    });

    return NextResponse.json({
      success: true,
      history: logs.map(log => ({
        id: log.id,
        uploadedAt: log.uploadedAt,
        success: log.success,
        errorMessage: log.errorMessage,
        codeHash: log.codeHash,
      })),
    });
  } catch (error) {
    console.error('Error fetching upload history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch upload history' },
      { status: 500 }
    );
  }
}
