"""
Docker-based agent execution sandbox
"""
import docker
import json
import tempfile
import os
import sys
import time
import random
import signal
from pathlib import Path

# Add shared directory to Python path
sys.path.insert(0, str(Path(__file__).parent.parent / 'shared'))

from itertools import cycle
from chessmaker.chess.base import Board, Player
from extension.board_utils import list_legal_moves_for, copy_piece_move
from extension.board_rules import get_result
from constants import get_default_agent_var
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

# Global timeout for agent moves - read from environment
AGENT_TIMEOUT_SECONDS = float(os.getenv('AGENT_TIMEOUT_SECONDS', '14.0'))


def execute_agent_with_timeout(agent_func, board, player, timeout_seconds, var=None):
    """
    Execute agent function with timeout.
    Returns (piece, move_opt, move_time_ms, timed_out)
    If timeout occurs, waits full timeout duration then returns (None, None, None, True)
    """
    executor = ThreadPoolExecutor(max_workers=1)

    start_time = time.time()
    agent_var = var if var is not None else get_default_agent_var()
    future = executor.submit(agent_func, board.clone(), player, agent_var)

    try:
        result = future.result(timeout=timeout_seconds)
        end_time = time.time()
        move_time_ms = int((end_time - start_time) * 1000)

        if result is None or not isinstance(result, tuple) or len(result) != 2:
            return None, None, move_time_ms, False

        piece, move_opt = result
        return piece, move_opt, move_time_ms, False

    except FutureTimeoutError:
        # Agent exceeded timeout - wait for full timeout duration
        elapsed = time.time() - start_time
        remaining = timeout_seconds - elapsed
        if remaining > 0:
            time.sleep(remaining)

        future.cancel()
        # Return None for move_time_ms to indicate timeout
        return None, None, None, True

    except Exception as e:
        end_time = time.time()
        move_time_ms = int((end_time - start_time) * 1000)
        print(f"Agent execution error: {e}")
        return None, None, move_time_ms, False

    finally:
        executor.shutdown(wait=False)


