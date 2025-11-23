def print_board_ascii(board):
    piece_map = {"pawn": "P", "right": "R", "knight": "N", "bishop": "B", "queen": "Q", "king": "K"}
    grid = [["." for _ in range(5)] for _ in range(5)]
    for piece in board.get_pieces():
        pos = piece.position
        ch = piece_map.get(piece.name.lower(), "?")
        grid[pos.y][pos.x] = ch.upper() if piece.player.name.lower() == "white" else ch.lower()
    print("  0 1 2 3 4")
    for row in (range(5)):
        print(f"{row} " + " ".join(grid[row]))

def list_legal_moves_for(board, player):
    pairs = []
    for pc in board.get_player_pieces(player):
        for opt in pc.get_move_options():
            pairs.append((pc, opt))
    return pairs

def copy_piece_move(board, piece, move):
    try:
        if piece and move:
            temp_piece = None
            for tp in board.get_player_pieces(piece.player):
                if type(tp) is type(piece) and tp.position == piece.position:
                    temp_piece = tp
                    break
            if temp_piece is None:
                print(f"ERROR: Could not find piece {type(piece).__name__} at {piece.position}")
                return board, None, None
            # find the equivalent move option on the cloned piece
            dest = getattr(move, "position", None)
            move_extra = getattr(move, "extra", {})
            temp_move = None

            for m in temp_piece.get_move_options():
                m_dest = getattr(m, "position", None)
                m_extra = getattr(m, "extra", {})
                # Match both position and extra (for pawn promotion)
                if m_dest == dest and m_extra == move_extra:
                    temp_move = m
                    return board, temp_piece, temp_move

            # Only log when move not found
            available_moves = [f"{getattr(m, 'position', '?')} extra={getattr(m, 'extra', {})}"
                             for m in temp_piece.get_move_options()]
            print(f"ERROR: Move not found for {type(piece).__name__} to {dest} with extra={move_extra}")
            print(f"Available moves: {', '.join(available_moves[:10])}...")  # Only first 10
            return board, temp_piece, None
        else:
            return board, None, None
    except Exception as e:
        import traceback
        print(f"EXCEPTION in copy_piece_move: {e}")
        print(traceback.format_exc())
        return board, None, None

def take_notes(note):
    pass # Nope