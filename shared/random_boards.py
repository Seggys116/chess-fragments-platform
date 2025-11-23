"""
Random board generator for chess-fragments-platform
Generates random SYMMETRIC board configurations with:
- 3-8 pieces per side
- Exactly 1 King per side
- Pieces only on rows 0-1 (black) and 3-4 (white)
- Middle row empty
- SYMMETRIC: Black pieces mirror white pieces (180-degree rotation)
- No king in check at start
- Valid legal positions only
"""
import random
from chessmaker.chess.base import Square, Board
from chessmaker.chess.pieces import King, Bishop, Knight, Queen
from extension.piece_right import Right
from extension.piece_pawn import Pawn_Q
from extension.board_utils import list_legal_moves_for
from itertools import cycle

# CRITICAL: Import the SAME global player objects used in samples.py
# This ensures player object identity matches across the system
from samples import white, black


def is_king_in_check(board_squares, king_player):
    """
    Check if a king is in check on the given board.
    Returns True if the king is under attack.
    """
    # Create a Board object to use the chess engine's move validation
    players = [white, black]
    board = Board(
        squares=board_squares,
        players=players,
        turn_iterator=cycle(players),
    )

    # Find the king position
    king_pos = None
    for y, row in enumerate(board_squares):
        for x, square in enumerate(row):
            if square.piece and isinstance(square.piece, King) and square.piece.player == king_player:
                king_pos = (x, y)
                break
        if king_pos:
            break

    if not king_pos:
        return True  # No king found = invalid board

    # Get opponent player
    opponent = black if king_player == white else white

    # Check if any opponent piece can attack the king's position
    for y, row in enumerate(board_squares):
        for x, square in enumerate(row):
            if square.piece and square.piece.player == opponent:
                piece = square.piece
                # Get all legal moves for this opponent piece
                try:
                    legal_moves = list_legal_moves_for(board, opponent)
                    for moving_piece, move in legal_moves:
                        if moving_piece == piece:
                            # Check if this move attacks the king's position
                            if hasattr(move, 'position') and move.position.x == king_pos[0] and move.position.y == king_pos[1]:
                                return True
                except:
                    pass

    return False


def generate_random_board(seed=None, max_attempts=50):
    """
    Generate a random SYMMETRIC board configuration
    - Pieces only on top 2 rows (black) and bottom 2 rows (white)
    - Always 2 kings (one per side)
    - SYMMETRIC: Black pieces mirror white pieces (rotated 180 degrees)
    - 3-8 pieces per side
    - Ensures no king is in check at start
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

        # Validate: check if either king is in check
        white_in_check = is_king_in_check(board, white)
        black_in_check = is_king_in_check(board, black)

        if not white_in_check and not black_in_check:
            print(f"Generated valid symmetric random board on attempt {attempt + 1}")
            return board
        else:
            print(f"Attempt {attempt + 1}: Board invalid (white_check={white_in_check}, black_check={black_in_check}), retrying...")

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
