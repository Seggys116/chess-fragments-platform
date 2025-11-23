from worker import app
from sandbox.agent_executor import run_match_local, execute_agent_with_timeout
import psycopg2
import psycopg2.extras
import os
import sys
import time
import re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / 'shared'))
from samples import get_sample0
from constants import get_default_agent_var

VALIDATION_TIMEOUT_SECONDS = float(os.getenv('AGENT_TIMEOUT_SECONDS', '14.0'))


def sanitize_error_message(error: Exception) -> str:
    error_type = type(error).__name__
    error_msg = str(error)

    error_msg = re.sub(r'File ".*?", line \d+', 'in agent code', error_msg)
    error_msg = re.sub(r'^\s+.*$', '', error_msg, flags=re.MULTILINE)

    if isinstance(error, SyntaxError):
        return "Syntax error in agent code"
    elif isinstance(error, ImportError):
        return "Invalid import statement or module not found"
    elif isinstance(error, NameError):
        return "Runtime error: Undefined variable or function"
    elif isinstance(error, AttributeError):
        return "Runtime error: Invalid attribute access"
    elif isinstance(error, TypeError):
        return f"Runtime error: Type error - {error_msg.split(':')[0] if ':' in error_msg else 'invalid operation'}"
    elif isinstance(error, IndexError):
        return "Runtime error: Index out of range"
    elif isinstance(error, KeyError):
        return "Runtime error: Invalid dictionary key"
    elif isinstance(error, ValueError):
        return "Runtime error: Invalid value"
    elif isinstance(error, OSError):
        # Provide OS error details without leaking sensitive paths
        if hasattr(error, 'errno') and error.errno:
            errno_name = error.errno
            strerror = getattr(error, 'strerror', 'Unknown OS error')
            return f"OS error (errno {errno_name}): {strerror}"
        # Sanitize path information but keep the error description
        sanitized_msg = re.sub(r'/[^\s:]+', '[path]', error_msg)
        return f"OS error: {sanitized_msg[:150]}"
    elif 'timeout' in error_msg.lower():
        return f"Agent exceeded {VALIDATION_TIMEOUT_SECONDS} second timeout"
    else:
        # Generic error - only show type
        return f"Runtime error: {error_type}"


