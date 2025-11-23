import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const upgradeHeader = request.headers.get('upgrade');

  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  // For Next.js API routes, WebSocket upgrades need to be handled differently
  // Since Next.js doesn't natively support WebSocket upgrades in API routes,
  // we return instructions for now
  return new Response(
    JSON.stringify({
      error: 'WebSocket upgrade not supported in this configuration',
      message: 'WebSocket connections should be handled by a custom server',
    }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
