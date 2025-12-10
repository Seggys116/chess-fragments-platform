"""
Hybrid Match Executor - Supports both local and server agents
"""
import json
import time
import redis
import uuid
import os
import sys
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

sys.path.insert(0, str(Path(__file__).parent.parent / 'shared'))
from constants import get_default_agent_var
from extension.board_utils import list_legal_moves_for
from samples import white as white_player_global, black as black_player_global

REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379')
# Move timeout - read from environment
AGENT_TIMEOUT_SECONDS = float(os.getenv('AGENT_TIMEOUT_SECONDS', '16.0'))
# Server-side timeout: agent timeout + buffer for dispatch delays, network, and response routing
# This accounts for: Redis queue delays, WebSocket forwarding, network latency
# Agent still has strict 16s enforced locally - this just prevents premature server-side timeout
MOVE_TIMEOUT = AGENT_TIMEOUT_SECONDS + 5.0  # 19s total server wait time

# Game state cache: stores initial board + move history per game for local agents
# Format: game_id -> {'initial_board': {...}, 'moves': [...]}
_game_state_cache = {}


class AgentDisconnectedError(Exception):
    """Raised when a local agent disconnects during an active move request."""

    def __init__(self, agent_id: str, game_id: Optional[str] = None, reason: Optional[str] = None):
        self.agent_id = agent_id
        self.game_id = game_id
        self.reason = reason or 'Agent disconnected'
        message = f"Local agent {agent_id} disconnected{f' during game {game_id}' if game_id else ''}: {self.reason}"
        super().__init__(message)

class LocalAgentBridge:
    """Bridge to communicate with local agents via Redis pub/sub"""

    def __init__(self):
        self.redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        self.pubsub = self.redis_client.pubsub()

    def request_move(self, agent_id: str, board_state: Dict, player: str, var: Dict, game_id: str) -> Optional[Tuple[Dict, float, bool]]:
        """
        Request a move from a local agent via WebSocket
        Returns: (move_data, elapsed_time, explicit_timeout) or None on disconnect
        - explicit_timeout is True if agent explicitly reported timeout
        """
        request_id = str(uuid.uuid4())
        response_channel = f'move_response:{request_id}'
        disconnect_channel = f'local_agent:{agent_id}:disconnect'
        self.pubsub.subscribe(response_channel, disconnect_channel)

        # Publish move request to local agent
        request = {
            'type': 'move_request',
            'requestId': request_id,
            'agentId': agent_id,
            'gameId': game_id,
            'board': board_state,
            'player': player,
            'var': var,
            'responseChannel': response_channel,
        }

        print(f"[HYRBIDF] redis-send agent={agent_id} game={game_id} request={request_id} player={player} pieces={len(board_state.get('pieces', []))}", flush=True)
        self.redis_client.publish(f'local_agent:{agent_id}:move_request', json.dumps(request))

        # Wait for response with timeout
        start_time = time.time()
        timeout_time = start_time + MOVE_TIMEOUT
        move_received = False

        try:
            while time.time() < timeout_time:
                message = self.pubsub.get_message(timeout=0.1)
                if message and message['type'] == 'message':
                    try:
                        channel = message.get('channel')
                        payload = json.loads(message['data'])
                        elapsed = time.time() - start_time
                        if channel == response_channel:
                            print(f"[HYRBIDF] redis-recv agent={agent_id} game={game_id} request={request_id} payload={payload}", flush=True)

                            response_type = payload.get('type')
                            if response_type == 'move':
                                move_data = payload.get('move')
                                agent_elapsed = payload.get('elapsed')
                                move_received = True
                                # Trust agent's reported time for computation (not affected by Redis/network)
                                # Server time includes network latency which shouldn't penalize the agent
                                # Only flag if agent claims impossibly short time (< 0.001s) - likely a bug
                                if agent_elapsed is not None:
                                    if agent_elapsed < 0.001:
                                        # Suspiciously fast - use server time
                                        print(f"[HYRBIDF] time-suspicious agent={agent_id} agent_elapsed={agent_elapsed:.3f}s server_elapsed={elapsed:.3f}s (using server)", flush=True)
                                        return (move_data, elapsed, False)
                                    if agent_elapsed > elapsed + 1.0:
                                        # Agent claims longer than round-trip - something wrong, log but use agent's
                                        print(f"[HYRBIDF] time-anomaly agent={agent_id} agent_elapsed={agent_elapsed:.3f}s server_elapsed={elapsed:.3f}s (using agent)", flush=True)
                                    return (move_data, agent_elapsed, False)
                                return (move_data, elapsed, False)
                            if response_type == 'timeout':
                                # Agent explicitly reported timeout - flag it
                                print(f"Local agent {agent_id} explicitly timed out")
                                return (None, elapsed, True)
                            if response_type == 'error':
                                print(f"Local agent {agent_id} error: {payload.get('error')}")
                                return (None, elapsed, False)
                            if response_type == 'disconnected':
                                raise AgentDisconnectedError(agent_id, payload.get('gameId'), payload.get('reason'))
                        elif channel == disconnect_channel:
                            # Only raise disconnect error if we haven't received a move yet
                            # This prevents race condition where disconnect arrives after valid move
                            if not move_received:
                                print(f"[HYRBIDF] redis-disconnect agent={agent_id} payload={payload}", flush=True)
                                raise AgentDisconnectedError(agent_id, payload.get('gameId'), payload.get('reason'))
                            else:
                                print(f"[HYRBIDF] redis-disconnect ignored (move already received) agent={agent_id}", flush=True)

                    except json.JSONDecodeError:
                        print(f"Invalid response from local agent {agent_id}")
                        continue
        finally:
            try:
                self.pubsub.unsubscribe(response_channel, disconnect_channel)
            except Exception as unsubscribe_error:
                print(f"[HYRBIDF] redis-unsubscribe failed channel={response_channel} err={unsubscribe_error}", flush=True)

        # Communication timeout - server didn't get a response in time
        elapsed = time.time() - start_time
        print(f"Move request communication timed out for local agent {agent_id}")

        # Check if agent is still connected - if not, treat as disconnect not timeout
        try:
            agent_status = self.redis_client.hget(f'local_agent:{agent_id}', 'status')
            # If status is None (key doesn't exist) or not connected/in_game, treat as disconnect
            if not agent_status or (agent_status != 'connected' and agent_status != 'in_game'):
                print(f"[HYRBIDF] timeout-disconnect agent={agent_id} status={agent_status or 'None'} (treating as disconnect not timeout)", flush=True)
                raise AgentDisconnectedError(agent_id, game_id, 'Agent disconnected during move timeout')
        except AgentDisconnectedError:
            raise
        except Exception as e:
            print(f"[HYRBIDF] Failed to check agent connection status: {e}", flush=True)
            # If we can't check status, assume it's a legitimate timeout rather than failing the match

        return (None, elapsed, True)

    def notify_game_start(self, agent_id: str, game_id: str, white: str, black: str):
        """Notify local agent that a game has started"""
        notification = {
            'type': 'game_start',
            'gameId': game_id,
            'white': white,
            'black': black,
        }
        self.redis_client.publish(f'local_agent:{agent_id}:notifications', json.dumps(notification))

    def notify_game_end(self, agent_id: str, game_id: str, result: str, winner: Optional[str]):
        """Notify local agent that a game has ended"""
        notification = {
            'type': 'game_end',
            'gameId': game_id,
            'result': result,
            'winner': winner,
        }
        self.redis_client.publish(f'local_agent:{agent_id}:notifications', json.dumps(notification))

    def close(self):
        """Clean up pub/sub connection"""
        self.pubsub.close()