def test_agent_single_move_docker(code: str, queue_id: str) -> tuple[bool, str | None, int]:
    """
    Test agent in isolated Docker container for maximum security.

    Security measures:
    - Separate container per validation
    - No network access
    - Read-only filesystem
    - Memory limits
    - CPU limits
    - Timeout enforced by Docker (AGENT_TIMEOUT_SECONDS)

    Returns:
        (success: bool, error_message: str | None, duration_ms: int)
    """
    import docker
    import tempfile
    import os

    start_time = time.time()

    try:
        # Create Docker client
        client = docker.from_env()

        # Create temporary directory for agent code
        with tempfile.TemporaryDirectory() as tmpdir:
            agent_file = os.path.join(tmpdir, 'test_agent.py')

            # Write agent code to file
            with open(agent_file, 'w') as f:
                f.write(code)

            # Create test script that runs the agent
            test_script = os.path.join(tmpdir, 'run_test.py')
            with open(test_script, 'w') as f:
                f.write("""
import sys
sys.path.insert(0, '/app/shared')
sys.path.insert(0, '/app/sandbox')

from samples import get_sample0, white, black
from chessmaker.chess.base import Board
from itertools import cycle
from extension.board_utils import list_legal_moves_for
import time
import traceback

# Load test agent
try:
    with open('/test/test_agent.py', 'r') as f:
        agent_code = f.read()

    # Execute agent code
    import types
    agent_module = types.ModuleType('test_agent')
    exec(agent_code, agent_module.__dict__)

    if 'agent' not in agent_module.__dict__:
        print("ERROR: Missing required 'agent(board, player, var)' function")
        sys.exit(1)

    agent_func = agent_module.__dict__['agent']

    # Create test board
    board_squares = get_sample0()
    players = [white, black]
    board = Board(
        squares=board_squares,
        players=players,
        turn_iterator=cycle(players),
    )

    # Test agent
    start = time.time()
    result = agent_func(board, white, ['ply', 14])
    duration = time.time() - start

    # Validate result
    if result is None or not isinstance(result, tuple) or len(result) != 2:
        print("ERROR: Agent must return (piece, move) tuple")
        sys.exit(1)

    piece, move = result

    # Check if valid move format
    if piece is None and move is None:
        legal_moves = list_legal_moves_for(board, white)
        if len(legal_moves) > 0:
            print("ERROR: Agent returned (None, None) when legal moves were available")
            sys.exit(1)

    print(f"SUCCESS: {int(duration * 1000)}ms")
    sys.exit(0)

except SyntaxError as e:
    print(f"SYNTAX_ERROR: {str(e)}")
    sys.exit(1)
except ImportError as e:
    print(f"IMPORT_ERROR: {str(e)}")
    sys.exit(1)
except Exception as e:
    print(f"RUNTIME_ERROR: {str(e)}")
    traceback.print_exc()
    sys.exit(1)
""")

            # Run container with strict security settings
            try:
                container = client.containers.run(
                    'fragmentarena-executor:latest',  # Use same image as executor
                    command=['python3', '/test/run_test.py'],
                    volumes={
                        tmpdir: {'bind': '/test', 'mode': 'ro'}  # Read-only mount
                    },
                    network_mode='none',  # No network access
                    mem_limit='256m',  # 256MB memory limit
                    cpu_quota=50000,  # 50% of one CPU core
                    remove=True,  # Auto-remove container after execution
                    detach=False,
                    stdout=True,
                    stderr=True,
                    timeout=int(VALIDATION_TIMEOUT_SECONDS + 1),  # Agent timeout + 1s buffer
                    read_only=True,  # Read-only root filesystem
                    security_opt=['no-new-privileges'],  # Security hardening
                    cap_drop=['ALL'],  # Drop all capabilities
                )

                output = container.decode('utf-8')
                duration_ms = int((time.time() - start_time) * 1000)

                # Parse output
                if 'SUCCESS:' in output:
                    # Extract duration from output
                    duration_str = output.split('SUCCESS:')[1].strip().replace('ms', '')
                    try:
                        duration_ms = int(duration_str)
                    except:
                        pass
                    return True, None, duration_ms

                # Parse errors
                if 'SYNTAX_ERROR:' in output:
                    error = output.split('SYNTAX_ERROR:')[1].strip().split('\n')[0]
                    return False, sanitize_error_message(SyntaxError(error)), duration_ms

                if 'IMPORT_ERROR:' in output:
                    error = output.split('IMPORT_ERROR:')[1].strip().split('\n')[0]
                    return False, sanitize_error_message(ImportError(error)), duration_ms

                if 'RUNTIME_ERROR:' in output:
                    error = output.split('RUNTIME_ERROR:')[1].strip().split('\n')[0]
                    return False, sanitize_error_message(Exception(error)), duration_ms

                if 'ERROR:' in output:
                    error = output.split('ERROR:')[1].strip().split('\n')[0]
                    return False, error, duration_ms

                return False, "Unknown error during validation", duration_ms

            except docker.errors.ContainerError as e:
                duration_ms = int((time.time() - start_time) * 1000)
                return False, "Runtime error in agent execution", duration_ms

            except Exception as e:
                duration_ms = int((time.time() - start_time) * 1000)
                if 'timeout' in str(e).lower():
                    return False, f"Agent exceeded {VALIDATION_TIMEOUT_SECONDS} second timeout", duration_ms
                return False, f"Container error: {sanitize_error_message(e)}", duration_ms

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return False, f"Failed to create test environment: {str(e)}", duration_ms


def test_agent_single_move(code: str) -> tuple[bool, str | None, int]:
    """
    INSECURE: Test agent in same process (only for development/testing).

    WARNING: This method is NOT secure for production use.
    Use test_agent_single_move_docker() instead.

    Returns:
        (success: bool, error_message: str | None, duration_ms: int)
    """
    import types
    import sys as _sys
    from extension import board_utils, board_rules
    from chessmaker.chess.base import Board, Player
    from itertools import cycle

    # Create fake extension module for imports
    if 'extension' not in _sys.modules:
        extension_module = types.ModuleType('extension')
        extension_module.board_utils = board_utils
        extension_module.board_rules = board_rules
        _sys.modules['extension'] = extension_module

    start_time = time.time()

    try:
        # Load agent code
        agent_module = types.ModuleType('test_agent')
        exec(code, agent_module.__dict__)

        if 'agent' not in agent_module.__dict__:
            duration_ms = int((time.time() - start_time) * 1000)
            return False, 'Missing required "agent(board, player, var)" function', duration_ms

        agent_func = agent_module.__dict__['agent']

        # Get test board
        board_squares = get_sample0()

        # Import players from samples
        from samples import white, black
        players = [white, black]

        # Create board
        board = Board(
            squares=board_squares,
            players=players,
            turn_iterator=cycle(players),
        )

        # Test with white player first
        player = white

        # Execute agent with timeout
        piece, move_opt, move_time_ms, timed_out = execute_agent_with_timeout(
            agent_func,
            board,
            player,
            VALIDATION_TIMEOUT_SECONDS,
            get_default_agent_var(),
        )

        duration_ms = move_time_ms if move_time_ms is not None else int((time.time() - start_time) * 1000)

        if timed_out:
            return False, f"Agent exceeded {VALIDATION_TIMEOUT_SECONDS} second timeout", duration_ms

        # Check if agent returned valid format
        if piece is None and move_opt is None:
            # This might be valid if no moves available, but in test position there should be moves
            from extension.board_utils import list_legal_moves_for
            legal_moves = list_legal_moves_for(board, player)
            if len(legal_moves) > 0:
                return False, "Agent returned (None, None) when legal moves were available", duration_ms

        # Verify it's a tuple of 2 elements
        if not (piece is None or hasattr(piece, 'position')):
            return False, "Agent must return (piece, move) tuple", duration_ms

        # Success!
        return True, None, duration_ms

    except SyntaxError as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return False, sanitize_error_message(e), duration_ms
    except ImportError as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return False, sanitize_error_message(e), duration_ms
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return False, sanitize_error_message(e), duration_ms


