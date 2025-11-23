import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'dev_jwt_secret_change_in_production';

// WebSocket connections are handled differently in Next.js
// This is a placeholder that will be replaced with actual WebSocket implementation
// For production, we'll use a separate WebSocket server or upgrade the HTTP connection

export async function GET(req: NextRequest) {
  const agentId = req.headers.get('x-agent-id');
  const connectionToken = req.headers.get('x-connection-token');

  if (!agentId || !connectionToken) {
    return new Response('Missing authentication headers', { status: 401 });
  }

  try {
    const tokenHash = crypto
      .createHash('sha256')
      .update(connectionToken)
      .digest('hex');

    const agent = await prisma.agent.findFirst({
      where: {
        id: agentId,
        connectionToken: tokenHash,
        executionMode: 'local',
      },
    });

    if (!agent) {
      return new Response('Invalid agent or token', { status: 403 });
    }

    // In a real implementation, upgrade this to WebSocket
    // For now, return instructions for setting up the WebSocket server
    return new Response(
      JSON.stringify({
        message: 'WebSocket endpoint - use ws:// protocol',
        agentId: agent.id,
        agentName: agent.name,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('WebSocket connection error:', error);
    return new Response('Connection failed', { status: 500 });
  }
}
