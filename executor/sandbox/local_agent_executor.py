"""
Local Agent Execution Interface

This module provides an interface for the executor to communicate with
local agents connected via WebSocket.
"""

import sys
import os
import json
from pathlib import Path

# Add the executor directory to the path to import local_agent_server
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from local_agent_server import manager as local_agent_manager
except ImportError:
    # If running in different context, create a client to communicate with the WS server
    local_agent_manager = None


def is_agent_local(agent_id: str, db_connection) -> bool:
    """
    Check if an agent is configured for local execution and currently connected.

    Args:
        agent_id: The agent's UUID
        db_connection: psycopg2 connection object

    Returns:
        bool: True if agent is local and connected
    """
    try:
        cur = db_connection.cursor()
        cur.execute("""
            SELECT a.execution_mode, lac.status
            FROM agents a
            LEFT JOIN local_agent_connections lac ON a.id = lac.agent_id
            WHERE a.id = %s
        """, (agent_id,))

        result = cur.fetchone()
        cur.close()

        if not result:
            return False

        execution_mode, connection_status = result

        # Agent must be in local mode AND currently connected
        return execution_mode == 'local' and connection_status == 'connected'

    except Exception as e:
        print(f"Error checking if agent is local: {e}")
        return False


def serialize_board_for_local_agent(board):
    """
    Serialize board state for transmission to local agent.

    Args:
        board: chessmaker Board object

    Returns:
        dict: Serialized board state
    """
    pieces = []
    for y in range(5):
        for x in range(5):
            square = board.get_square_at(x, y)
            if square and hasattr(square, 'piece') and square.piece:
                piece = square.piece
                pieces.append({
                    'type': type(piece).__name__,
                    'player': piece.player.name,
                    'x': x,
                    'y': y,
                })

    return {'pieces': pieces}


async def get_move_from_local_agent(agent_id: str, board, player, var: dict, game_id: str):
    """
    Request a move from a local agent via WebSocket.

    Args:
        agent_id: The agent's UUID
        board: chessmaker Board object
        player: chessmaker Player object
        var: Additional game variables
        game_id: Current game/match ID

    Returns:
        tuple: (piece, move) or (None, None) on failure
    """
    if not local_agent_manager:
        print("Local agent manager not available")
        return None, None

    try:
        # Serialize board state
        board_data = serialize_board_for_local_agent(board)
        try:
            print(f"[HYRBIDF] bridge-send game={game_id} agent={agent_id} player={player.name} pieces={len(board_data.get('pieces', []))}", flush=True)
        except Exception:
            pass

        # Prepare request
        game_data = {
            'gameId': game_id,
            'board': board_data,
            'player': player.name,
            'var': var or {}
        }

        # Request move from local agent (with timeout)
        response = await local_agent_manager.request_move(agent_id, game_data)
        print(f"[HYRBIDF] bridge-recv game={game_id} agent={agent_id} raw={response}", flush=True)

        if not response:
            print(f"[HYRBIDF] No response from local agent {agent_id}")
            return None, None

        # Handle timeout
        if response.get('timeout'):
            print(f"[HYRBIDF] Local agent {agent_id} timed out")
            return None, None

        # Handle error
        if response.get('error'):
            print(f"[HYRBIDF] Local agent {agent_id} error: {response['error']}")
            return None, None

        # Handle disconnection
        if response.get('disconnected'):
            print(f"[HYRBIDF] Local agent {agent_id} disconnected")
            return None, None

        # Parse move response (support both new keyed format and legacy flat format)
        move_data = response.get('move', response)
        if not move_data or not isinstance(move_data, dict):
            print(f"[HYRBIDF] Invalid move data from local agent {agent_id}: {move_data}")
            return None, None

        # Reconstruct move from response
        piece_pos = move_data.get('piecePosition', {})
        move_pos = move_data.get('movePosition', {})

        if not piece_pos or not move_pos:
            print(f"[HYRBIDF] Invalid move format from local agent {agent_id}")
            return None, None

        # Find the piece on the board
        piece = None
        for p in board.get_player_pieces(player):
            if p.position.x == piece_pos['x'] and p.position.y == piece_pos['y']:
                piece = p
                break

        if not piece:
            print(f"[HYRBIDF] Piece not found at ({piece_pos['x']}, {piece_pos['y']}) for agent {agent_id}")
            return None, None

        # Find the move option
        move = None
        for m in piece.get_move_options():
            if hasattr(m, 'position') and m.position.x == move_pos['x'] and m.position.y == move_pos['y']:
                move = m
                break

        if not move:
            print(f"[HYRBIDF] Move not found to ({move_pos['x']}, {move_pos['y']}) for piece at ({piece_pos['x']}, {piece_pos['y']})")
            return None, None

        print(f"[HYRBIDF] bridge-validated game={game_id} agent={agent_id} from=({piece_pos.get('x')},{piece_pos.get('y')}) to=({move_pos.get('x')},{move_pos.get('y')}) type={type(piece).__name__}", flush=True)
        return piece, move

    except Exception as e:
        print(f"[HYRBIDF] Error getting move from local agent {agent_id}: {e}")
        import traceback
        traceback.print_exc()
        return None, None


def check_local_agent_connected(agent_id: str) -> bool:
    """
    Quick check if local agent is currently connected (uses in-memory state).

    Args:
        agent_id: The agent's UUID

    Returns:
        bool: True if connected
    """
    if not local_agent_manager:
        return False

    try:
        from local_agent_server import is_agent_connected
        return is_agent_connected(agent_id)
    except:
        return False
