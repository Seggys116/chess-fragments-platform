"""
Hybrid Match Executor - Runs matches with local and/or server agents

Handles all combinations:
- local vs local
- local vs server
- server vs server
"""
import sys
import os
import types
import random
from pathlib import Path
from itertools import cycle

# Add shared directory to Python path
sys.path.insert(0, str(Path(__file__).parent.parent / 'shared'))

from chessmaker.chess.base import Board, Player
from extension.board_utils import copy_piece_move, list_legal_moves_for
from extension.board_rules import get_result
from samples import white, black
from constants import get_default_agent_var
from sandbox.hybrid_executor import AgentDisconnectedError, LocalAgentBridge, get_agent_move, clear_game_state, add_move_to_history, init_game_state

# Agent timeout in seconds - read from environment
AGENT_TIMEOUT_SECONDS = float(os.getenv('AGENT_TIMEOUT_SECONDS', '14.0'))
# Add buffer for network/system overhead when checking timeouts
# 1.0s buffer accounts for: network latency, board reconstruction, message serialization
TIMEOUT_CHECK_BUFFER = 1.0


def run_hybrid_match(white_agent_id, white_code, white_execution_mode, white_name,
                     black_agent_id, black_code, black_execution_mode, black_name,
                     board_sample, match_id):
    """
    Run a match between two agents (local and/or server)

    Returns same format as run_match_local:
        {
            'winner': 'white' | 'black' | 'draw' | None,
            'moves': int,
            'termination': str,
            'game_states': List[dict]
        }
    """

    # Notify local agents that game is starting
    bridge = LocalAgentBridge()
    if white_execution_mode == 'local':
        bridge.notify_game_start(white_agent_id, match_id, white_name, black_name)
    if black_execution_mode == 'local':
        bridge.notify_game_start(black_agent_id, match_id, white_name, black_name)

    # Setup extension module for server agents
    import sys as _sys
    from extension import board_utils, board_rules
    if 'extension' not in _sys.modules:
        extension_module = types.ModuleType('extension')
        extension_module.board_utils = board_utils
        extension_module.board_rules = board_rules
        _sys.modules['extension'] = extension_module

    # Load server agent code if needed
    white_agent_func = None
    black_agent_func = None

    if white_execution_mode == 'server':
        white_module = types.ModuleType('white_agent')
        try:
            exec(white_code, white_module.__dict__)
            if 'agent' not in white_module.__dict__:
                print(f"[HYBRID] WHITE_ERROR: White agent missing 'agent' function")
                return {
                    'winner': 'black',
                    'moves': 0,
                    'termination': 'white_error',
                    'error': 'White agent code does not define an "agent" function',
                    'game_states': []
                }
            white_agent_func = white_module.__dict__['agent']
        except Exception as e:
            import traceback
            print(f"[HYBRID] WHITE_ERROR: Failed to load white agent: {e}")
            print(f"[HYBRID] Traceback: {traceback.format_exc()}")
            return {
                'winner': 'black',
                'moves': 0,
                'termination': 'white_error',
                'error': f'Failed to load white agent code: {str(e)}\n{traceback.format_exc()}',
                'game_states': []
            }

    if black_execution_mode == 'server':
        black_module = types.ModuleType('black_agent')
        try:
            exec(black_code, black_module.__dict__)
            if 'agent' not in black_module.__dict__:
                print(f"[HYBRID] BLACK_ERROR: Black agent missing 'agent' function")
                return {
                    'winner': 'white',
                    'moves': 0,
                    'termination': 'black_error',
                    'error': 'Black agent code does not define an "agent" function',
                    'game_states': []
                }
            black_agent_func = black_module.__dict__['agent']
        except Exception as e:
            import traceback
            print(f"[HYBRID] BLACK_ERROR: Failed to load black agent: {e}")
            print(f"[HYBRID] Traceback: {traceback.format_exc()}")
            return {
                'winner': 'white',
                'moves': 0,
                'termination': 'black_error',
                'error': f'Failed to load black agent code: {str(e)}\n{traceback.format_exc()}',
                'game_states': []
            }

    players = [white, black]
    board = Board(
        squares=board_sample,
        players=players,
        turn_iterator=cycle(players),
    )

    # Initialize game state cache with the initial board BEFORE any moves
    # This ensures local agents receive correct initial state for board reconstruction
    init_game_state(match_id, board)

    turn_order = cycle(players)
    moves = 0
    max_moves = 500
    game_states = []
    result = None

    white_ply = 1
    black_ply = 1

    while moves < max_moves:
        try:
            player = next(turn_order)
            moves += 1

            # Get legal moves
            legal_moves = list_legal_moves_for(board, player)
            print(f"Move {moves}, {player.name} turn: {len(legal_moves)} legal moves available")

            if not legal_moves:
                # No legal moves - player loses
                winner = "black" if player.name == "white" else "white"
                print(f"{player.name} has no legal moves available")
                result = {
                    'winner': winner,
                    'moves': moves,
                    'termination': 'no_moves',
                    'game_states': game_states
                }
                break

            # Get move from appropriate agent type
            p_piece = None
            p_move_opt = None
            move_time_ms = 0
            timed_out = False

            if player.name == "white":
                print(f"[HYRBIDF] request move match={match_id} move={moves} player=white exec={white_execution_mode} agent={white_agent_id}", flush=True)
                try:
                    piece, move, elapsed, explicit_timeout = get_agent_move(
                        agent_code=white_code if white_execution_mode == 'server' else None,
                        agent_id=white_agent_id,
                        execution_mode=white_execution_mode,
                        board=board,
                        player=player,
                        var=[white_ply, AGENT_TIMEOUT_SECONDS],
                        game_id=match_id,
                        agent_func=white_agent_func
                    )
                    white_ply += 1
                except AgentDisconnectedError as e:
                    print(f"[HYRBIDF] white-disconnect match={match_id} move={moves} agent={white_agent_id} reason={e.reason}", flush=True)
                    result = {
                        'winner': None,
                        'moves': 0,
                        'termination': 'cancelled',
                        'error': e.reason,
                        'game_states': []
                    }
                    break
                p_piece = piece
                p_move_opt = move
                move_time_ms = elapsed * 1000  # Convert to ms
                # Timeout if: agent explicitly reported timeout OR elapsed exceeds threshold
                timed_out = explicit_timeout or (elapsed > AGENT_TIMEOUT_SECONDS + TIMEOUT_CHECK_BUFFER)

                if timed_out:
                    print(f"White agent ({white_execution_mode}) TIMEOUT on move {moves} (elapsed: {elapsed:.3f}s, explicit: {explicit_timeout})")
                else:
                    if piece and getattr(piece, "position", None):
                        piece_pos = f"{piece.position.x},{piece.position.y}"
                    else:
                        piece_pos = None
                    move_target = getattr(move, "position", None)
                    if move_target:
                        move_pos = f"{move_target.x},{move_target.y}"
                    else:
                        move_pos = None
                    print(f"[HYRBIDF] response match={match_id} move={moves} player=white piece={type(piece).__name__ if piece else None} from={piece_pos} to={move_pos} elapsed={elapsed:.3f}s", flush=True)
            else:
                print(f"[HYRBIDF] request move match={match_id} move={moves} player=black exec={black_execution_mode} agent={black_agent_id}", flush=True)
                try:
                    piece, move, elapsed, explicit_timeout = get_agent_move(
                        agent_code=black_code if black_execution_mode == 'server' else None,
                        agent_id=black_agent_id,
                        execution_mode=black_execution_mode,
                        board=board,
                        player=player,
                        var=[black_ply, AGENT_TIMEOUT_SECONDS],
                        game_id=match_id,
                        agent_func=black_agent_func
                    )
                    black_ply += 1
                except AgentDisconnectedError as e:
                    print(f"[HYRBIDF] black-disconnect match={match_id} move={moves} agent={black_agent_id} reason={e.reason}", flush=True)
                    result = {
                        'winner': None,
                        'moves': 0,
                        'termination': 'cancelled',
                        'error': e.reason,
                        'game_states': []
                    }
                    break
                p_piece = piece
                p_move_opt = move
                move_time_ms = elapsed * 1000  # Convert to ms
                # Timeout if: agent explicitly reported timeout OR elapsed exceeds threshold
                timed_out = explicit_timeout or (elapsed > AGENT_TIMEOUT_SECONDS + TIMEOUT_CHECK_BUFFER)

                if timed_out:
                    print(f"Black agent ({black_execution_mode}) TIMEOUT on move {moves} (elapsed: {elapsed:.3f}s, explicit: {explicit_timeout})")
                else:
                    if piece and getattr(piece, "position", None):
                        piece_pos = f"{piece.position.x},{piece.position.y}"
                    else:
                        piece_pos = None
                    move_target = getattr(move, "position", None)
                    if move_target:
                        move_pos = f"{move_target.x},{move_target.y}"
                    else:
                        move_pos = None
                    print(f"[HYRBIDF] response match={match_id} move={moves} player=black piece={type(piece).__name__ if piece else None} from={piece_pos} to={move_pos} elapsed={elapsed:.3f}s", flush=True)

            # Handle timeout - agent forfeits the game
            if timed_out:
                winner = "black" if player.name == "white" else "white"
                print(f"{player.name} TIMEOUT - forfeiting game to {winner}")

                # Record the timeout move in game states for analytics
                board_state = serialize_board(board)
                game_states.append({
                    'move_number': moves,
                    'board_state': board_state,
                    'move_time_ms': int(move_time_ms),
                    'notation': f"TIMEOUT({player.name})",
                })

                result = {
                    'winner': winner,
                    'moves': moves,
                    'termination': 'timeout',
                    'game_states': game_states
                }
                break

            # Validate piece belongs to current player (prevent moving opponent's pieces)
            if p_piece and hasattr(p_piece, 'player') and p_piece.player.name != player.name:
                winner = "black" if player.name == "white" else "white"
                termination = "white_invalid" if player.name == "white" else "black_invalid"
                print(f"{player.name} tried to move opponent's piece ({p_piece.player.name}) - forfeiting game to {winner}")

                # Record the invalid move in game states for analytics
                board_state = serialize_board(board)
                game_states.append({
                    'move_number': moves,
                    'board_state': board_state,
                    'move_time_ms': int(move_time_ms),
                    'notation': f"INVALID({player.name})",
                })

                result = {
                    'winner': winner,
                    'moves': moves,
                    'termination': termination,
                    'game_states': game_states
                }
                break

            # Handle invalid move - agent forfeits
            if not p_piece or not p_move_opt:
                winner = "black" if player.name == "white" else "white"
                termination = "white_invalid" if player.name == "white" else "black_invalid"
                print(f"{player.name} returned invalid move (None) - forfeiting game to {winner}")

                # Record the invalid move in game states for analytics
                board_state = serialize_board(board)
                game_states.append({
                    'move_number': moves,
                    'board_state': board_state,
                    'move_time_ms': int(move_time_ms),
                    'notation': f"INVALID({player.name})",
                })

                result = {
                    'winner': winner,
                    'moves': moves,
                    'termination': termination,
                    'game_states': game_states
                }
                break

            # Copy and execute move
            board, piece, move_opt = copy_piece_move(board, p_piece, p_move_opt)

            if not piece or not move_opt:
                # copy_piece_move failed - move was invalid, agent forfeits
                winner = "black" if player.name == "white" else "white"
                termination = "white_invalid" if player.name == "white" else "black_invalid"
                print(f"{player.name} returned invalid move (failed validation) - forfeiting game to {winner}")

                # Record the invalid move in game states for analytics
                board_state_invalid = serialize_board(board)
                game_states.append({
                    'move_number': moves,
                    'board_state': board_state_invalid,
                    'move_time_ms': int(move_time_ms),
                    'notation': f"INVALID({player.name})",
                })

                result = {
                    'winner': winner,
                    'moves': moves,
                    'termination': termination,
                    'game_states': game_states
                }
                break

            # Capture original position before applying move
            from_x = piece.position.x
            from_y = piece.position.y
            to_x = move_opt.position.x
            to_y = move_opt.position.y
            piece_type = type(piece).__name__

            # Apply move to board
            piece.move(move_opt)

            # Add move to history AFTER it's applied so next player sees current state
            add_move_to_history(match_id, from_x, from_y, to_x, to_y, piece_type)

            # Record game state
            try:
                if piece and piece.position:
                    notation = f"{piece.name}({piece.position.x},{piece.position.y})"
                else:
                    notation = f"{p_piece.name if p_piece else 'Unknown'}(?,?)"
            except:
                notation = "Invalid"

            # Serialize board state
            board_state = serialize_board(board)

            game_states.append({
                'move_number': moves,
                'board_state': board_state,
                'move_time_ms': int(move_time_ms),
                'notation': notation,
            })

            # Check for checkmate/stalemate on next player's turn
            # We already called next(turn_order) at the start of the loop for the current player
            # The iterator is already pointing to the next player, so don't call next() again
            # Just check if the opponent (who just played) left them with legal moves
            next_player = black if player.name == "white" else white
            next_legal_moves = list_legal_moves_for(board, next_player)

            if not next_legal_moves:
                # Game over - next player has no moves
                # Use get_result to determine if it's checkmate or stalemate
                game_result = get_result(board)
                winner = "white" if next_player.name == "black" else "black"

                # Determine termination type based on game result
                if game_result and 'Stalemate' in game_result:
                    termination = 'stalemate'
                elif game_result and 'Checkmate' in game_result:
                    termination = 'checkmate'
                else:
                    # Fallback - assume checkmate if can't determine
                    termination = 'checkmate'

                result = {
                    'winner': winner,
                    'moves': moves,
                    'termination': termination,
                    'game_states': game_states
                }
                break

            # turn_order will automatically advance to next player in next loop iteration

        except Exception as e:
            import traceback
            winner = "black" if player.name == "white" else "white"
            termination = "white_error" if player.name == "white" else "black_error"
            print(f"[HYBRID] {termination.upper()}: {player.name} agent error on move {moves}: {e}")
            print(f"[HYBRID] Traceback: {traceback.format_exc()}")
            result = {
                'winner': winner,
                'moves': moves,
                'termination': termination,
                'error': str(e),
                'game_states': game_states
            }
            break
    else:
        # Max moves reached
        result = {
            'winner': 'draw',
            'moves': moves,
            'termination': 'max_moves',
            'game_states': game_states
        }

    # Notify local agents of game end
    if white_execution_mode == 'local':
        bridge.notify_game_end(white_agent_id, match_id, result.get('termination'), result.get('winner'))
    if black_execution_mode == 'local':
        bridge.notify_game_end(black_agent_id, match_id, result.get('termination'), result.get('winner'))

    bridge.close()

    # Clear game state cache
    clear_game_state(match_id)

    return result


def serialize_board(board):
    """Serialize board state"""
    pieces = []
    for piece in board.get_pieces():
        pieces.append({
            'type': type(piece).__name__,
            'player': piece.player.name,
            'x': piece.position.x,
            'y': piece.position.y,
        })
    return {'pieces': pieces}
