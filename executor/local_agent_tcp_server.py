#!/usr/bin/env python3
"""
Local Agent TCP Server for P2P Connections
Handles direct TCP connections from local agents as an alternative to WebSocket
"""

import asyncio
import json
import hashlib
import os
import time
from collections import defaultdict
from typing import Dict, Optional
import psycopg2
import psycopg2.extras
import redis.asyncio as redis

# Timeouts - all based on AGENT_TIMEOUT_SECONDS environment variable
AGENT_TIMEOUT_SECONDS = float(os.getenv('AGENT_TIMEOUT_SECONDS', '14.0'))
AUTH_TIMEOUT = AGENT_TIMEOUT_SECONDS * 3  # 3x agent timeout for authentication

class LocalAgentTCPServer:
    def __init__(self):
        self.connections: Dict[str, asyncio.StreamWriter] = {}  # agent_id -> writer
        self.agents: Dict[str, Dict] = {}  # agent_id -> agent info
        self.db_url = os.getenv('DATABASE_URL')
        self.redis_url = os.getenv('REDIS_URL', 'redis://redis:6379')
        self.redis_client = None
        self.redis_pubsub = None
        self.last_heartbeat: Dict[str, float] = {}
        self.last_db_heartbeat: Dict[str, float] = {}
        # Track pending requests: request_id -> response_channel
        self.pending_requests: Dict[str, str] = {}
        # Track which agent owns each request
        self.pending_request_agents: Dict[str, str] = {}
        # Track game IDs for pending requests
        self.pending_request_games: Dict[str, str] = {}
        # Track active games per agent
        self.active_games: Dict[str, set] = defaultdict(set)
        # Track agent status (connected/draining/etc.)
        self.agent_status: Dict[str, str] = {}

    def get_db_connection(self):
        """Get database connection"""
        return psycopg2.connect(self.db_url, cursor_factory=psycopg2.extras.RealDictCursor)

    def is_game_active(self, game_id: str) -> bool:
        """Check whether match record is still pending or in progress."""
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()
            cur.execute("SELECT status FROM matches WHERE id = %s", (game_id,))
            row = cur.fetchone()
            cur.close()
            conn.close()
            if not row:
                return False
            status = row['status'] if isinstance(row, dict) else row[0]
            return status in ('pending', 'in_progress')
        except Exception as e:
            print(f"P2P is_game_active error game={game_id}: {e}")
            return True

    async def verify_agent(self, agent_id: str, token: str) -> bool:
        """Verify agent authentication"""
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()

            # Get agent and verify token
            cur.execute("""
                SELECT id, name, connection_token, execution_mode
                FROM agents
                WHERE id = %s AND active = true
            """, (agent_id,))

            agent = cur.fetchone()
            cur.close()
            conn.close()

            if not agent:
                print(f"Agent {agent_id} not found or inactive")
                return False

            if agent['execution_mode'] != 'local':
                print(f"Agent {agent_id} is not configured for local execution")
                return False

            # Verify token hash
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            if agent['connection_token'] != token_hash:
                print(f"Invalid token for agent {agent_id}")
                return False

            self.agents[agent_id] = dict(agent)
            return True

        except Exception as e:
            print(f"Error verifying agent: {e}")
            return False

    async def update_connection_status(self, agent_id: str, status: str, ip_address: Optional[str] = None):
        """Update connection status in database"""
        try:
            conn = self.get_db_connection()
            cur = conn.cursor()

            if status == 'connected':
                # Disconnect any existing connections
                cur.execute("""
                    UPDATE local_agent_connections
                    SET status = 'disconnected', disconnected_at = NOW()
                    WHERE agent_id = %s AND status != 'disconnected'
                """, (agent_id,))

                # Insert new connection
                cur.execute("""
                    INSERT INTO local_agent_connections (id, agent_id, connection_type, status, connected_at, last_heartbeat, ip_address)
                    VALUES (gen_random_uuid(), %s, 'p2p', 'connected', NOW(), NOW(), %s)
                """, (agent_id, ip_address))
            elif status == 'in_game':
                cur.execute("""
                    UPDATE local_agent_connections
                    SET status = 'in_game', last_heartbeat = NOW()
                    WHERE agent_id = %s AND connection_type = 'p2p'
                """, (agent_id,))
            elif status == 'draining':
                cur.execute("""
                    UPDATE local_agent_connections
                    SET status = 'draining', last_heartbeat = NOW()
                    WHERE agent_id = %s AND connection_type = 'p2p'
                """, (agent_id,))
            else:
                # Disconnect
                cur.execute("""
                    UPDATE local_agent_connections
                    SET status = 'disconnected', disconnected_at = NOW()
                    WHERE agent_id = %s AND status = 'connected' AND connection_type = 'p2p'
                """, (agent_id,))

            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            print(f"Error updating connection status: {e}")
        else:
            if status in {'connected', 'in_game', 'draining'}:
                self.agent_status[agent_id] = status
            elif status == 'disconnected' and agent_id in self.agent_status:
                del self.agent_status[agent_id]

    async def handle_heartbeat(self, agent_id: str):
        """Handle heartbeat from agent"""
        current_time = time.time()
        self.last_heartbeat[agent_id] = current_time

        # Update database every 10 seconds
        if agent_id not in self.last_db_heartbeat or (current_time - self.last_db_heartbeat.get(agent_id, 0)) >= 10:
            try:
                conn = self.get_db_connection()
                cur = conn.cursor()
                cur.execute("""
                    UPDATE local_agent_connections
                    SET last_heartbeat = NOW()
                    WHERE agent_id = %s AND status = 'connected' AND connection_type = 'p2p'
                """, (agent_id,))
                conn.commit()
                cur.close()
                conn.close()
                self.last_db_heartbeat[agent_id] = current_time
            except Exception as e:
                print(f"Error updating heartbeat: {e}")

    async def handle_message(self, agent_id: str, message: Dict, writer: asyncio.StreamWriter):
        """Handle message from agent"""
        msg_type = message.get('type')

        if msg_type == 'heartbeat':
            await self.handle_heartbeat(agent_id)
        elif msg_type == 'move':
            # Forward move to Redis for match executor
            request_id = message.get('requestId')
            move_data = message.get('move')
            elapsed = message.get('elapsed')

            # Get the response channel from pending requests
            response_channel = self.pending_requests.get(request_id)
            if not response_channel:
                print(f"Warning: No response channel found for request {request_id}")
                return

            response = {
                'type': 'move',
                'move': move_data,
                'elapsed': elapsed
            }

            # Publish to the correct response channel
            await self.redis_client.publish(response_channel, json.dumps(response))

            # Clean up pending request
            del self.pending_requests[request_id]
            self.pending_request_agents.pop(request_id, None)
            self.pending_request_games.pop(request_id, None)

        elif msg_type == 'timeout':
            request_id = message.get('requestId')
            response_channel = self.pending_requests.get(request_id)
            if not response_channel:
                print(f"Warning: No response channel found for request {request_id}")
                return

            response = {'type': 'timeout'}
            await self.redis_client.publish(response_channel, json.dumps(response))

            # Clean up pending request
            del self.pending_requests[request_id]
            self.pending_request_agents.pop(request_id, None)
            self.pending_request_games.pop(request_id, None)

        elif msg_type == 'error':
            request_id = message.get('requestId')
            error = message.get('error')
            response_channel = self.pending_requests.get(request_id)
            if not response_channel:
                print(f"Warning: No response channel found for request {request_id}")
                return

            response = {'type': 'error', 'error': error}
            await self.redis_client.publish(response_channel, json.dumps(response))

            # Clean up pending request
            del self.pending_requests[request_id]
            self.pending_request_agents.pop(request_id, None)
            self.pending_request_games.pop(request_id, None)
        elif msg_type == 'status':
            await self.handle_status(agent_id, message)

    async def handle_status(self, agent_id: str, message: Dict):
        """Handle status updates (e.g., draining) from agent."""
        status = message.get('status')
        if not status:
            return
        self.agent_status[agent_id] = status
        await self.update_connection_status(agent_id, status)
        print(f"P2P status update agent={agent_id} status={status}")

    async def forward_redis_to_agent(self):
        """Listen for Redis messages and forward to agents"""
        # Subscribe to all agent channels
        await self.redis_pubsub.psubscribe('local_agent:*:move_request', 'local_agent:*:notifications')
        print("TCP server listening for Redis messages")

        while True:
            try:
                message = await self.redis_pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message:
                    channel = message['channel'].decode()
                    data = json.loads(message['data'].decode())

                    # Extract agent_id from channel
                    if ':move_request' in channel:
                        agent_id = channel.split(':')[1]
                        if agent_id in self.connections:
                            # Store the response channel for when agent responds
                            request_id = data.get('requestId')
                            response_channel = data.get('responseChannel')
                            if request_id and response_channel:
                                self.pending_requests[request_id] = response_channel
                                self.pending_request_agents[request_id] = agent_id
                                if data.get('gameId'):
                                    self.pending_request_games[request_id] = data.get('gameId')
                                    self.active_games[agent_id].add(data.get('gameId'))

                            writer = self.connections[agent_id]
                            # Forward to agent
                            forward_msg = json.dumps(data) + "\n"
                            writer.write(forward_msg.encode())
                            await writer.drain()
                        else:
                            # Agent not connected to THIS server - ignore silently
                            # The other server (WebSocket or TCP) will handle it
                            print(f"[TCP] Ignoring request for agent {agent_id} (not connected to TCP server)", flush=True)
                            pass
                    elif ':notifications' in channel:
                        agent_id = channel.split(':')[1]
                        if data.get('type') == 'game_end':
                            game_id = data.get('gameId')
                            if game_id and agent_id in self.active_games:
                                self.active_games[agent_id].discard(game_id)
                                if not self.active_games[agent_id]:
                                    del self.active_games[agent_id]
                        if agent_id in self.connections:
                            writer = self.connections[agent_id]
                            forward_msg = json.dumps(data) + "\n"
                            writer.write(forward_msg.encode())
                            await writer.drain()

            except Exception as e:
                print(f"Error forwarding Redis message: {e}")
                await asyncio.sleep(0.1)

    async def notify_pending_disconnect(self, agent_id: str, reason: str = 'Agent disconnected'):
        """Notify match runner that pending requests were cancelled due to disconnect"""
        for request_id, owner in list(self.pending_request_agents.items()):
            if owner != agent_id:
                continue

            response_channel = self.pending_requests.get(request_id)
            game_id = self.pending_request_games.pop(request_id, None)
            if response_channel:
                response = {
                    'type': 'disconnected',
                    'requestId': request_id,
                    'reason': reason
                }
                if game_id:
                    response['gameId'] = game_id
                await self.redis_client.publish(response_channel, json.dumps(response))

            self.pending_requests.pop(request_id, None)
            self.pending_request_agents.pop(request_id, None)

        active_games = self.active_games.pop(agent_id, set())
        if active_games:
            disconnect_channel = f'local_agent:{agent_id}:disconnect'
            for game_id in active_games:
                if not self.is_game_active(game_id):
                    continue
                payload = {
                    'type': 'disconnect',
                    'gameId': game_id,
                    'reason': reason
                }
                await self.redis_client.publish(disconnect_channel, json.dumps(payload))
        self.agent_status.pop(agent_id, None)

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Handle a P2P client connection"""
        addr = writer.get_extra_info('peername')
        ip_address = addr[0] if addr else 'unknown'
        agent_id = None

        print(f"P2P connection from {addr}")

        try:
            # Read authentication message with timeout
            auth_data = await asyncio.wait_for(reader.readline(), timeout=AUTH_TIMEOUT)
            auth_msg = json.loads(auth_data.decode().strip())

            if auth_msg.get('type') != 'connect':
                error_msg = json.dumps({"type": "error", "error": "Invalid message type"}) + "\n"
                writer.write(error_msg.encode())
                await writer.drain()
                writer.close()
                await writer.wait_closed()
                return

            agent_id = auth_msg.get('agentId')
            token = auth_msg.get('connectionToken')

            # Verify agent and token
            if not await self.verify_agent(agent_id, token):
                error_msg = json.dumps({"type": "error", "error": "Authentication failed"}) + "\n"
                writer.write(error_msg.encode())
                await writer.drain()
                writer.close()
                await writer.wait_closed()
                return

            # Store connection
            self.connections[agent_id] = writer
            self.agent_status[agent_id] = 'connected'

            # Update database
            await self.update_connection_status(agent_id, 'connected', ip_address)

            # Send success response
            agent_name = self.agents[agent_id]['name']
            response = json.dumps({
                "type": "connected",
                "agentName": agent_name,
                "connectionType": "p2p"
            }) + "\n"
            writer.write(response.encode())
            await writer.drain()

            print(f"Agent {agent_name} ({agent_id}) connected via P2P from {ip_address}")

            # Handle messages from client
            while True:
                line = await reader.readline()
                if not line:
                    print(f"Agent {agent_id} connection closed (EOF)")
                    break

                try:
                    message = json.loads(line.decode().strip())
                    await self.handle_message(agent_id, message, writer)
                except json.JSONDecodeError:
                    print(f"Invalid JSON from agent {agent_id}")
                except Exception as e:
                    print(f"Error handling message from {agent_id}: {e}")

        except asyncio.TimeoutError:
            print(f"Authentication timeout from {addr}")
        except Exception as e:
            print(f"P2P error for {addr}: {e}")
        finally:
            # Cleanup
            if agent_id:
                await self.notify_pending_disconnect(agent_id)
                if agent_id in self.connections:
                    del self.connections[agent_id]
                if agent_id in self.agents:
                    del self.agents[agent_id]
                await self.update_connection_status(agent_id, 'disconnected')
                print(f"Agent {agent_id} disconnected")

            try:
                writer.close()
                await writer.wait_closed()
            except:
                pass

    async def start_server(self, host='0.0.0.0', port=9000):
        """Start the TCP server"""
        # Connect to Redis
        self.redis_client = await redis.from_url(self.redis_url, decode_responses=False)
        self.redis_pubsub = self.redis_client.pubsub()

        # Start Redis listener task
        asyncio.create_task(self.forward_redis_to_agent())

        # Start TCP server
        server = await asyncio.start_server(
            self.handle_client, host, port
        )

        addr = server.sockets[0].getsockname()
        print(f"P2P TCP server listening on {addr}")
        print(f"Connected to Redis at {self.redis_url}")

        async with server:
            await server.serve_forever()

if __name__ == "__main__":
    print("Starting Local Agent P2P TCP Server...")
    server = LocalAgentTCPServer()
    asyncio.run(server.start_server())