def get_agent_move(agent_code: Optional[str], agent_id: str, execution_mode: str, board, player, var, game_id: str, agent_func=None):
    """
    Get move from agent - supports both local and server execution

    Args:
        agent_code: Python code (for server agents) or None (for local agents)
        agent_id: Agent ID
        execution_mode: 'server' or 'local'
        board: Board object
        player: Player object
        var: Additional variables
        game_id: Match/game ID
        agent_func: Pre-loaded agent function (for server agents to preserve globals)

    Returns:
        Tuple of (piece, move, elapsed_time, explicit_timeout)
        - explicit_timeout is True if agent explicitly reported timeout
    """
    if execution_mode == 'local':
        # Use Redis bridge to communicate with local agent
        bridge = LocalAgentBridge()

        # Serialize board state with move history
        board_state = serialize_board_for_local_agent(board, game_id)
        player_name = player.name  # 'white' or 'black'

        # Debug: Log board state being sent to agent
        move_count = len(board_state.get('moves', []))
        initial_pieces = len(board_state.get('initial_board', {}).get('pieces', []))
        print(f"[SEND_TO_AGENT] agent={agent_id} game={game_id} player={player_name} initial_pieces={initial_pieces} move_history={move_count}", flush=True)

        try:
            result = bridge.request_move(agent_id, board_state, player_name, var, game_id)
        finally:
            bridge.close()

        if result:
            move_data, elapsed, explicit_timeout = result
            if move_data:
                # Debug: Log what the agent sent back
                piece_pos = move_data.get('piecePosition', {})
                move_pos = move_data.get('movePosition', {})
                print(f"[AGENT_RESPONSE] agent={agent_id} piece=({piece_pos.get('x')},{piece_pos.get('y')}) move=({move_pos.get('x')},{move_pos.get('y')}) type={move_data.get('pieceType')}", flush=True)

                # Reconstruct piece and move from move_data
                piece, move = reconstruct_move_from_data(board, move_data, game_id, player_name)

                # Move validation successful - history will be updated in match executor after move is applied

                return (piece, move, elapsed, False)
            else:
                # Agent timed out or errored, but we have elapsed time
                return (None, None, elapsed, explicit_timeout)
        else:
            # This should not happen anymore, but keep as fallback
            return (None, None, MOVE_TIMEOUT, True)

    else:
        if agent_func is None:
            import types
            agent_module = types.ModuleType('temp_agent')
            exec(agent_code, agent_module.__dict__)
            agent_func = agent_module.__dict__['agent']

        from sandbox.agent_executor import execute_agent_with_timeout
        piece, move, time_ms, timed_out = execute_agent_with_timeout(
            agent_func,
            board,
            player,
            AGENT_TIMEOUT_SECONDS,
            var,
        )
        elapsed = time_ms / 1000.0 if time_ms else AGENT_TIMEOUT_SECONDS
        return (piece, move, elapsed, timed_out)


