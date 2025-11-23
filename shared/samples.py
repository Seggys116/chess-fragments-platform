from chessmaker.chess.base import Player
from chessmaker.chess.pieces import King, Bishop, Knight, Queen
from extension.piece_right import Right
from extension.piece_pawn import Pawn_Q
from chessmaker.chess.base import Square

white = Player("white")
black = Player("black")

def get_sample0():
    return [
        [Square(Knight(black)), Square(Queen(black)), Square(King(black)), Square(Bishop(black)), Square(Right(black))],
        [Square(Pawn_Q(black)), Square(Pawn_Q(black)), Square(Pawn_Q(black)), Square(Pawn_Q(black)),Square(Pawn_Q(black))],
        [Square(), Square(), Square(), Square(),Square()],
        [Square(Pawn_Q(white)), Square(Pawn_Q(white)), Square(Pawn_Q(white)), Square(Pawn_Q(white)),Square(Pawn_Q(white))],
        [Square(Right(white)), Square(Bishop(white)),  Square(King(white)), Square(Queen(white)), Square(Knight(white))],
    ]

def get_sample1():
    return [
        [Square(Right(black)), Square(Queen(black)), Square(King(black)), Square(Knight(black)), Square(Bishop(black))],
        [Square(Pawn_Q(black)), Square(Pawn_Q(black)), Square(Pawn_Q(black)), Square(Pawn_Q(black)),Square(Pawn_Q(black))],
        [Square(), Square(), Square(), Square(),Square()],
        [Square(Pawn_Q(white)), Square(Pawn_Q(white)), Square(Pawn_Q(white)), Square(Pawn_Q(white)),Square(Pawn_Q(white))],
        [Square(Bishop(white)), Square(Knight(white)),  Square(King(white)), Square(Queen(white)), Square(Right(white))],
    ]

# Backwards compatibility - but these should NOT be used directly for matches
sample0 = get_sample0()
sample1 = get_sample1()