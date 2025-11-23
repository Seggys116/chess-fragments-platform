"""
Tests for agent validation
"""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from tasks.agent_validator import (
    validate_agent_code,
    compute_code_hash,
    extract_imports,
    check_agent_function,
    check_dangerous_patterns,
)


def test_valid_agent():
    """Test that a valid agent passes validation"""
    code = """
def agent(board, player, var):
    from extension.board_utils import list_legal_moves_for
    moves = list_legal_moves_for(board, player)
    return moves[0] if moves else (None, None)
"""

    is_valid, error, code_hash = validate_agent_code(code)
    assert is_valid == True
    assert error is None
    assert code_hash is not None
    assert len(code_hash) == 64  # SHA-256 hex


def test_missing_agent_function():
    """Test that code without agent function fails"""
    code = """
def my_function():
    pass
"""

    is_valid, error, code_hash = validate_agent_code(code)
    assert is_valid == False
    assert "agent(board, player, var)" in error


def test_forbidden_import_os():
    """Test that forbidden imports are rejected"""
    code = """
import os

def agent(board, player, var):
    return None, None
"""

    is_valid, error, code_hash = validate_agent_code(code)
    assert is_valid == False
    assert "os" in error


def test_forbidden_import_subprocess():
    """Test that subprocess is forbidden"""
    code = """
import subprocess

def agent(board, player, var):
    return None, None
"""

    is_valid, error, code_hash = validate_agent_code(code)
    assert is_valid == False
    assert "subprocess" in error


def test_code_too_large():
    """Test that oversized code is rejected"""
    code = "def agent(board, player, var):\n    pass\n" + ("# padding\n" * 50000)

    is_valid, error, code_hash = validate_agent_code(code)
    assert is_valid == False
    assert "exceeds" in error


def test_code_hash_consistency():
    """Test that same code produces same hash"""
    code1 = """
def agent(board, player, var):
    return None, None
"""

    code2 = """
def agent(board, player, var):
    return None, None
"""

    hash1 = compute_code_hash(code1)
    hash2 = compute_code_hash(code2)
    assert hash1 == hash2


def test_code_hash_normalization():
    """Test that comments and whitespace don't affect hash"""
    code1 = """
def agent(board, player, var):
    return None, None  # comment
"""

    code2 = """
def agent(board, player, var):
    return None, None
"""

    hash1 = compute_code_hash(code1)
    hash2 = compute_code_hash(code2)
    assert hash1 == hash2


def test_extract_imports():
    """Test import extraction"""
    code = """
import random
from extension.board_utils import list_legal_moves_for
from chessmaker.chess.base import Board

def agent(board, player, var):
    pass
"""

    imports = extract_imports(code)
    assert 'random' in imports
    assert 'extension' in imports
    assert 'chessmaker' in imports


def test_check_agent_function():
    """Test agent function signature check"""
    valid_code = """
def agent(board, player, var):
    pass
"""

    invalid_code = """
def agent(board, player):
    pass
"""

    assert check_agent_function(valid_code) == True
    assert check_agent_function(invalid_code) == False


def test_dangerous_patterns():
    """Test dangerous pattern detection"""
    dangerous_code = """
def agent(board, player, var):
    eval("malicious code")
    return None, None
"""

    patterns = check_dangerous_patterns(dangerous_code)
    assert len(patterns) > 0
    assert any('eval' in p for p in patterns)


def test_safe_code_no_dangerous_patterns():
    """Test that safe code has no dangerous patterns"""
    safe_code = """
def agent(board, player, var):
    from extension.board_utils import list_legal_moves_for
    moves = list_legal_moves_for(board, player)
    return moves[0] if moves else (None, None)
"""

    patterns = check_dangerous_patterns(safe_code)
    assert len(patterns) == 0


if __name__ == '__main__':
    import pytest
    pytest.main([__file__, '-v'])