def init_game_state(game_id: str, board):
    """Initialize game state cache with initial board position"""
    squares = getattr(board, '_squares', [])
    height = len(squares)
    width = len(squares[0]) if height else 0

    pieces = []
    for y in range(height):
        for x in range(width):
            square = squares[y][x]
            if square and hasattr(square, 'piece') and square.piece:
                piece = square.piece
                pieces.append({
                    'type': type(piece).__name__,
                    'player': piece.player.name,
                    'x': x,
                    'y': y,
                })

    _game_state_cache[game_id] = {
        'initial_board': {'pieces': pieces, 'width': width, 'height': height},
        'moves': []
    }
    print(f"[GAME_INIT] game={game_id} initial_pieces={len(pieces)}", flush=True)


def add_move_to_history(game_id: str, from_x: int, from_y: int, to_x: int, to_y: int, piece_type: str):
    """Add a move to the game's history"""
    if game_id not in _game_state_cache:
        print(f"[GAME_ERROR] game={game_id} not in cache, cannot add move", flush=True)
        return

    _game_state_cache[game_id]['moves'].append({
        'from': {'x': from_x, 'y': from_y},
        'to': {'x': to_x, 'y': to_y},
        'piece': piece_type
    })
    print(f"[GAME_MOVE] game={game_id} move_count={len(_game_state_cache[game_id]['moves'])} {piece_type}:({from_x},{from_y})->({to_x},{to_y})", flush=True)


def clear_game_state(game_id: str):
    """Clear game state from cache when game ends"""
    if game_id in _game_state_cache:
        del _game_state_cache[game_id]
        print(f"[GAME_END] game={game_id} cleared from cache", flush=True)


def serialize_board_for_local_agent(board, game_id: str) -> Dict:
    """
    Serialize board state for local agent.
    Sends initial board position + move history for reconstruction.
    """
    if game_id not in _game_state_cache:
        # First move of the game - initialize
        init_game_state(game_id, board)

    game_state = _game_state_cache[game_id]
    return {
        'initial_board': game_state['initial_board'],
        'moves': game_state['moves']
    }


def reconstruct_board_from_history(game_id: str):
    """
    Reconstruct a board from the initial position + move history.
    This creates a board with the SAME ChessMaker internal state as the client.
    Uses the same global Player objects as the server board for consistency.
    """
    from chessmaker.chess.base import Board as ChessBoard, Square
    from chessmaker.chess.pieces import King, Bishop, Knight, Queen
    from extension.piece_right import Right as RightPiece
    from extension.piece_pawn import Pawn_Q
    from itertools import cycle

    if game_id not in _game_state_cache:
        print(f"[RECONSTRUCT_ERROR] game={game_id} not in cache", flush=True)
        return None

    game_state = _game_state_cache[game_id]
    initial_board = game_state['initial_board']
    moves = game_state['moves']

    # Build piece class map
    piece_classes = {
        'King': King,
        'Queen': Queen,
        'Bishop': Bishop,
        'Knight': Knight,
        'Right': RightPiece,
        'Pawn': Pawn_Q,
        'Pawn_Q': Pawn_Q,
    }

    # Use the same global player objects as the server board for consistency
    white_player = white_player_global
    black_player = black_player_global

    # Create empty board
    width = initial_board['width']
    height = initial_board['height']
    squares = [[Square() for _ in range(width)] for _ in range(height)]

    # Place initial pieces
    for piece_info in initial_board['pieces']:
        piece_type = piece_info['type']
        player_name = piece_info['player']
        x = piece_info['x']
        y = piece_info['y']

        player_obj = white_player if player_name == 'white' else black_player

        if piece_type in piece_classes:
            new_piece = piece_classes[piece_type](player_obj)
            squares[y][x] = Square(new_piece)

    # Create board with same players as server board
    players = [white_player, black_player]
    reconstructed_board = ChessBoard(
        squares=squares,
        players=players,
        turn_iterator=cycle(players),
    )

    # Replay all moves to get correct ChessMaker state
    for move_info in moves:
        from_pos = move_info['from']
        to_pos = move_info['to']

        # Get the piece at from position
        from_piece = reconstructed_board._squares[from_pos['y']][from_pos['x']].piece
        if not from_piece:
            print(f"[RECONSTRUCT_ERROR] No piece at ({from_pos['x']},{from_pos['y']}) for move to ({to_pos['x']},{to_pos['y']})", flush=True)
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
            print(f"[RECONSTRUCT_ERROR] Move ({from_pos['x']},{from_pos['y']})->({to_pos['x']},{to_pos['y']}) not in legal moves", flush=True)

    return reconstructed_board


