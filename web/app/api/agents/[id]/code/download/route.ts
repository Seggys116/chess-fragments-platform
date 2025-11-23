import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'dev_jwt_secret_change_in_production';

export async function GET(
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

        const agent = await prisma.agent.findUnique({
            where: { id },
        });

        if (!agent) {
            return NextResponse.json(
                { error: 'Agent not found' },
                { status: 404 }
            );
        }

        if (agent.userId !== user.id) {
            return NextResponse.json(
                { error: 'Unauthorized - you do not own this agent' },
                { status: 403 }
            );
        }

        // Sanitize filename to prevent directory traversal attacks
        const safeName = agent.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `${safeName}_v${Math.floor(agent.version)}_connector.py`;

        let codeContent = agent.codeText;

        // For local agents, regenerate the templated connector script
        if (agent.executionMode === 'local') {
            // Generate a new connection token
            const tokenData = JSON.stringify({
                agentId: agent.id,
                userId: user.id,
                timestamp: Date.now(),
                random: crypto.randomBytes(16).toString('hex'),
            });

            const connectionToken = crypto
                .createHmac('sha256', JWT_SECRET)
                .update(tokenData)
                .digest('hex');

            // Store the token hash in the database
            const tokenHash = crypto
                .createHash('sha256')
                .update(connectionToken)
                .digest('hex');

            await prisma.agent.update({
                where: { id: agent.id },
                data: {
                    connectionToken: tokenHash,
                },
            });

            // Generate the Python client script
            codeContent = generateClientScript(agent.id, connectionToken, agent.name);
        }

        return new NextResponse(codeContent, {
            headers: {
                'Content-Type': 'text/x-python',
                'Content-Disposition': `attachment; filename="${fileName}"`,
            },
        });
    } catch (error) {
        console.error('Error downloading agent code:', error);
        return NextResponse.json(
            { error: 'Failed to download agent code' },
            { status: 500 }
        );
    }
}

