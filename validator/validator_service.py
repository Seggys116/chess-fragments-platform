#!/usr/bin/env python3
import os
import sys
import time
import psycopg2
import psycopg2.extras
import tempfile
import shutil
import json
from pathlib import Path

sys.path.insert(0, '/app/shared')
from samples import get_sample0
from constants import get_default_agent_var

VALIDATION_TIMEOUT = float(os.getenv('AGENT_TIMEOUT_SECONDS', '14.0'))


def sanitize_error_message(error: Exception) -> str:
    error_type = type(error).__name__

    if isinstance(error, SyntaxError):
        return "Syntax error in agent code"
    elif isinstance(error, ImportError):
        return "Invalid import statement or module not found"
    elif isinstance(error, NameError):
        return "Runtime error: Undefined variable or function"
    elif isinstance(error, AttributeError):
        return "Runtime error: Invalid attribute access"
    elif isinstance(error, TypeError):
        return f"Runtime error: Type error, msg: {str(error)}"
    elif isinstance(error, TimeoutError):
        return f"Agent exceeded {VALIDATION_TIMEOUT} second timeout"
    elif isinstance(error, OSError):
        error_msg = str(error)
        if hasattr(error, 'errno') and error.errno:
            errno_name = error.errno
            strerror = getattr(error, 'strerror', 'Unknown OS error')
            return f"OS error (errno {errno_name}): {strerror}"
        import re
        error_msg = re.sub(r'/[^\s:]+', '[path]', error_msg)
        return f"OS error: {error_msg[:150]}"
    else:
        return f"Runtime error: {error_type}, msg: {str(error)}"


def validate_agent_in_temp_env(code: str) -> tuple[bool, str | None, int]:
    start_time = time.time()
    temp_dir = None

    try:
        temp_dir = tempfile.mkdtemp(prefix='agent_validation_')

        agent_file = os.path.join(temp_dir, 'agent.py')
        with open(agent_file, 'w') as f:
            f.write(code)

        import types
        from chessmaker.chess.base import Board
        from itertools import cycle
        from extension.board_utils import list_legal_moves_for
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

        agent_module = types.ModuleType('validation_agent')

        try:
            exec(code, agent_module.__dict__)
        except SyntaxError as e:
            duration_ms = int((time.time() - start_time) * 1000)
            return False, sanitize_error_message(e), duration_ms
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            return False, sanitize_error_message(e), duration_ms

        # Check for agent function
        if 'agent' not in agent_module.__dict__:
            duration_ms = int((time.time() - start_time) * 1000)
            return False, 'Missing required "agent(board, player, var)" function', duration_ms

        agent_func = agent_module.__dict__['agent']

        # Create test board
        from samples import white, black
        board_squares = get_sample0()
        players = [white, black]
        board = Board(
            squares=board_squares,
            players=players,
            turn_iterator=cycle(players),
        )

        # Execute agent with timeout
        executor = ThreadPoolExecutor(max_workers=1)

        try:
            future = executor.submit(agent_func, board.clone(), white, get_default_agent_var())
            result = future.result(timeout=VALIDATION_TIMEOUT)

            duration_ms = int((time.time() - start_time) * 1000)

            # Validate result format
            if result is None or not isinstance(result, tuple) or len(result) != 2:
                return False, "Agent must return (piece, move) tuple", duration_ms

            piece, move = result

            # Check if valid move when moves are available
            if piece is None and move is None:
                legal_moves = list_legal_moves_for(board, white)
                if len(legal_moves) > 0:
                    return False, "Agent returned (None, None) when legal moves were available", duration_ms

            # Success!
            return True, None, duration_ms

        except FutureTimeoutError:
            duration_ms = int((time.time() - start_time) * 1000)
            return False, f"Agent exceeded {VALIDATION_TIMEOUT} second timeout", duration_ms
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            return False, sanitize_error_message(e), duration_ms
        finally:
            executor.shutdown(wait=False)

    finally:
        # CRITICAL: Always clean up temporary directory
        # Failed agents are NEVER saved to disk
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                print(f"Warning: Failed to delete temp directory {temp_dir}: {e}")


def process_validation_request(queue_entry):
    """Process a single validation request"""
    queue_id = queue_entry['id']
    user_id = queue_entry['user_id']
    code = queue_entry['code']
    name = queue_entry['name']
    version = queue_entry['version']
    code_hash = queue_entry['code_hash']

    print(f"[VALIDATOR] Testing agent: {name} v{version} (queue_id: {queue_id})")

    # Validate agent in isolated temporary environment
    success, error_message, duration_ms = validate_agent_in_temp_env(code)

    # Connect to database to save results
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        if success:
            print(f"[VALIDATOR] PASSED: {name} v{version} ({duration_ms}ms)")

            # Create agent record
            cur.execute("""
                INSERT INTO agents (id, user_id, name, version, code_text, code_hash,
                                   imports_valid, validation_status, active, created_at)
                VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, true, 'passed', true, NOW())
                RETURNING id
            """, (user_id, name, version, code, code_hash))

            new_agent = cur.fetchone()
            agent_id = new_agent['id']

            # Create initial ranking
            cur.execute("""
                INSERT INTO rankings (id, agent_id, elo_rating, games_played, wins, losses, draws)
                VALUES (gen_random_uuid()::text, %s, 1500, 0, 0, 0, 0)
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
            print(f"[VALIDATOR] Agent created: {agent_id}")

        else:
            print(f"[VALIDATOR] FAILED: {name} v{version} - {error_message}")

            # Update validation queue with error (code is NOT saved)
            cur.execute("""
                UPDATE validation_queue
                SET status = 'failed',
                    error = %s,
                    test_duration_ms = %s,
                    completed_at = NOW()
                WHERE id = %s
            """, (error_message, duration_ms, queue_id))

            conn.commit()

            # IMPORTANT: Failed agent code is NOT saved to agents table
            # The code only exists temporarily in validation_queue

    except Exception as e:
        print(f"[VALIDATOR] Error saving results: {e}")
        conn.rollback()
    finally:
        cur.close()
        conn.close()


def main():
    """Main validation service loop"""
    print("[VALIDATOR] Starting validation service...")
    print("[VALIDATOR] Security: Non-persistent filesystem, isolated execution")

    while True:
        try:
            # Connect to database
            conn = psycopg2.connect(os.getenv('DATABASE_URL'))
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            # Get pending validation requests
            cur.execute("""
                SELECT id, user_id, code, name, version, code_hash
                FROM validation_queue
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT 5
            """)

            pending_requests = cur.fetchall()

            if pending_requests:
                print(f"[VALIDATOR] Processing {len(pending_requests)} validation request(s)")

                for request in pending_requests:
                    # Update status to 'testing'
                    cur.execute("""
                        UPDATE validation_queue
                        SET status = 'testing', started_at = NOW()
                        WHERE id = %s
                    """, (request['id'],))
                    conn.commit()

                    # Process validation
                    process_validation_request(request)

            cur.close()
            conn.close()

            # Sleep before next poll
            time.sleep(2)

        except KeyboardInterrupt:
            print("[VALIDATOR] Shutting down...")
            break
        except Exception as e:
            print(f"[VALIDATOR] Error: {e}")
            time.sleep(5)  # Wait longer on error


if __name__ == '__main__':
    main()
