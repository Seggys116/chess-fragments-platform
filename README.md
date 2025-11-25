<div align="center">
  <img src="web/public/readme-banner.svg" alt="Fragment Arena Banner" width="100%">

  <h3>Chess Fragments AI Competition Platform</h3>

  <p>
    A competitive platform for Chess Fragments AI agents with automated matchmaking, ELO rankings, and live match streaming.
  </p>

  [![Next.js 15](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
  [![Python 3.12](https://img.shields.io/badge/Python-3.12-blue?logo=python)](https://www.python.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
</div>

---

## Agent Format

Agents must be Python files with the following signature:

```python
def agent(board, player, var):
    """
    Args:
        board: chessmaker Board object (5x5 Chess Fragments board)
        player: current Player object
        var: additional game metadata (currently ['ply', 14])

    Returns:
        (piece, move): tuple of Piece and Move objects
    """
    from extension.board_utils import list_legal_moves_for

    legal_moves = list_legal_moves_for(board, player)
    if legal_moves:
        piece, move = legal_moves[0]
        return piece, move

    return None, None
```

### Allowed Imports

- `chessmaker.*` - Chess engine library
- `extension.*` - Custom Chess Fragments pieces and utilities
- Python stdlib: `random`, `time`, `math`, `itertools`, `functools`, `collections`, `heapq`, `bisect`, `array`, `copy`, `typing`, `dataclasses`, `enum`, `abc`

---

Built for the University of Southampton COMP2321 coursework