function generateClientScript(agentId: string, connectionToken: string, agentName: string): string {
    return `#!/usr/bin/env python3
"""
Local Agent Connector for Chess Fragments Platform
Generated for agent: ${agentName}

This script allows you to run your agent locally while connecting to the platform.
Place this file in the same directory as your agent.py and run:
    python3 agent_connector.py

The script will:
1. Try to establish a P2P connection (fastest)
2. Fall back to WebSocket if P2P fails
3. Handle disconnects and reconnections automatically
4. Enforce timeouts to prevent game forfeit
"""

import asyncio
import websockets
import json
import time
import sys
import os
import importlib.util
from typing import Optional, Dict, Any
import hashlib
import signal

# Configuration (DO NOT MODIFY)
AGENT_ID = "${agentId}"
CONNECTION_TOKEN = "${connectionToken}"
WS_URL = "wss://chesscomp.zaknobleclarke.com/api/local-agent/ws"
P2P_HOST = "chesscomp.zaknobleclarke.com"
P2P_PORT = 9000  # Direct TCP connection port
P2P_TIMEOUT = 5  # seconds to wait for P2P connection
HEARTBEAT_INTERVAL = 5  # seconds
MOVE_TIMEOUT = ${process.env.AGENT_TIMEOUT_SECONDS || '14.0'}  # seconds (platform enforced)
RECONNECT_DELAY = 3  # seconds
MAX_GAMES_PER_SESSION = int(os.getenv("MAX_GAMES_PER_SESSION", "0"))  # 0 = unlimited
CANCELLED_RESULTS = {"cancelled", "error", "no_moves"}

class LocalAgentConnector:
    def __init__(self):
        self.agent_module = None
        self.websocket = None
        self.reader = None
        self.writer = None
        self.connected = False
        self.connection_type = None  # 'p2p' or 'websocket'
        self.in_game = False
        self.running = True
        self.current_game_id = None
        self.current_request_id = None
        self.games_played = 0
        self._shutdown_started = False
        self.active_games = set()
        self.shutdown_pending = False
        self.primary_game_id = None
        self.last_status_sent = None

    async def load_agent(self):
        """Load the local agent.py file"""
        try:
            agent_path = os.path.join(os.path.dirname(__file__), 'agent.py')
            if not os.path.exists(agent_path):
                print("ERROR: agent.py not found in current directory")
                sys.exit(1)

            spec = importlib.util.spec_from_file_location("agent", agent_path)
            self.agent_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.agent_module)

            if not hasattr(self.agent_module, 'agent'):
                print("ERROR: agent.py must define an 'agent' function")
                sys.exit(1)

            print(f"✓ Successfully loaded agent from {agent_path}")
        except Exception as e:
            print(f"ERROR loading agent: {e}")
            sys.exit(1)

    async def connect_p2p(self):
        """Try to establish direct P2P TCP connection"""
        try:
            print(f"Attempting P2P connection to {P2P_HOST}:{P2P_PORT}...")

            # Try to open TCP connection with timeout
            self.reader, self.writer = await asyncio.wait_for(
                asyncio.open_connection(P2P_HOST, P2P_PORT),
                timeout=P2P_TIMEOUT
            )

            # Send authentication
            auth_message = json.dumps({
                "type": "connect",
                "agentId": AGENT_ID,
                "connectionToken": CONNECTION_TOKEN,
            }) + "\\n"

            self.writer.write(auth_message.encode())
            await self.writer.drain()

            # Wait for response
            response_data = await asyncio.wait_for(
                self.reader.readline(),
                timeout=14.0
            )

            if not response_data:
                print("P2P: Received empty response from server")
                return False

            response_str = response_data.decode().strip()
            print(f"P2P: Received response: {repr(response_str)}")

            if not response_str:
                print("P2P: Received empty string after decoding")
                return False

            try:
                response = json.loads(response_str)
            except json.JSONDecodeError as e:
                print(f"P2P: Failed to parse JSON: {e}")
                print(f"P2P: Raw response bytes: {response_data}")
                return False

            if response.get("type") == "connected":
                self.connected = True
                self.connection_type = "p2p"
                print(f"✓ Connected to platform as {response.get('agentName', 'Agent')}")
                print(f"  Connection type: P2P (Direct)")
                print(f"  Status: Ready for matchmaking")
                return True
            else:
                print(f"P2P authentication failed: {response.get('error', 'Unknown error')}")
                return False

        except asyncio.TimeoutError:
            print(f"P2P connection timeout after {P2P_TIMEOUT}s")
            return False
        except ConnectionRefusedError:
            print("P2P connection refused (port may be closed or firewalled)")
            return False
        except Exception as e:
            print(f"P2P connection failed: {e}")
            return False
        finally:
            # Clean up on failure
            if not self.connected and self.writer:
                self.writer.close()
                await self.writer.wait_closed()
                self.writer = None
                self.reader = None

    async def connect_websocket(self):
        """Establish WebSocket connection to the platform"""
        try:
            print(f"Connecting to {WS_URL}...")

            # Create connection with authentication
            self.websocket = await websockets.connect(
                WS_URL,
                additional_headers={
                    "X-Agent-ID": AGENT_ID,
                    "X-Connection-Token": CONNECTION_TOKEN,
                }
            )

            # Send initial connection message
            await self.websocket.send(json.dumps({
                "type": "connect",
                "agentId": AGENT_ID,
                "connectionToken": CONNECTION_TOKEN,
            }))

            response = await asyncio.wait_for(
                self.websocket.recv(),
                timeout=10.0
            )

            data = json.loads(response)
            if data.get("type") == "connected":
                self.connected = True
                self.connection_type = "websocket"
                print(f"✓ Connected to platform as {data.get('agentName', 'Agent')}")
                print(f"  Connection type: WebSocket (Fallback)")
                print(f"  Status: Ready for matchmaking")
                return True
            else:
                print(f"Connection failed: {data.get('error', 'Unknown error')}")
                return False

        except asyncio.TimeoutError:
            print("Connection timeout")
            return False
        except Exception as e:
            print(f"Connection error: {e}")
            return False

    async def send_message(self, message: Dict):
        """Send message over current connection (P2P or WebSocket)"""
        if self.connection_type == "p2p":
            # P2P: Send newline-delimited JSON
            data = json.dumps(message) + "\\n"
            self.writer.write(data.encode())
            await self.writer.drain()
        elif self.connection_type == "websocket":
            # WebSocket: Send JSON string
            await self.websocket.send(json.dumps(message))

    async def receive_message(self, timeout: Optional[float] = None) -> Optional[Dict]:
        """Receive message from current connection (P2P or WebSocket)"""
        try:
            if self.connection_type == "p2p":
                # P2P: Read newline-delimited JSON
                if timeout:
                    line = await asyncio.wait_for(self.reader.readline(), timeout=timeout)
                else:
                    line = await self.reader.readline()

                if not line:
                    return None
                return json.loads(line.decode().strip())

            elif self.connection_type == "websocket":
                # WebSocket: Receive JSON string
                if timeout:
                    data = await asyncio.wait_for(self.websocket.recv(), timeout=timeout)
                else:
                    data = await self.websocket.recv()
                return json.loads(data)
        except asyncio.TimeoutError:
            return None
        except Exception as e:
            print(f"Error receiving message: {e}")
            return None

    async def send_heartbeat(self):
        """Send periodic heartbeat to keep connection alive"""
        while self.running and self.connected:
            try:
                await self.send_message({
                    "type": "heartbeat",
                    "agentId": AGENT_ID,
                    "timestamp": time.time(),
                })
                await asyncio.sleep(HEARTBEAT_INTERVAL)
            except Exception as e:
                print(f"Heartbeat error: {e}")
                self.connected = False
                break

    async def shutdown(self, reason: str = ""):
        """Stop connector and close any active connections"""
        if self._shutdown_started:
            return

        self._shutdown_started = True
        if self.last_status_sent != "disconnecting":
            await self.send_status("disconnecting")
        if reason:
            print(f"\\n{reason}")
        else:
            print("\\nStopping connector.")

        self.running = False
        self.connected = False
        previous_connection_type = self.connection_type
        self.connection_type = None

        if self.websocket:
            try:
                await self.websocket.close()
            except Exception as e:
                print(f"Error closing WebSocket connection: {e}")
            finally:
                self.websocket = None

        if self.writer:
            try:
                self.writer.close()
                await self.writer.wait_closed()
            except Exception as e:
                print(f"Error closing P2P connection: {e}")
            finally:
                self.writer = None
                self.reader = None

        if previous_connection_type:
            print(f"Closed {previous_connection_type.upper()} connection. Goodbye!")

        print("Disconnected from platform")

    async def _evaluate_shutdown(self):
        """Check whether we should disconnect after hitting the game cap."""
        if MAX_GAMES_PER_SESSION and self.games_played >= MAX_GAMES_PER_SESSION:
            if not self.shutdown_pending:
                self.shutdown_pending = True
                if self.last_status_sent != "draining":
                    await self.send_status("draining")
            if self.active_games:
                print("Test mode: waiting for remaining games to finish before disconnecting...")
                return
            await self.shutdown(
                "Reached MAX_GAMES_PER_SESSION limit. Disconnecting to prevent further matchmaking."
            )

    async def _update_capacity_status(self):
        """Ensure scheduler knows when capacity is full."""
        if not MAX_GAMES_PER_SESSION:
            return
        # Only consider completed games, not active ones
        # This prevents premature draining status that would cancel ongoing games
        remaining = MAX_GAMES_PER_SESSION - self.games_played
        if remaining <= 0 and not self.shutdown_pending and self.last_status_sent != "draining":
            await self.send_status("draining")

    async def send_status(self, status: str):
        """Notify platform of current availability status."""
        try:
            await self.send_message({
                "type": "status",
                "status": status,
                "timestamp": time.time(),
            })
            self.last_status_sent = status
        except Exception as e:
            print(f"Failed to send status '{status}': {e}")

    def reconstruct_board_from_json(self, board_data: Dict[str, Any]):
        """
        Reconstruct a Board object from initial position + move history.
        This ensures the board has the same ChessMaker internal state as the server.

        Args:
            board_data: Dict with format {'initial_board': {...}, 'moves': [...]}

        Returns:
            Board object with pieces at correct positions and correct internal state
        """
        from chessmaker.chess.base import Board, Player, Square
        from chessmaker.chess.pieces import King, Bishop, Knight, Queen
        from extension.piece_right import Right
        from extension.piece_pawn import Pawn_Q
        from itertools import cycle

        # Create players
        white = Player("white")
        black = Player("black")

        # Get initial board and move history
        initial_board = board_data.get('initial_board', {})
        moves = board_data.get('moves', [])

        # Get board dimensions
        board_width = initial_board.get('width', 5)
        board_height = initial_board.get('height', 5)

        # Create empty board
        squares = [[Square() for _ in range(board_width)] for _ in range(board_height)]

        # Place initial pieces
        piece_classes = {
            'King': King,
            'Queen': Queen,
            'Bishop': Bishop,
            'Knight': Knight,
            'Right': Right,
            'Pawn': Pawn_Q,
            'Pawn_Q': Pawn_Q,
        }

        pieces_data = initial_board.get('pieces', [])
        for piece_info in pieces_data:
            piece_type = piece_info['type']
            player_name = piece_info['player']
            x = piece_info['x']
            y = piece_info['y']

            # Get the correct player object
            player = white if player_name == 'white' else black

            # Create piece instance
            if piece_type in piece_classes:
                piece = piece_classes[piece_type](player)
                squares[y][x] = Square(piece)

        # Create Board with players and turn iterator
        players = [white, black]
        board = Board(
            squares=squares,
            players=players,
            turn_iterator=cycle(players),
        )

        # Replay all moves to reconstruct correct state
        for move_info in moves:
            from_pos = move_info['from']
            to_pos = move_info['to']

            # Get the piece at from position
            from_piece = board._squares[from_pos['y']][from_pos['x']].piece
            if not from_piece:
                print(f"[CLIENT_ERROR] No piece at ({from_pos['x']},{from_pos['y']}) for move to ({to_pos['x']},{to_pos['y']})")
                continue

            # Find the matching move in legal moves
            legal_moves = from_piece.get_move_options()
            matching_move = None
            for move_opt in legal_moves:
                if move_opt.position.x == to_pos['x'] and move_opt.position.y == to_pos['y']:
                    matching_move = move_opt
                    break

            if matching_move:
                # Apply the move
                from_piece.move(matching_move)
            else:
                print(f"[CLIENT_ERROR] Move ({from_pos['x']},{from_pos['y']})->({to_pos['x']},{to_pos['y']}) not in legal moves")

        return board

    async def handle_move_request(self, message: Dict[str, Any]):
        """Handle a move request from the platform"""
        game_id = message.get("gameId")

        try:
            self.in_game = True
            if game_id and game_id not in self.active_games:
                self.active_games.add(game_id)
                if MAX_GAMES_PER_SESSION and self.primary_game_id is None:
                    self.primary_game_id = game_id
                await self._update_capacity_status()
            self.current_game_id = game_id
            self.current_request_id = message.get("requestId")  # Track request ID for response routing

            print(f"\\n[Game {self.current_game_id}] Move request received")
            print(f"  Playing as: {message.get('player', 'unknown')}")

            # Reconstruct board state
            board_data = message.get("board")
            player_data = message.get("player")
            var_data = message.get("var", {})

            # Time the agent's move
            start_time = time.time()

            # Call the agent function with timeout
            try:
                # Reconstruct board from JSON data
                board = self.reconstruct_board_from_json(board_data)
                # Find the correct player by name (NOT by index!)
                player = next((p for p in board.players if p.name == player_data), board.players[0])

                # Call agent with strict timeout
                piece, move = await asyncio.wait_for(
                    asyncio.to_thread(self.agent_module.agent, board, player, var_data),
                    timeout=MOVE_TIMEOUT
                )

                elapsed = time.time() - start_time

                if piece and move:
                    # Serialize move
                    move_data = {
                        "piecePosition": {"x": piece.position.x, "y": piece.position.y},
                        "movePosition": {"x": move.position.x, "y": move.position.y},
                        "pieceType": type(piece).__name__,
                    }

                    # Send move back to platform
                    await self.send_message({
                        "type": "move",
                        "gameId": self.current_game_id,
                        "requestId": self.current_request_id,  # Include request ID for response routing
                        "move": move_data,
                        "elapsed": elapsed,
                    })

                    print(f"  ✓ Move sent: {type(piece).__name__} ({piece.position.x},{piece.position.y}) -> ({move.position.x},{move.position.y})")
                    print(f"  Time: {elapsed:.3f}s")
                else:
                    raise Exception("Agent returned invalid move")

            except asyncio.TimeoutError:
                print(f"  ✗ TIMEOUT after {MOVE_TIMEOUT}s - Forfeiting game")
                await self.send_message({
                    "type": "timeout",
                    "gameId": self.current_game_id,
                    "requestId": self.current_request_id,  # Include request ID for response routing
                })
            except Exception as e:
                print(f"  ✗ ERROR: {e}")
                await self.send_message({
                    "type": "error",
                    "gameId": self.current_game_id,
                    "requestId": self.current_request_id,  # Include request ID for response routing
                    "error": str(e),
                })

        except Exception as e:
            print(f"Error handling move request: {e}")
        finally:
            self.in_game = False

    async def handle_message(self, message_str: str):
        """Handle incoming message from platform"""
        try:
            message = json.loads(message_str)
            msg_type = message.get("type")

            if msg_type == "move_request":
                await self.handle_move_request(message)
            elif msg_type == "game_start":
                game_id = message.get('gameId')
                print(f"\\n[Game {game_id}] Game started!")
                print(f"  White: {message.get('white')}")
                print(f"  Black: {message.get('black')}")
                if game_id:
                    self.active_games.add(game_id)
                    if MAX_GAMES_PER_SESSION and self.primary_game_id is None:
                        self.primary_game_id = game_id
                    await self._update_capacity_status()
            elif msg_type == "game_end":
                game_id = message.get('gameId')
                result = message.get('result')
                print(f"\\n[Game {game_id}] Game ended")
                print(f"  Result: {result}")
                print(f"  Winner: {message.get('winner', 'Draw')}")
                self.current_game_id = None
                if game_id in self.active_games:
                    self.active_games.discard(game_id)
                if result not in CANCELLED_RESULTS:
                    self.games_played += 1
                    print(f"  Games played this session: {self.games_played}")
                    if game_id == self.primary_game_id:
                        self.primary_game_id = None
                else:
                    print("  Game cancelled before completion; not counting toward limit.")
                    if game_id == self.primary_game_id:
                        self.primary_game_id = None
                await self._evaluate_shutdown()
            elif msg_type == "matchmaking":
                print(f"Matchmaking update: {message.get('status')}")
            elif msg_type == "error":
                print(f"Platform error: {message.get('error')}")
            elif msg_type == "disconnect":
                print(f"Disconnected by platform: {message.get('reason')}")
                self.running = False

        except json.JSONDecodeError:
            print(f"Invalid message received: {message_str}")
        except Exception as e:
            print(f"Error handling message: {e}")

    async def listen(self):
        """Listen for messages from the platform"""
        try:
            while self.running and self.connected:
                try:
                    message_data = await self.receive_message(timeout=HEARTBEAT_INTERVAL * 2)

                    if message_data is None:
                        # Timeout - continue
                        continue

                    await self.handle_message(json.dumps(message_data))
                except Exception as e:
                    if "ConnectionClosed" in str(type(e).__name__) or not self.connected:
                        print("Connection closed by server")
                        self.connected = False
                        break
                    else:
                        raise
        except Exception as e:
            print(f"Listen error: {e}")
            self.connected = False

    async def run(self):
        """Main run loop with reconnection logic"""
        await self.load_agent()

        # Setup signal handlers for graceful shutdown
        def signal_handler(sig, frame):
            print("\\n\\nShutting down gracefully...")
            self.running = False

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        while self.running:
            # Try P2P first, fall back to WebSocket
            connected = await self.connect_p2p()

            if not connected:
                print("P2P failed, falling back to WebSocket...")
                connected = await self.connect_websocket()

            if connected:
                # Run heartbeat and listener concurrently
                try:
                    await asyncio.gather(
                        self.send_heartbeat(),
                        self.listen()
                    )
                except Exception as e:
                    print(f"Runtime error: {e}")

            if self.running:
                print(f"Reconnecting in {RECONNECT_DELAY} seconds...")
                await asyncio.sleep(RECONNECT_DELAY)

        await self.shutdown()

if __name__ == "__main__":
    print("=" * 60)
    print("Chess Fragments Platform - Local Agent Connector")
    print("=" * 60)
    print(f"Agent ID: {AGENT_ID}")
    print(f"Connection: {WS_URL}")
    print("=" * 60)

    connector = LocalAgentConnector()
    asyncio.run(connector.run())
`;
}
