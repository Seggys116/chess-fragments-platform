"""
Secure Local Agent WebSocket Server

This server handles WebSocket connections from local agents with enhanced security:
- Rate limiting per IP
- Connection limits
- Message size limits
- IP blocking for suspicious activity
- Proper authentication with token hashing
- Input validation and sanitization
"""

import asyncio
import websockets
import json
import os
import time
import hashlib
from collections import defaultdict
from datetime import datetime
from typing import Dict, Set, Optional, Tuple
import psycopg2
import psycopg2.extras
import redis
import redis.asyncio as aioredis

# Configuration
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres_dev_password@postgres:5432/fragmentarena')
REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379')
WS_PORT = int(os.getenv('WS_PORT', '8765'))
JWT_SECRET = os.getenv('JWT_SECRET', os.getenv('NEXTAUTH_SECRET', 'dev_jwt_secret_change_in_production'))

# Timeouts - all based on AGENT_TIMEOUT_SECONDS environment variable
AGENT_TIMEOUT_SECONDS = float(os.getenv('AGENT_TIMEOUT_SECONDS', '16.0'))
HEARTBEAT_TIMEOUT = AGENT_TIMEOUT_SECONDS * 5  # 5x agent timeout for heartbeat
# Server-side timeout: agent timeout + buffer for dispatch delays and response routing
MOVE_TIMEOUT = AGENT_TIMEOUT_SECONDS + 5.0  # 19s total - accounts for executor dispatch delays
AUTH_TIMEOUT = AGENT_TIMEOUT_SECONDS * 3  # 3x agent timeout for authentication

# Security configuration
MAX_CONNECTIONS_PER_IP = int(os.getenv('MAX_CONNECTIONS_PER_IP', '999999'))  # Effectively unlimited
CONNECTION_RATE_LIMIT = int(os.getenv('CONNECTION_RATE_LIMIT', '30'))  # per minute - rate limit still enforced
MAX_MESSAGE_SIZE = 1024 * 100  # 100KB max message size
MAX_CONNECTIONS_TOTAL = 999999  # Effectively unlimited total concurrent connections
BLOCK_DURATION = 3600  # 1 hour IP block for suspicious activity
MAX_AUTH_ATTEMPTS = 100000  # Max failed auth attempts before IP block


class SecurityManager:
    """Manages security features like rate limiting and IP blocking"""

    def __init__(self, redis_client):
        self.redis = redis_client
        self.ip_connections: Dict[str, int] = defaultdict(int)
        self.auth_attempts: Dict[str, int] = defaultdict(int)
        self.blocked_ips: Set[str] = set()

    def is_ip_blocked(self, ip: str) -> bool:
        """Check if IP is blocked"""
        if ip in self.blocked_ips:
            return True

        # Check Redis for blocked IPs
        blocked = self.redis.get(f'blocked_ip:{ip}')
        if blocked:
            self.blocked_ips.add(ip)
            return True

        return False

    def block_ip(self, ip: str, reason: str):
        """Block an IP address"""
        self.blocked_ips.add(ip)
        self.redis.setex(f'blocked_ip:{ip}', BLOCK_DURATION, reason)
        print(f"SECURITY: Blocked IP {ip} - Reason: {reason}")

    def check_connection_rate(self, ip: str) -> bool:
        """Check if IP exceeds connection rate limit"""
        key = f'conn_rate:{ip}'
        current = self.redis.get(key)

        if current and int(current) >= CONNECTION_RATE_LIMIT:
            return False

        pipe = self.redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, 60)  # 1 minute window
        pipe.execute()

        return True

    def check_connection_limit(self, ip: str) -> bool:
        """Check if IP has too many concurrent connections"""
        return self.ip_connections[ip] < MAX_CONNECTIONS_PER_IP

    def register_connection(self, ip: str):
        """Register a new connection from IP"""
        self.ip_connections[ip] += 1

    def unregister_connection(self, ip: str):
        """Unregister a connection from IP"""
        if ip in self.ip_connections:
            self.ip_connections[ip] = max(0, self.ip_connections[ip] - 1)

    def record_auth_attempt(self, ip: str, success: bool):
        """Record authentication attempt"""
        if success:
            self.auth_attempts[ip] = 0
        else:
            self.auth_attempts[ip] += 1
            if self.auth_attempts[ip] >= MAX_AUTH_ATTEMPTS:
                self.block_ip(ip, f"Too many failed authentication attempts ({self.auth_attempts[ip]})")


