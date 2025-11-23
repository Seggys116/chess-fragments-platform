import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { prisma } from './db';
import crypto from 'crypto';

const INTERNAL_WS_URL = process.env.LOCAL_AGENT_SERVER_URL || 'ws://fragmentarena-localagent:9002';

export function setupWebSocketProxy(server: HTTPServer) {
  const wss = new WebSocketServer({
    noServer: true,
    path: '/api/local-agent/ws'
  });

  server.on('upgrade', async (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);

    if (pathname === '/api/local-agent/ws') {
      const agentId = request.headers['x-agent-id'] as string;
      const connectionToken = request.headers['x-connection-token'] as string;

      if (!agentId || !connectionToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      try {
        const tokenHash = crypto.createHash('sha256').update(connectionToken).digest('hex');

        const agent = await prisma.agent.findFirst({
          where: {
            id: agentId,
            connectionToken: tokenHash,
            executionMode: 'local',
            active: true,
          },
        });

        if (!agent) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (clientWs) => {
          wss.emit('connection', clientWs, request, agentId);
        });
      } catch (error) {
        console.error('Auth error:', error);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    }
  });

  wss.on('connection', async (clientWs: WebSocket, request: any, agentId: string) => {
    console.log(`WebSocket client connected: ${agentId}`);

    const internalWs = new WebSocket(INTERNAL_WS_URL);

    clientWs.on('message', (data) => {
      if (internalWs.readyState === WebSocket.OPEN) {
        internalWs.send(data);
      }
    });

    internalWs.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data);
      }
    });

    clientWs.on('close', () => {
      console.log(`WebSocket client disconnected: ${agentId}`);
      if (internalWs.readyState === WebSocket.OPEN) {
        internalWs.close();
      }
    });

    internalWs.on('close', () => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close();
      }
    });

    clientWs.on('error', (error) => {
      console.error('Client WebSocket error:', error);
    });

    internalWs.on('error', (error) => {
      console.error('Internal WebSocket error:', error);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close();
      }
    });

    internalWs.on('open', () => {
      console.log(`Connected to internal WebSocket server for agent: ${agentId}`);
    });
  });

  console.log('WebSocket proxy server initialized on /api/local-agent/ws');
}