def reconstruct_move_from_data(board, move_data: Dict, game_id: str, current_player: str):
    """
    Reconstruct piece and move objects from move data.
    Validates against a board reconstructed from move history (same as client).

    Args:
        board: Server board object
        move_data: Move data from local agent
        game_id: Game/match ID
        current_player: Name of player whose turn it is ('white' or 'black')
    """
    try:
        piece_pos = move_data.get('piecePosition', {})
        move_pos = move_data.get('movePosition', {})

        piece_x = piece_pos.get('x')
        piece_y = piece_pos.get('y')
        move_x = move_pos.get('x')
        move_y = move_pos.get('y')

        if None in [piece_x, piece_y, move_x, move_y]:
            print(f"Invalid coordinates in move_data: piece=({piece_x},{piece_y}), move=({move_x},{move_y})")
            return (None, None)

        # Reconstruct board from move history (same as client did)
        client_board = reconstruct_board_from_history(game_id)
        if not client_board:
            print(f"[VALIDATION_ERROR] Could not reconstruct board for game {game_id}", flush=True)
            return (None, None)

        client_squares = getattr(client_board, '_squares', [])
        if not client_squares or piece_y < 0 or piece_x < 0 or piece_y >= len(client_squares) or piece_x >= len(client_squares[0]):
            dims = f"{len(client_squares)}x{len(client_squares[0])}" if client_squares else "0x0"
            print(f"[VALIDATION_ERROR] Coordinates out of bounds dims={dims}", flush=True)
            return (None, None)

        # Get piece from CLIENT board (reconstructed from moves)
        client_piece = client_squares[piece_y][piece_x].piece
        if not client_piece:
            print(f"[VALIDATION_ERROR] No piece at ({piece_x},{piece_y}) on client board", flush=True)
            return (None, None)

        # Validate piece belongs to current player
        if client_piece.player.name != current_player:
            print(f"[VALIDATION_ERROR] Piece at ({piece_x},{piece_y}) belongs to {client_piece.player.name}, not {current_player}", flush=True)
            return (None, None)

        # Get the player object for the current player
        current_player_obj = white_player_global if current_player == 'white' else black_player_global

        # Get ALL legal moves for this player using the same method as match executor
        # This ensures consistency between what the server considers legal and what we validate
        all_legal_moves = list_legal_moves_for(client_board, current_player_obj)

        # Find the move that matches the piece position and target position
        for legal_piece, legal_move in all_legal_moves:
            if (legal_piece.position.x == piece_x and legal_piece.position.y == piece_y and
                legal_move.position.x == move_x and legal_move.position.y == move_y):
                # Move is valid on client board!
                # Now get the REAL piece from the server board to return
                server_squares = getattr(board, '_squares', [])
                server_piece = server_squares[piece_y][piece_x].piece

                print(f"[VALIDATION_OK] {type(client_piece).__name__} ({piece_x},{piece_y})->({move_x},{move_y})", flush=True)
                return (server_piece, legal_move)

        # Move not legal - build debug info
        piece_moves = [(p.position.x, p.position.y, m.position.x, m.position.y)
                       for p, m in all_legal_moves if p.position.x == piece_x and p.position.y == piece_y]
        legal_moves_str = ", ".join([f"->({mx},{my})" for _, _, mx, my in piece_moves])
        print(f"[VALIDATION_FAIL] game={game_id} {type(client_piece).__name__} ({piece_x},{piece_y})->({move_x},{move_y}) Legal=[{legal_moves_str}]", flush=True)
        return (None, None)

    except Exception as e:
        import traceback
        print(f"Error reconstructing move: {e}")
        print(traceback.format_exc())
        return (None, None)