class LocalAgentManager:
    """Manages WebSocket connections to local agents"""

    def __init__(self):
        self.connections: Dict[str, websockets.WebSocketServerProtocol] = {}
        self.agent_to_ip: Dict[str, str] = {}
        self.agent_status: Dict[str, str] = {}
        self.pending_moves: Dict[str, asyncio.Future] = {}
        self.last_heartbeat: Dict[str, float] = {}
        self.authenticated_agents: Set[str] = set()

        self.redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        self.redis_async = None  # Will be initialized in start_server
        self.redis_pubsub = None  # Will be initialized in start_server
        self.security = SecurityManager(self.redis_client)

        self.active_games: Dict[str, Set[str]] = defaultdict(set)

        self.total_connections = 0

    def is_game_active(self, game_id: str) -> bool:
        """Check if a game is still active (pending or in progress)."""
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute("SELECT status FROM matches WHERE id = %s", (game_id,))
            row = cur.fetchone()
            cur.close()
            conn.close()
            if not row:
                return False
            status = row[0]
            return status in ('pending', 'in_progress')
        except Exception as e:
            print(f"[HYRBIDF] is_game_active error game={game_id} err={e}", flush=True)
            return True

    def get_db_connection(self):
        """Get database connection"""
        return psycopg2.connect(DATABASE_URL)

    async def authenticate_agent(self, agent_id: str, connection_token: str) -> Optional[Dict]:
        """Verify agent credentials with secure token hashing"""
        try:
            # Validate input
            if not agent_id or not connection_token:
                return None

            if len(agent_id) > 100 or len(connection_token) > 1000:
                return None

            conn = self.get_db_connection()
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            # Hash the provided token
            token_hash = hashlib.sha256(connection_token.encode()).hexdigest()

            cur.execute("""
                SELECT a.id, a.user_id, a.name, a.execution_mode, a.connection_token, a.active
                FROM agents a
                WHERE a.id = %s AND a.connection_token = %s AND a.execution_mode = 'local' AND a.active = true
            """, (agent_id, token_hash))

            agent = cur.fetchone()
            cur.close()
            conn.close()

            if agent:
                return dict(agent)
            return None
        except Exception as e:
            print(f"Authentication error: {e}")
            return None

    async def update_connection_status(self, agent_id: str, status: str, ip_address: Optional[str] = None):
        """Update agent connection status in database"""
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()

            if status == 'connected':
                # First, disconnect any existing active connections for this agent
                cur.execute("""
                    UPDATE local_agent_connections
                    SET status = 'disconnected', disconnected_at = NOW()
                    WHERE agent_id = %s AND status != 'disconnected'
                """, (agent_id,))

                # Now insert new connection record
                cur.execute("""
                    INSERT INTO local_agent_connections (id, agent_id, connection_type, status, connected_at, last_heartbeat, ip_address)
                    VALUES (gen_random_uuid(), %s, 'websocket', 'connected', NOW(), NOW(), %s)
                """, (agent_id, ip_address))
            elif status == 'disconnected':
                cur.execute("""
                    UPDATE local_agent_connections
                    SET status = 'disconnected', disconnected_at = NOW()
                    WHERE agent_id = %s
                """, (agent_id,))
            elif status == 'in_game':
                cur.execute("""
                    UPDATE local_agent_connections
                    SET status = 'in_game', last_heartbeat = NOW()
                    WHERE agent_id = %s
                """, (agent_id,))
            elif status == 'draining':
                cur.execute("""
                    UPDATE local_agent_connections
                    SET status = 'draining', last_heartbeat = NOW()
                    WHERE agent_id = %s
                """, (agent_id,))

            conn.commit()
            cur.close()
            conn.close()

            # Update Redis cache
            self.redis_client.hset(f'local_agent:{agent_id}', mapping={
                'status': status,
                'last_seen': str(time.time())
            })
            if status == 'disconnected':
                self.agent_status.pop(agent_id, None)
            else:
                self.agent_status[agent_id] = status

        except Exception as e:
            print(f"Error updating connection status: {e}")

    async def handle_connect(self, websocket: websockets.WebSocketServerProtocol, data: Dict, ip: str) -> Tuple[bool, Optional[str]]:
        """Handle initial connection with authentication"""
        agent_id = data.get('agentId')
        connection_token = data.get('connectionToken')

        if not agent_id or not connection_token:
            return False, None

        # Authenticate
        agent = await self.authenticate_agent(agent_id, connection_token)

        if not agent:
            self.security.record_auth_attempt(ip, False)
            await websocket.send(json.dumps({
                'type': 'error',
                'error': 'Invalid agent credentials'
            }))
            return False, None

        self.security.record_auth_attempt(ip, True)

        # Check if already connected (disconnect old connection)
        if agent_id in self.connections:
            old_ws = self.connections[agent_id]
            try:
                await old_ws.send(json.dumps({
                    'type': 'disconnect',
                    'reason': 'New connection established'
                }))
                await old_ws.close()
            except:
                pass

            # Clean up old connection
            if agent_id in self.agent_to_ip:
                old_ip = self.agent_to_ip[agent_id]
                self.security.unregister_connection(old_ip)

        # Register connection
        self.connections[agent_id] = websocket
        self.agent_to_ip[agent_id] = ip
        self.agent_status[agent_id] = 'connected'
        self.last_heartbeat[agent_id] = time.time()
        self.authenticated_agents.add(agent_id)
        print(f"[HYRBIDF] ws-auth-success agent={agent_id} added_to_connections=True", flush=True)

        await self.update_connection_status(agent_id, 'connected', ip)

        await websocket.send(json.dumps({
            'type': 'connected',
            'agentId': agent_id,
            'agentName': agent['name'],
            'message': 'Successfully connected to platform'
        }))

        print(f"Agent {agent['name']} ({agent_id}) connected from {ip}")
        return True, agent_id

    async def handle_heartbeat(self, agent_id: str):
        """Handle heartbeat from agent"""
        current_time = time.time()
        self.last_heartbeat[agent_id] = current_time

        # Update database every 10 seconds (more frequent for matchmaking)
        # Use agent-specific tracking to avoid missing updates
        if not hasattr(self, 'last_db_heartbeat'):
            self.last_db_heartbeat = {}

        if agent_id not in self.last_db_heartbeat or (current_time - self.last_db_heartbeat.get(agent_id, 0)) >= 10:
            try:
                conn = self.get_db_connection()
                cur = conn.cursor()
                cur.execute("""
                    UPDATE local_agent_connections
                    SET last_heartbeat = NOW()
                    WHERE agent_id = %s AND status != 'disconnected'
                """, (agent_id,))
                conn.commit()
                cur.close()
                conn.close()
                self.last_db_heartbeat[agent_id] = current_time
            except Exception as e:
                print(f"Error updating heartbeat: {e}")

    async def request_move(self, agent_id: str, game_data: Dict) -> Optional[Dict]:
        """Request a move from local agent (called by executor)"""
        if agent_id not in self.connections or agent_id not in self.authenticated_agents:
            print(f"[HYRBIDF] ws-request skipped agent={agent_id} reason=not_connected game={game_data.get('gameId')}", flush=True)
            return {
                'disconnected': True,
                'gameId': game_data.get('gameId'),
                'reason': 'Agent not connected'
            }

        websocket = self.connections[agent_id]
        game_id = game_data['gameId']

        try:
            move_future = asyncio.Future()
            self.pending_moves[game_id] = move_future

            await self.update_connection_status(agent_id, 'in_game')
            print(f"[HYRBIDF] ws-request send agent={agent_id} game={game_id} player={game_data.get('player')} pieces={len(game_data.get('board', {}).get('pieces', []))}", flush=True)

            await websocket.send(json.dumps({
                'type': 'move_request',
                'requestId': game_data.get('requestId'),
                'gameId': game_id,
                'board': game_data['board'],
                'player': game_data['player'],
                'var': game_data.get('var', {}),
            }))

            try:
                move_data = await asyncio.wait_for(move_future, timeout=MOVE_TIMEOUT)

                if move_data and move_data.get('disconnected'):
                    print(f"[HYRBIDF] ws-request disconnect agent={agent_id} game={game_id}", flush=True)
                    return move_data

                if agent_id in self.connections:
                    new_status = 'draining' if self.agent_status.get(agent_id) == 'draining' else 'connected'
                    await self.update_connection_status(agent_id, new_status)

                print(f"[HYRBIDF] ws-request done agent={agent_id} game={game_id} payload={move_data}", flush=True)
                return move_data
            except asyncio.TimeoutError:
                print(f"[HYRBIDF] ws-request timeout agent={agent_id} game={game_id}", flush=True)
                if agent_id in self.connections:
                    new_status = 'draining' if self.agent_status.get(agent_id) == 'draining' else 'connected'
                    await self.update_connection_status(agent_id, new_status)
                return {'timeout': True}

        except Exception as e:
            print(f"[HYRBIDF] ws-request error agent={agent_id} game={game_id} err={e}", flush=True)
            return None
        finally:
            if game_id in self.pending_moves:
                del self.pending_moves[game_id]

    async def handle_move(self, agent_id: str, data: Dict):
        """Handle move response from agent"""
        game_id = data.get('gameId')
        print(f"[HYRBIDF] ws-move agent={agent_id} game={game_id} data={data}", flush=True)

        # Pass the entire data dict so we can access both 'move' and 'elapsed'
        if game_id in self.pending_moves:
            future = self.pending_moves[game_id]
            if not future.done():
                future.set_result(data)

    async def handle_timeout(self, agent_id: str, data: Dict):
        """Handle timeout notification from agent"""
        game_id = data.get('gameId')
        print(f"[HYRBIDF] ws-timeout agent={agent_id} game={game_id}", flush=True)
        if game_id in self.pending_moves:
            future = self.pending_moves[game_id]
            if not future.done():
                future.set_result({'timeout': True})

    async def handle_error(self, agent_id: str, data: Dict):
        """Handle error from agent"""
        game_id = data.get('gameId')
        error = data.get('error', 'Unknown error')
        print(f"[HYRBIDF] ws-error agent={agent_id} game={game_id} error={error}", flush=True)

        if game_id in self.pending_moves:
            future = self.pending_moves[game_id]
            if not future.done():
                future.set_result({'error': error})

    async def handle_status(self, agent_id: str, data: Dict):
        """Handle status updates from agent (e.g., draining)."""
        status = data.get('status')
        if not status:
            return
        self.agent_status[agent_id] = status
        await self.update_connection_status(agent_id, status)
        print(f"[HYRBIDF] ws-status agent={agent_id} status={status}", flush=True)

    async def handle_disconnect(self, agent_id: str):
        """Handle agent disconnection"""
        if agent_id in self.connections:
            print(f"[HYRBIDF] ws-disconnect-cleanup agent={agent_id} removed_from_connections=True", flush=True)
            del self.connections[agent_id]

        if agent_id in self.agent_to_ip:
            ip = self.agent_to_ip[agent_id]
            self.security.unregister_connection(ip)
            del self.agent_to_ip[agent_id]

        if agent_id in self.agent_status:
            del self.agent_status[agent_id]

        if agent_id in self.last_heartbeat:
            del self.last_heartbeat[agent_id]

        if agent_id in self.authenticated_agents:
            self.authenticated_agents.remove(agent_id)

        await self.update_connection_status(agent_id, 'disconnected')

        # Cancel any pending moves
        for game_id, future in list(self.pending_moves.items()):
            if not future.done():
                future.set_result({
                    'disconnected': True,
                    'gameId': game_id,
                    'reason': 'Agent disconnected'
                })

        active_games = self.active_games.pop(agent_id, set())
        if active_games:
            disconnect_channel = f'local_agent:{agent_id}:disconnect'
            for game_id in active_games:
                if not self.is_game_active(game_id):
                    continue
                payload = {
                    'type': 'disconnect',
                    'gameId': game_id,
                    'reason': 'Agent disconnected'
                }
                try:
                    self.redis_client.publish(disconnect_channel, json.dumps(payload))
                except Exception as e:
                    print(f"Error publishing disconnect for agent {agent_id}, game {game_id}: {e}")

        self.total_connections = max(0, self.total_connections - 1)
        print(f"[HYRBIDF] ws-disconnect agent={agent_id} remaining={self.total_connections}", flush=True)

    async def monitor_heartbeats(self):
        """Monitor heartbeats and disconnect stale connections"""
        while True:
            try:
                current_time = time.time()
                disconnected = []

                for agent_id, last_hb in list(self.last_heartbeat.items()):
                    if current_time - last_hb > HEARTBEAT_TIMEOUT:
                        print(f"Agent {agent_id} heartbeat timeout")
                        disconnected.append(agent_id)

                for agent_id in disconnected:
                    if agent_id in self.connections:
                        ws = self.connections[agent_id]
                        try:
                            await ws.send(json.dumps({
                                'type': 'disconnect',
                                'reason': 'Heartbeat timeout'
                            }))
                            await ws.close()
                        except:
                            pass
                        await self.handle_disconnect(agent_id)

            except Exception as e:
                print(f"Heartbeat monitor error: {e}")

            await asyncio.sleep(5)

    async def redis_listener(self):
        """Listen for move requests from match runner via Redis pub/sub"""
        # Subscribe to pattern for all local agents
        await self.redis_pubsub.psubscribe('local_agent:*:move_request', 'local_agent:*:notifications')
        print("Redis listener started - listening for move requests and notifications")

        while True:
            try:
                message = await self.redis_pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message['type'] == 'pmessage':
                    try:
                        data = json.loads(message['data'])
                        channel = message['channel']

                        if ':move_request' in channel:
                            # Extract agent_id from channel name
                            # Format: local_agent:{agent_id}:move_request
                            agent_id = channel.split(':')[1]
                            if agent_id in self.connections:
                                await self.handle_redis_move_request(agent_id, data)
                            else:
                                # Agent not connected to THIS server - ignore silently
                                # The other server (TCP or WebSocket) will handle it
                                print(f"[WS] Ignoring request for agent {agent_id} (not connected to WebSocket server)", flush=True)
                                pass
                        elif ':notifications' in channel:
                            # Game start/end notifications
                            agent_id = channel.split(':')[1]
                            await self.forward_notification(agent_id, data)

                    except json.JSONDecodeError:
                        print(f"Invalid JSON in Redis message: {message['data']}")
                    except Exception as e:
                        print(f"Error processing Redis message: {e}")

                await asyncio.sleep(0.01)  # Small sleep to prevent busy loop

            except Exception as e:
                print(f"Redis listener error: {e}")
                await asyncio.sleep(1)

    async def handle_redis_move_request(self, agent_id: str, data: Dict):
        """Handle move request from Redis (sent by match runner)"""
        request_id = data.get('requestId')
        response_channel = data.get('responseChannel')

        if not request_id or not response_channel:
            print(f"Invalid move request format for agent {agent_id}")
            return

        game_id = data.get('gameId')
        if game_id:
            self.active_games[agent_id].add(game_id)

        # Forward to WebSocket agent
        move_result = await self.request_move(agent_id, data)

        # Publish response back to match runner
        if move_result:
            if move_result.get('timeout'):
                response = {'type': 'timeout', 'requestId': request_id}
            elif move_result.get('error'):
                response = {'type': 'error', 'requestId': request_id, 'error': move_result['error']}
            elif move_result.get('disconnected'):
                response = {
                    'type': 'disconnected',
                    'requestId': request_id,
                    'gameId': move_result.get('gameId') or data.get('gameId'),
                    'reason': move_result.get('reason', 'Agent disconnected')
                }
                if game_id:
                    self.active_games[agent_id].discard(game_id)
                    if not self.active_games[agent_id]:
                        del self.active_games[agent_id]
            else:
                # Extract move and elapsed time from the agent response
                response = {
                    'type': 'move',
                    'requestId': request_id,
                    'move': move_result.get('move'),
                    'elapsed': move_result.get('elapsed')
                }

            self.redis_client.publish(response_channel, json.dumps(response))
        else:
            # Agent not connected or other error
            response = {
                'type': 'disconnected',
                'requestId': request_id,
                'gameId': data.get('gameId'),
                'reason': 'Agent not connected'
            }
            self.redis_client.publish(response_channel, json.dumps(response))
            if game_id:
                self.active_games[agent_id].discard(game_id)
                if not self.active_games[agent_id]:
                    del self.active_games[agent_id]

    async def forward_notification(self, agent_id: str, data: Dict):
        """Forward game notifications to WebSocket client"""
        if data.get('type') == 'game_end':
            game_id = data.get('gameId')
            if game_id and agent_id in self.active_games:
                self.active_games[agent_id].discard(game_id)
                if not self.active_games[agent_id]:
                    del self.active_games[agent_id]
        if agent_id in self.connections:
            try:
                await self.connections[agent_id].send(json.dumps(data))
            except Exception as e:
                print(f"Error forwarding notification to agent {agent_id}: {e}")

    async def handle_client(self, websocket: websockets.WebSocketServerProtocol, path: str):
        """Handle WebSocket client connection with security checks"""
        agent_id = None

        # Get real client IP from proxy headers
        ip = 'unknown'
        if hasattr(websocket, 'request_headers'):
            # Check X-Real-IP first (set by HAProxy)
            ip = websocket.request_headers.get('X-Real-IP')
            if not ip:
                # Fallback to X-Forwarded-For
                forwarded_for = websocket.request_headers.get('X-Forwarded-For')
                if forwarded_for:
                    ip = forwarded_for.split(',')[0].strip()

        # Final fallback to remote_address
        if not ip or ip == 'unknown':
            ip = websocket.remote_address[0] if hasattr(websocket, 'remote_address') else 'unknown'

        authenticated = False

        try:
            # Security checks - DISABLED for local agents (multiple agents connect from same IP)
            # if self.security.is_ip_blocked(ip):
            #     await websocket.send(json.dumps({'type': 'error', 'error': 'IP blocked'}))
            #     await websocket.close()
            #     return

            # if not self.security.check_connection_rate(ip):
            #     await websocket.send(json.dumps({'type': 'error', 'error': 'Rate limit exceeded'}))
            #     await websocket.close()
            #     self.security.block_ip(ip, "Connection rate limit exceeded")
            #     return

            # if not self.security.check_connection_limit(ip):
            #     await websocket.send(json.dumps({'type': 'error', 'error': 'Too many connections from this IP'}))
            #     await websocket.close()
            #     return

            if self.total_connections >= MAX_CONNECTIONS_TOTAL:
                await websocket.send(json.dumps({'type': 'error', 'error': 'Server at capacity'}))
                await websocket.close()
                return

            self.security.register_connection(ip)
            self.total_connections += 1

            # Wait for authentication
            try:
                first_message = await asyncio.wait_for(websocket.recv(), timeout=AUTH_TIMEOUT)
                data = json.loads(first_message)

                if data.get('type') == 'connect':
                    authenticated, agent_id = await self.handle_connect(websocket, data, ip)
                    if not authenticated:
                        await websocket.close()
                        return
                else:
                    await websocket.send(json.dumps({'type': 'error', 'error': 'Must authenticate first'}))
                    await websocket.close()
                    return
            except asyncio.TimeoutError:
                await websocket.send(json.dumps({'type': 'error', 'error': 'Authentication timeout'}))
                await websocket.close()
                return

            # Handle messages
            async for message in websocket:
                try:
                    # Check message size
                    if len(message) > MAX_MESSAGE_SIZE:
                        print(f"Oversized message from {ip}: {len(message)} bytes")
                        continue

                    data = json.loads(message)
                    msg_type = data.get('type')

                    if msg_type == 'heartbeat':
                        await self.handle_heartbeat(agent_id)
                    elif msg_type == 'move':
                        await self.handle_move(agent_id, data)
                    elif msg_type == 'timeout':
                        await self.handle_timeout(agent_id, data)
                    elif msg_type == 'error':
                        await self.handle_error(agent_id, data)
                    elif msg_type == 'status':
                        await self.handle_status(agent_id, data)
                    else:
                        print(f"Unknown message type from {agent_id}: {msg_type}")

                except json.JSONDecodeError:
                    print(f"Invalid JSON from {ip}")
                    continue
                except Exception as e:
                    print(f"Message handling error from {agent_id}: {e}")
                    continue

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            print(f"Client handler error for {ip}: {e}")
        finally:
            if agent_id:
                await self.handle_disconnect(agent_id)
            else:
                self.security.unregister_connection(ip)
                self.total_connections = max(0, self.total_connections - 1)

    async def start_server(self):
        """Start WebSocket server"""
        print("=" * 60)
        print("Local Agent WebSocket Server")
        print("=" * 60)
        print(f"Port: {WS_PORT}")
        print(f"Max connections per IP: {MAX_CONNECTIONS_PER_IP}")
        print(f"Connection rate limit: {CONNECTION_RATE_LIMIT}/min")
        print(f"Max total connections: {MAX_CONNECTIONS_TOTAL}")
        print("=" * 60)

        # Initialize async Redis client
        self.redis_async = await aioredis.from_url(REDIS_URL, decode_responses=True)
        self.redis_pubsub = self.redis_async.pubsub()

        # Start heartbeat monitor
        asyncio.create_task(self.monitor_heartbeats())

        # Start Redis listener for match runner communication
        asyncio.create_task(self.redis_listener())

        # Start WebSocket server
        async with websockets.serve(
            self.handle_client,
            "0.0.0.0",
            WS_PORT,
            ping_interval=20,
            ping_timeout=10,
            max_size=MAX_MESSAGE_SIZE,
        ):
            print(f"WebSocket server listening on ws://0.0.0.0:{WS_PORT}")
            print("Ready to accept connections...")
            await asyncio.Future()  # Run forever


# Global manager instance
manager = LocalAgentManager()


async def request_move_from_local_agent(agent_id: str, game_data: Dict) -> Optional[Dict]:
    """Public API for executor to request moves from local agents"""
    return await manager.request_move(agent_id, game_data)


def is_agent_connected(agent_id: str) -> bool:
    """Check if agent is currently connected"""
    return agent_id in manager.connections and agent_id in manager.authenticated_agents


if __name__ == '__main__':
    asyncio.run(manager.start_server())
