from chessmaker.chess.pieces import Pawn, Queen

def Pawn_Q(player):
    if player.name == "white":
        return Pawn(player, Pawn.Direction.UP, promotions=[Queen])
    elif player.name == "black":
        return Pawn(player, Pawn.Direction.DOWN, promotions=[Queen])