@app.task(name='tasks.agent_tester.test_agent_move')
def test_agent_move(queue_id: str):
    """
    Test an agent from the validation queue

    Security:
    - Loads code from database using queue_id (never receives code as parameter)
    - Runs in isolated execution (same as matches)
    - Sanitizes all error messages
    - Only updates validation queue status
    """
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Get validation queue entry
        cur.execute("""
            SELECT id, user_id, code, name, version, code_hash, agent_id
            FROM validation_queue
            WHERE id = %s AND status = 'pending'
        """, (queue_id,))

        queue_entry = cur.fetchone()

        if not queue_entry:
            print(f"Validation queue entry {queue_id} not found or already processed")
            return

        print(f"Testing agent: {queue_entry['name']} v{queue_entry['version']} (queue_id: {queue_id})")

        # Update status to 'testing'
        cur.execute("""
            UPDATE validation_queue
            SET status = 'testing', started_at = NOW()
            WHERE id = %s
        """, (queue_id,))
        conn.commit()

        # Test the agent in isolated Docker container
        # Use Docker method for production, fallback to in-process for development
        use_docker = os.getenv('USE_DOCKER_VALIDATION', 'true').lower() == 'true'

        if use_docker:
            success, error_message, duration_ms = test_agent_single_move_docker(queue_entry['code'], queue_id)
        else:
            print("WARNING: Using in-process validation (INSECURE - development only)")
            success, error_message, duration_ms = test_agent_single_move(queue_entry['code'])

        if success:
            print(f"Agent validation PASSED: {queue_entry['name']} v{queue_entry['version']} ({duration_ms}ms)")

            # Create the agent record
            cur.execute("""
                INSERT INTO agents (id, user_id, name, version, code_text, code_hash,
                                   imports_valid, validation_status, active, created_at)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, true, 'passed', true, NOW())
                RETURNING id
            """, (
                queue_entry['user_id'],
                queue_entry['name'],
                queue_entry['version'],
                queue_entry['code'],
                queue_entry['code_hash']
            ))

            new_agent = cur.fetchone()
            agent_id = new_agent['id']

            # Create initial ranking
            cur.execute("""
                INSERT INTO rankings (id, agent_id, elo_rating, games_played, wins, losses, draws)
                VALUES (gen_random_uuid(), %s, 1500, 0, 0, 0, 0)
            """, (agent_id,))

            # Update validation queue
            cur.execute("""
                UPDATE validation_queue
                SET status = 'passed',
                    agent_id = %s,
                    test_duration_ms = %s,
                    completed_at = NOW()
                WHERE id = %s
            """, (agent_id, duration_ms, queue_id))

            conn.commit()
            print(f"Agent created successfully: {agent_id}")

        else:
            print(f"Agent validation FAILED: {queue_entry['name']} v{queue_entry['version']} - {error_message}")

            # Update validation queue with sanitized error
            cur.execute("""
                UPDATE validation_queue
                SET status = 'failed',
                    error = %s,
                    test_duration_ms = %s,
                    completed_at = NOW()
                WHERE id = %s
            """, (error_message, duration_ms, queue_id))

            conn.commit()

    except Exception as e:
        print(f"Error testing agent {queue_id}: {e}")
        import traceback
        traceback.print_exc()

        # Mark as failed
        try:
            cur.execute("""
                UPDATE validation_queue
                SET status = 'failed',
                    error = 'Internal validation error',
                    completed_at = NOW()
                WHERE id = %s
            """, (queue_id,))
            conn.commit()
        except Exception as update_error:
            print(f"Failed to update validation status: {update_error}")

    finally:
        cur.close()
        conn.close()


@app.task(name='tasks.agent_tester.process_validation_queue')
def process_validation_queue():
    """
    Scheduler task to process pending validation queue entries
    Runs periodically (every 10 seconds) to pick up new validation requests
    """
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Get pending validation entries (limit to 5 at a time)
        cur.execute("""
            SELECT id FROM validation_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 5
        """)

        pending_entries = cur.fetchall()

        if pending_entries:
            print(f"Found {len(pending_entries)} pending validation entries")

            for entry in pending_entries:
                queue_id = entry['id']
                print(f"Queuing validation task for: {queue_id}")
                # Trigger async validation task
                test_agent_move.delay(queue_id)

        else:
            print("No pending validation entries")

    except Exception as e:
        print(f"Error processing validation queue: {e}")

    finally:
        cur.close()
        conn.close()
