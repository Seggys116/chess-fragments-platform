"""
Random board generator for chess-fragments-platform
Generates random SYMMETRIC board configurations with:
- 3-8 pieces per side
- Exactly 1 King per side
- Pieces only on rows 0-1 (black) and 3-4 (white)
- Middle row empty
- SYMMETRIC: Black pieces mirror white pieces (180-degree rotation)
- No king in check at start
- No mate-in-1 for either side
- Both sides have at least 3 legal moves
- Valid legal positions only
"""
import random
from chessmaker.chess.base import Square, Board
from chessmaker.chess.pieces import King, Bishop, Knight, Queen
from extension.piece_right import Right
from extension.piece_pawn import Pawn_Q
from extension.board_utils import list_legal_moves_for, copy_piece_move
from extension.board_rules import get_result
from itertools import cycle

# CRITICAL: Import the SAME global player objects used in samples.py
# This ensures player object identity matches across the system
from samples import white, black


def is_king_in_check(board_squares, king_player):
    """
    Check if a king is under attack using direct piece attack detection.
    Returns True if the king is under attack.
    """
    players = [white, black]
    board = Board(
        squares=board_squares,
        players=players,
        turn_iterator=cycle(players),
    )

    # Find the king position
    king_pos = None
    for piece in board.get_pieces():
        if isinstance(piece, King) and piece.player == king_player:
            king_pos = (piece.position.x, piece.position.y)
            break

    if not king_pos:
        return True  # No king = invalid

    # Get opponent
    opponent = black if king_player == white else white

    # Check if any opponent piece can reach the king's square
    for piece in board.get_player_pieces(opponent):
        for move in piece.get_move_options():
            if hasattr(move, 'position'):
                if move.position.x == king_pos[0] and move.position.y == king_pos[1]:
                    return True

    return False


def has_mate_in_one(board_squares, player):
    """
    Check if the given player has a mate-in-1 from the current position.
    Returns True if any legal move leads to checkmate.
    """
    players = [white, black]
    board = Board(
        squares=board_squares,
        players=players,
        turn_iterator=cycle(players),
    )

    legal_moves = list_legal_moves_for(board, player)

    for piece, move in legal_moves:
        # Clone board and simulate the move
        board_clone = board.clone()
        _, piece_clone, move_clone = copy_piece_move(board_clone, piece, move)

        if piece_clone and move_clone:
            piece_clone.move(move_clone)
            result = get_result(board_clone)

            if result and 'checkmate' in result.lower():
                return True

    return False


def is_position_playable(board_squares, min_moves_per_side=3):
    """
    Check if both sides have at least min_moves_per_side legal moves.
    Returns True if the position has adequate playability.
    """
    players = [white, black]
    board = Board(
        squares=board_squares,
        players=players,
        turn_iterator=cycle(players),
    )

    for player in players:
        legal_moves = list_legal_moves_for(board, player)
        if len(legal_moves) < min_moves_per_side:
            return False

    return True


def generate_random_board(seed=None, max_attempts=100):
    """
    Generate a random SYMMETRIC board configuration with improved validation:
    - Pieces only on top 2 rows (black) and bottom 2 rows (white)
    - Always 2 kings (one per side)
    - SYMMETRIC: Black pieces mirror white pieces (rotated 180 degrees)
    - 3-8 pieces per side
    - NO king in check at start
    - NO mate-in-1 for either side
    - Both sides have at least 3 legal moves
    - Retries up to max_attempts times to find a valid board
    """
    if seed is not None:
        random.seed(seed)

    # Available piece types (excluding King which is mandatory)
    piece_classes = [
        Pawn_Q,
        Knight,
        Bishop,
        Queen,
        Right
    ]

    for attempt in range(max_attempts):
        # Initialize empty 5x5 board
        board = [[Square() for _ in range(5)] for _ in range(5)]

        # Decide how many pieces to place (between 3 and 8 per side)
        num_pieces_per_side = random.randint(3, 8)

        # Generate random positions for pieces in bottom 2 rows (white's side)
        # Rows 3 and 4 for white
        available_white_positions = [(x, y) for y in [3, 4] for x in range(5)]

        # Shuffle and select positions for white
        random.shuffle(available_white_positions)
        white_positions = available_white_positions[:num_pieces_per_side]

        # Generate piece types for white (king + random pieces)
        white_piece_types = [King] + [random.choice(piece_classes) for _ in range(num_pieces_per_side - 1)]

        # Place white pieces
        for i, (x, y) in enumerate(white_positions):
            piece_class = white_piece_types[i]
            board[y][x] = Square(piece_class(white))

        # Mirror positions to black side (180-degree rotation)
        # Row mapping: white row 3 -> black row 1, white row 4 -> black row 0
        # Column mapping: stays the same (x -> x) for vertical symmetry
        # OR use: x -> 4-x for horizontal+vertical symmetry
        for i, (white_x, white_y) in enumerate(white_positions):
            # Mirror position: flip both x and y coordinates
            # white row 3 -> black row 1 (4-3=1)
            # white row 4 -> black row 0 (4-4=0)
            black_y = 4 - white_y
            # Flip x coordinate for full 180-degree rotation
            black_x = 4 - white_x

            # Use the same piece type as white (mirrored position)
            piece_class = white_piece_types[i]
            board[black_y][black_x] = Square(piece_class(black))

        # VALIDATION CHECKS (in order of computational cost)

        # Check 1: No king in check (using fixed detection)
        white_in_check = is_king_in_check(board, white)
        black_in_check = is_king_in_check(board, black)

        if white_in_check or black_in_check:
            print(f"Attempt {attempt + 1}: King in check (white={white_in_check}, black={black_in_check}), retrying...")
            continue

        # Check 2: Adequate legal moves for both sides (min 3 per side)
        if not is_position_playable(board, min_moves_per_side=3):
            print(f"Attempt {attempt + 1}: Insufficient legal moves, retrying...")
            continue

        # Check 3: No mate-in-1 for white (who moves first)
        if has_mate_in_one(board, white):
            print(f"Attempt {attempt + 1}: White has mate-in-1, retrying...")
            continue

        # Check 4: No mate-in-1 for black
        if has_mate_in_one(board, black):
            print(f"Attempt {attempt + 1}: Black has mate-in-1, retrying...")
            continue

        # All checks passed
        print(f"Generated valid balanced board on attempt {attempt + 1}")
        return board

    # If we couldn't generate a valid board after max_attempts, fall back to a sample board
    print(f"WARNING: Could not generate valid random board after {max_attempts} attempts, using sample board")
    from samples import get_sample0
    return get_sample0()


def get_random_board():
    """
    Get a random board configuration.
    This is the main function to call for getting a random board.
    """
    return generate_random_board()


def get_random_board_seeded(seed):
    """
    Get a random board with a specific seed for reproducibility.
    Useful for debugging or replaying specific configurations.
    """
    return generate_random_board(seed)