def run_match_local(white_code: str, black_code: str, board_sample) -> dict:
    """
    Run a match between two agents locally (without Docker for testing)

    Returns:
        {
            'winner': 'white' | 'black' | 'draw' | None,
            'moves': int,
            'termination': str,
            'game_states': List[dict]
        }
    """
    # Create temporary module for agents
    import types
    import sys as _sys
    from extension import board_utils, board_rules

    # Create a fake 'extension' module in sys.modules so imports work
    if 'extension' not in _sys.modules:
        extension_module = types.ModuleType('extension')
        extension_module.board_utils = board_utils
        extension_module.board_rules = board_rules
        _sys.modules['extension'] = extension_module

    white_module = types.ModuleType('white_agent')
    black_module = types.ModuleType('black_agent')

    try:
        exec(white_code, white_module.__dict__)
    except Exception as e:
        import traceback
        return {
            'winner': 'black',
            'moves': 0,
            'termination': 'white_error',
            'error': f'White agent failed to load: {str(e)}\n{traceback.format_exc()}',
            'game_states': []
        }

    try:
        exec(black_code, black_module.__dict__)
    except Exception as e:
        import traceback
        return {
            'winner': 'white',
            'moves': 0,
            'termination': 'black_error',
            'error': f'Black agent failed to load: {str(e)}\n{traceback.format_exc()}',
            'game_states': []
        }

    # Extract agent functions
    if 'agent' not in white_module.__dict__:
        return {
            'winner': 'black',
            'moves': 0,
            'termination': 'white_error',
            'error': 'White agent code does not define an "agent" function',
            'game_states': []
        }

    if 'agent' not in black_module.__dict__:
        return {
            'winner': 'white',
            'moves': 0,
            'termination': 'black_error',
            'error': 'Black agent code does not define an "agent" function',
            'game_states': []
        }

    white_agent = white_module.__dict__['agent']
    black_agent = black_module.__dict__['agent']

    # Import the SAME player objects used to create the pieces in samples.py
    # This is CRITICAL - the pieces in board_sample were created with these player objects
    from samples import white, black

    # Use the global player objects from samples.py (NOT new Player objects!)
    players = [white, black]

    # Create board
    board = Board(
        squares=board_sample,
        players=players,
        turn_iterator=cycle(players),
    )

    turn_order = cycle(players)
    moves = 0
    max_moves = 500
    game_states = []
    max_retries_per_move = 5

    # Initialize per-agent vars - maintains ply count for each agent
    white_ply = 1
    black_ply = 1

    while moves < max_moves:
        try:
            player = next(turn_order)
            moves += 1

            # Debug: check available moves
            legal_moves = list_legal_moves_for(board, player)
            print(f"Move {moves}, {player.name} turn: {len(legal_moves)} legal moves available")

            # Get move from agent with timeout enforcement
            p_piece, p_move_opt = None, None
            move_time_ms = 0
            timed_out = False

            # Execute agent with timeout
            if player.name == "white":
                p_piece, p_move_opt, move_time_ms, timed_out = execute_agent_with_timeout(
                    white_agent,
                    board,
                    player,
                    AGENT_TIMEOUT_SECONDS,
                    [white_ply, AGENT_TIMEOUT_SECONDS],
                )
                if timed_out:
                    print(f"White agent TIMEOUT on move {moves} - will forfeit game")
                white_ply += 1
            else:
                p_piece, p_move_opt, move_time_ms, timed_out = execute_agent_with_timeout(
                    black_agent,
                    board,
                    player,
                    AGENT_TIMEOUT_SECONDS,
                    [black_ply, AGENT_TIMEOUT_SECONDS],
                )
                if timed_out:
                    print(f"Black agent TIMEOUT on move {moves} - will forfeit game")
                black_ply += 1

            # If timed out, agent forfeits the game
            if timed_out:
                winner = "black" if player.name == "white" else "white"
                print(f"{player.name} TIMEOUT - forfeiting game to {winner}")
                return {
                    'winner': winner,
                    'moves': moves,
                    'termination': 'timeout',
                    'game_states': game_states
                }

            # If invalid move returned, choose random legal move
            if not p_piece or not p_move_opt:
                if legal_moves:
                    # Choose random legal move
                    random_piece, random_move = random.choice(legal_moves)
                    p_piece, p_move_opt = random_piece, random_move
                    print(f"{player.name} invalid move - selected random move: {random_piece.name if random_piece else 'None'}")
                else:
                    # No legal moves available - agent loses
                    winner = "black" if player.name == "white" else "white"
                    print(f"{player.name} has no legal moves available")
                    return {
                        'winner': winner,
                        'moves': moves,
                        'termination': 'no_moves',
                        'game_states': game_states
                    }

            board, piece, move_opt = copy_piece_move(board, p_piece, p_move_opt)

            if (not piece) or (not move_opt):
                # copy_piece_move failed - move was invalid, use random fallback
                print(f"{player.name} returned move that failed validation - selecting random move")
                if legal_moves:
                    random_piece, random_move = random.choice(legal_moves)
                    p_piece, p_move_opt = random_piece, random_move
                    board, piece, move_opt = copy_piece_move(board, p_piece, p_move_opt)

                    if (not piece) or (not move_opt):
                        # Even random move failed - this should never happen but handle it
                        winner = "black" if player.name == "white" else "white"
                        print(f"CRITICAL: Random move also failed for {player.name}")
                        return {
                            'winner': winner,
                            'moves': moves,
                            'termination': 'error',
                            'error': f'{player.name} - critical error: random move failed',
                            'game_states': game_states
                        }
                else:
                    # No legal moves available
                    winner = "black" if player.name == "white" else "white"
                    print(f"{player.name} has no legal moves available")
                    return {
                        'winner': winner,
                        'moves': moves,
                        'termination': 'no_moves',
                        'game_states': game_states
                    }

            # Execute move
            piece.move(move_opt)

            # Record state - handle piece position safely
            try:
                if piece and piece.position:
                    notation = f"{piece.name}({piece.position.x},{piece.position.y})"
                else:
                    notation = f"{p_piece.name if p_piece else 'Unknown'}(?,?)"
            except Exception as e:
                print(f"Error creating notation: {e}, piece={piece}, p_piece={p_piece}")
                notation = "Unknown(?,?)"

            # Record game state - use None for move_time_ms if timeout occurred
            # The UI will display this as "Timeout"
            game_states.append({
                'move_number': moves,
                'board_state': serialize_board(board),
                'move_time_ms': move_time_ms,  # Will be None if timed out
                'notation': notation
            })

            # Check for game end
            result = get_result(board)
            if result:
                result_lower = result.lower()

                # Determine winner - checkmate says "{player} loses", so invert it
                if "loses" in result_lower or "lost" in result_lower:
                    # Result format: "Checkmate - {loser} loses"
                    if "white" in result_lower:
                        winner = "black"  # white lost, so black won
                    elif "black" in result_lower:
                        winner = "white"  # black lost, so white won
                    else:
                        winner = None  # draw/stalemate
                elif "wins" in result_lower or "won" in result_lower:
                    # If format is "{winner} wins"
                    if "white" in result_lower:
                        winner = "white"
                    elif "black" in result_lower:
                        winner = "black"
                    else:
                        winner = None  # draw/stalemate
                else:
                    winner = None  # draw/stalemate

                # Determine termination reason
                if "checkmate" in result_lower:
                    termination = "checkmate"
                elif "stalemate" in result_lower:
                    termination = "stalemate"
                elif "draw" in result_lower or "repetition" in result_lower:
                    termination = "draw"
                elif "kings" in result_lower:
                    termination = "insufficient_material"
                else:
                    termination = "game_over"

                return {
                    'winner': winner,
                    'moves': moves,
                    'termination': termination,
                    'game_states': game_states
                }

        except Exception as e:
            winner = "black" if player.name == "white" else "white"
            termination = "white_error" if player.name == "white" else "black_error"
            return {
                'winner': winner,
                'moves': moves,
                'termination': termination,
                'error': str(e),
                'game_states': game_states
            }

    # Max moves reached
    return {
        'winner': None,
        'moves': moves,
        'termination': 'max_moves',
        'game_states': game_states
    }


def serialize_board(board) -> dict:
    """Serialize board state to JSON"""
    pieces = []
    for piece in board.get_pieces():
        pieces.append({
            'type': type(piece).__name__,
            'player': piece.player.name,
            'x': piece.position.x,
            'y': piece.position.y,
        })
    return {'pieces': pieces}


def run_match_docker(white_code: str, black_code: str) -> dict:
    """
    Run a match in Docker container (future implementation)
    """
    # TODO: Implement Docker-based execution
    raise NotImplementedError("Docker execution not yet implemented")
