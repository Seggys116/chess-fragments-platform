from worker import app
from sandbox.agent_executor import run_match_local
import psycopg2
import psycopg2.extras
import os
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / 'shared'))
from samples import get_sample0, get_sample1
from random_boards import get_random_board
import random
from tasks.elo_updater import update_match_ratings


def serialize_initial_board(board_squares):
    pieces = []
    for y, row in enumerate(board_squares):
        for x, square in enumerate(row):
            if square.piece:
                piece = square.piece
                pieces.append({
                    'type': type(piece).__name__,
                    'player': piece.player.name,
                    'x': x,
                    'y': y,
                })
    return {'pieces': pieces}


def calculate_evaluation(board_state, current_player):
    """
    Calculate a simple evaluation score for the current position.
    Positive = white advantage, Negative = black advantage

    Piece values:
    - Pawn: 1
    - Knight: 3
    - Bishop: 3
    - Rook: 5
    - Right (hybrid): 6 (knight + rook combination)
    - Queen: 9
    - King: 0 (doesn't count in material)
    """
    piece_values = {
        'Pawn_Q': 1,
        'Knight': 3,
        'Bishop': 3,
        'Rook': 5,
        'Right': 6,  # Right piece (hybrid)
        'Queen': 9,
        'King': 0
    }

    score = 0.0

    # Handle dict format (serialized board state)
    if isinstance(board_state, dict) and 'pieces' in board_state:
        for piece in board_state['pieces']:
            piece_type = piece.get('type', '')
            player = piece.get('player', '')
            value = piece_values.get(piece_type, 0)

            if player == 'white':
                score += value
            elif player == 'black':
                score -= value
    elif isinstance(board_state, str):
        # Parse FEN-like notation (legacy support)
        piece_char_values = {
            'P': 1, 'p': -1,
            'N': 3, 'n': -3,
            'B': 3, 'b': -3,
            'R': 5, 'r': -5,
            'T': 6, 't': -6,
            'Q': 9, 'q': -9,
            'K': 0, 'k': 0
        }
        for char in board_state:
            if char in piece_char_values:
                score += piece_char_values[char]

    return round(score, 2)


@app.task(name='tasks.match_runner.run_match')
def run_match_task(match_id: str):
    """Execute a match between two agents"""
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # First verify match exists
        cur.execute("SELECT COUNT(*) as count FROM matches WHERE id = %s", (match_id,))
        check_result = cur.fetchone()
        if not check_result or check_result['count'] == 0:
            print(f"ERROR: Match {match_id} does not exist in database!")
            return

        # Get match details including match type and execution mode
        cur.execute("""
            SELECT m.id, m.white_agent_id, m.black_agent_id, m.match_type,
                   wa.code_text as white_code, wa.execution_mode as white_execution_mode, wa.name as white_name,
                   ba.code_text as black_code, ba.execution_mode as black_execution_mode, ba.name as black_name
            FROM matches m
            JOIN agents wa ON m.white_agent_id = wa.id
            JOIN agents ba ON m.black_agent_id = ba.id
            WHERE m.id = %s
        """, (match_id,))

        match = cur.fetchone()
        if not match:
            print(f"Match {match_id} not found or agents missing")
            return

        # Determine if this is an exhibition match (should have delays)
        is_exhibition = match.get('match_type') == 'exhibition'
        move_delay = 1.5 if is_exhibition else 0  # 1-2 seconds for exhibition

        # Update status to in_progress
        cur.execute("""
            UPDATE matches
            SET status = 'in_progress', started_at = NOW()
            WHERE id = %s
        """, (match_id,))
        conn.commit()

        # Select board: 60% chance of sample boards, 40% chance of random
        board_selection = random.random()
        if board_selection < 0.60:
            # 60% - Use sample boards (alternate between sample0 and sample1)
            # Use match_id to deterministically select which sample board
            if hash(match_id) % 2 == 0:
                board = get_sample0()
                board_type = "sample0"
            else:
                board = get_sample1()
                board_type = "sample1"
        else:
            # 40% - Use random board
            board = get_random_board()
            board_type = "random"

        print(f"Match {match_id} using board type: {board_type}")

        # Save initial board state (move 0) before match starts
        try:
            # Serialize the initial board state properly
            initial_board_state = serialize_initial_board(board)
            initial_evaluation = calculate_evaluation(initial_board_state, 0)

            cur.execute("""
                INSERT INTO game_states (id, match_id, move_number, board_state, move_time_ms, move_notation, evaluation)
                VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                ON CONFLICT (match_id, move_number) DO NOTHING
            """, (
                match_id,
                0,  # Initial position is move 0
                json.dumps(initial_board_state),
                0,  # No time for initial position
                'Starting position',
                initial_evaluation
            ))
            conn.commit()
            print(f"Saved initial board state for match {match_id}")
        except Exception as state_error:
            print(f"Error inserting initial game state: {state_error}")
            conn.rollback()

        # Check if we have any local agents
        has_local_agents = (match['white_execution_mode'] == 'local' or match['black_execution_mode'] == 'local')

        if has_local_agents:
            # Use hybrid executor for matches with local agents
            from sandbox.hybrid_match_executor import run_hybrid_match
            result = run_hybrid_match(
                white_agent_id=match['white_agent_id'],
                white_code=match['white_code'],
                white_execution_mode=match['white_execution_mode'],
                white_name=match['white_name'],
                black_agent_id=match['black_agent_id'],
                black_code=match['black_code'],
                black_execution_mode=match['black_execution_mode'],
                black_name=match['black_name'],
                board_sample=board,
                match_id=match_id
            )
        else:
            # All server agents - use existing executor
            result = run_match_local(match['white_code'], match['black_code'], board)

        if result.get('termination') == 'cancelled':
            cancel_reason = result.get('error', 'Local agent disconnected')
            print(f"Match {match_id} cancelled: {cancel_reason}")

            try:
                cur.execute("DELETE FROM game_states WHERE match_id = %s", (match_id,))
                conn.commit()
            except Exception as state_error:
                print(f"Error deleting game states for cancelled match {match_id}: {state_error}")
                conn.rollback()

            try:
                cur.execute("DELETE FROM matches WHERE id = %s", (match_id,))
                conn.commit()
                print(f"Removed cancelled match {match_id} from matches table")
            except Exception as delete_error:
                print(f"Error deleting cancelled match {match_id}: {delete_error}")
                conn.rollback()

            if match.get('match_type') == 'matchmaking':
                schedule_round_robin.delay()
            return

        # Check if match ended in error - count as loss for the agent that errored
        if result['termination'] == 'error':
            error_msg = result.get('error', 'Unknown error during match execution')
            winner = result.get('winner')  # Already set in agent_executor.py
            print(f"Match {match_id} ended in error (winner: {winner}): {error_msg}")

            # Validate game has at least 4 moves even for error games
            # Games with 3 or fewer moves are invalid (likely unfair balance or starting position issues)
            if result.get('moves', 0) <= 3:
                print(f"Match {match_id} INVALID (error game): Only {result.get('moves', 0)} move(s), marking as error")
                cur.execute("""
                    UPDATE matches
                    SET status = 'error',
                        termination = 'invalid_game',
                        completed_at = NOW()
                    WHERE id = %s
                """, (match_id,))
                conn.commit()

                # Don't update ELO for invalid games
                # But do trigger rescheduling for matchmaking
                if match.get('match_type') == 'matchmaking':
                    schedule_round_robin.delay()
                return

            # Record any game states that were created before the error
            for state in result.get('game_states', []):
                evaluation = calculate_evaluation(state['board_state'], state['move_number'] % 2)

                try:
                    cur.execute("""
                        INSERT INTO game_states (id, match_id, move_number, board_state, move_time_ms, move_notation, evaluation)
                        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (match_id, move_number) DO NOTHING
                    """, (
                        match_id,
                        state['move_number'],
                        json.dumps(state['board_state']),
                        state.get('move_time_ms', 0),
                        state.get('notation', ''),
                        evaluation
                    ))
                    conn.commit()
                except Exception as state_error:
                    print(f"Error inserting game state: {state_error}")
                    conn.rollback()

            # Update match with error result - but still record the winner
            cur.execute("""
                UPDATE matches
                SET status = 'completed',
                    winner = %s,
                    moves = %s,
                    termination = 'error',
                    completed_at = NOW()
                WHERE id = %s
            """, (winner, result.get('moves', 0), match_id))
            conn.commit()

            # Trigger ELO update for matchmaking games (agent that errored loses rating)
            if match.get('match_type') == 'matchmaking':
                update_match_ratings.delay(match_id)
                schedule_round_robin.delay()

            return

        # Insert game states with delay for exhibition matches
        for state in result['game_states']:
            # Calculate evaluation for this position
            evaluation = calculate_evaluation(state['board_state'], state['move_number'] % 2)

            try:
                cur.execute("""
                    INSERT INTO game_states (id, match_id, move_number, board_state, move_time_ms, move_notation, evaluation)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (match_id, move_number) DO NOTHING
                """, (
                    match_id,
                    state['move_number'],
                    json.dumps(state['board_state']),
                    state.get('move_time_ms', 0),
                    state.get('notation', ''),
                    evaluation
                ))
                conn.commit()
            except Exception as state_error:
                print(f"Error inserting game state for move {state['move_number']}: {state_error}")
                conn.rollback()

            # Add delay for exhibition matches (live viewing)
            if is_exhibition and move_delay > 0:
                time.sleep(move_delay)

        # Validate game has at least 4 moves to be considered legitimate
        # Games with 3 or fewer moves are invalid (likely unfair balance or starting position issues)
        if result['moves'] <= 3:
            print(f"Match {match_id} INVALID: Only {result['moves']} move(s), marking as error")
            cur.execute("""
                UPDATE matches
                SET status = 'error',
                    termination = 'invalid_game',
                    completed_at = NOW()
                WHERE id = %s
            """, (match_id,))
            conn.commit()

            # Don't update ELO for invalid games
            # But do trigger rescheduling for matchmaking
            if match.get('match_type') == 'matchmaking':
                schedule_round_robin.delay()
            return

        # Update match with results
        cur.execute("""
            UPDATE matches
            SET status = 'completed',
                winner = %s,
                moves = %s,
                termination = %s,
                completed_at = NOW()
            WHERE id = %s
        """, (result.get('winner'), result['moves'], result['termination'], match_id))

        conn.commit()
        print(f"Match {match_id} completed: {result}")

        # Trigger ELO rating update for matchmaking games only (not for errors)
        if match.get('match_type') == 'matchmaking':
            update_match_ratings.delay(match_id)
            # Trigger immediate rescheduling to fill the now-available slot
            schedule_round_robin.delay()

    except Exception as e:
        print(f"Error running match {match_id}: {e}")
        # Rollback the transaction first to clear any error state
        conn.rollback()

        try:
            # Now try to update match status to error
            cur.execute("""
                UPDATE matches
                SET status = 'error', completed_at = NOW()
                WHERE id = %s
            """, (match_id,))
            conn.commit()
        except Exception as update_error:
            print(f"Failed to update match status to error: {update_error}")
            conn.rollback()

    finally:
        cur.close()
        conn.close()


@app.task(name='tasks.match_runner.schedule_round_robin')
def schedule_round_robin():
    """
    Schedule continuous matchmaking - ensure 1 game is running at any moment.
    This is called periodically by Celery Beat.
    """
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Check how many matchmaking games are currently in progress by type
        # server vs server: limit 8 (executor resource constrained)
        # local vs server: limit 8 (separate limit stack, executor resource constrained)
        # local vs local: unlimited (runs on user machines)

        # Count server vs server matches
        cur.execute("""
            SELECT COUNT(*) as count FROM matches m
            JOIN agents wa ON m.white_agent_id = wa.id
            JOIN agents ba ON m.black_agent_id = ba.id
            WHERE m.match_type = 'matchmaking'
            AND m.status IN ('pending', 'in_progress')
            AND wa.execution_mode = 'server'
            AND ba.execution_mode = 'server'
        """)
        result = cur.fetchone()
        current_server_vs_server = result['count'] if result else 0

        # Count local vs server matches (either direction)
        cur.execute("""
            SELECT COUNT(*) as count FROM matches m
            JOIN agents wa ON m.white_agent_id = wa.id
            JOIN agents ba ON m.black_agent_id = ba.id
            WHERE m.match_type = 'matchmaking'
            AND m.status IN ('pending', 'in_progress')
            AND (
                (wa.execution_mode = 'local' AND ba.execution_mode = 'server')
                OR (wa.execution_mode = 'server' AND ba.execution_mode = 'local')
            )
        """)
        result = cur.fetchone()
        current_local_vs_server = result['count'] if result else 0

        # Limits
        MAX_SERVER_VS_SERVER = 8
        MAX_LOCAL_VS_SERVER = 8

        server_vs_server_full = current_server_vs_server >= MAX_SERVER_VS_SERVER
        local_vs_server_full = current_local_vs_server >= MAX_LOCAL_VS_SERVER

        print(f"Server vs Server: {current_server_vs_server}/{MAX_SERVER_VS_SERVER}, Local vs Server: {current_local_vs_server}/{MAX_LOCAL_VS_SERVER}")

        # Get all active agents with current active match counts and rankings
        # Prioritize agents with fewer active matches for fair distribution
        cur.execute("""
            WITH active_matches AS (
                SELECT agent_id, COUNT(*) as active_count
                FROM (
                    SELECT white_agent_id as agent_id FROM matches
                    WHERE match_type = 'matchmaking' AND status IN ('pending', 'in_progress')
                    UNION ALL
                    SELECT black_agent_id as agent_id FROM matches
                    WHERE match_type = 'matchmaking' AND status IN ('pending', 'in_progress')
                ) active_games
                GROUP BY agent_id
            ),
            latest_connections AS (
                SELECT DISTINCT ON (agent_id) agent_id, status, last_heartbeat
                FROM local_agent_connections
                ORDER BY agent_id, connected_at DESC
            )
            SELECT a.id, a.code_text, a.execution_mode, a.name,
                   COALESCE(r.elo_rating, 1500) as elo_rating,
                   COALESCE(r.games_played, 0) as games_played,
                   COALESCE(am.active_count, 0) as active_matches
            FROM agents a
            LEFT JOIN rankings r ON a.id = r.agent_id
            LEFT JOIN active_matches am ON a.id = am.agent_id
            LEFT JOIN latest_connections lac ON a.id = lac.agent_id
            WHERE a.active = true
            AND (
                -- Server agents: no per-agent match limit (global limits apply)
                a.execution_mode = 'server'
                OR
                -- Local agents: must be connected AND have fewer than 4 active matches
                (
                    a.execution_mode = 'local'
                    AND lac.status NOT IN ('draining', 'disconnected')
                    AND lac.last_heartbeat > NOW() - INTERVAL '30 seconds'
                    AND COALESCE(am.active_count, 0) < 1
                )
            )
            ORDER BY COALESCE(am.active_count, 0) ASC, RANDOM()
        """)
        all_agents = cur.fetchall()

        # Log agent breakdown by execution mode and active matches
        server_agents = [a for a in all_agents if a['execution_mode'] == 'server']
        local_agents = [a for a in all_agents if a['execution_mode'] == 'local']
        print(f"Available agents: {len(all_agents)} total ({len(server_agents)} server, {len(local_agents)} local)")

        if all_agents:
            active_counts = [a['active_matches'] for a in all_agents]
            print(f"Active matches per agent: min={min(active_counts)}, max={max(active_counts)}, avg={sum(active_counts)/len(active_counts):.1f}")

        if len(all_agents) < 2:
            print("Not enough agents for matchmaking")
            return

        # Calculate total slots available across both limits
        server_slots_available = MAX_SERVER_VS_SERVER - current_server_vs_server
        local_slots_available = MAX_LOCAL_VS_SERVER - current_local_vs_server

        print(f"Slots available - Server vs Server: {server_slots_available}, Local vs Server: {local_slots_available}")

        # Don't schedule if both limits are at or over capacity (race condition protection)
        if server_slots_available <= 0 and local_slots_available <= 0:
            print("All match slots at capacity, skipping scheduling")
            return

        scheduled_count = 0
        max_attempts = 3  # Limit to prevent race conditions (schedule max 3 per round)

        for attempt in range(max_attempts):
            if len(all_agents) < 2:
                print(f"Not enough agents to schedule more matches")
                break

            # Check if we can schedule any more matches
            if server_slots_available <= 0 and local_slots_available <= 0:
                print(f"All match slots filled (scheduled {scheduled_count} this round)")
                break

            # Pick two agents with lowest active match counts (already sorted)
            # Agents are sorted by active_matches ASC, so first agents have fewest matches
            agent1 = all_agents[0]
            agent2 = all_agents[1] if len(all_agents) > 1 else None

            if not agent2:
                print(f"Not enough agents for pairing")
                break

            # Randomly assign colors for fairness (50/50 chance)
            if random.random() < 0.5:
                white_agent = agent1
                black_agent = agent2
            else:
                white_agent = agent2
                black_agent = agent1

            # Determine match type and check appropriate limit
            both_server = (white_agent['execution_mode'] == 'server' and black_agent['execution_mode'] == 'server')
            mixed_match = (white_agent['execution_mode'] != black_agent['execution_mode'])

            # Check if we can schedule this match type
            if both_server and server_slots_available <= 0:
                # Server vs server full, skip
                break

            if mixed_match and local_slots_available <= 0:
                # Local vs server full, skip
                break

            # Create matchmaking game
            cur.execute("""
                INSERT INTO matches (id, white_agent_id, black_agent_id, status, match_type)
                VALUES (gen_random_uuid(), %s, %s, 'pending', 'matchmaking')
                RETURNING id
            """, (white_agent['id'], black_agent['id']))

            new_match = cur.fetchone()
            conn.commit()

            # Decrement appropriate slot counter
            if both_server:
                server_slots_available -= 1
            elif mixed_match:
                local_slots_available -= 1

            # Update agent active match counts and re-sort
            for agent in all_agents:
                if agent['id'] == white_agent['id'] or agent['id'] == black_agent['id']:
                    agent['active_matches'] += 1

            # Re-sort by active matches for next iteration
            all_agents.sort(key=lambda x: (x['active_matches'], random.random()))

            # Enhanced logging
            print(f"Scheduled game #{scheduled_count + 1}: {white_agent['name']} ({white_agent['execution_mode']}, active={white_agent['active_matches']}) vs {black_agent['name']} ({black_agent['execution_mode']}, active={black_agent['active_matches']})")

            # Queue task
            run_match_task.delay(new_match['id'])

            scheduled_count += 1

        print(f"Total games scheduled: {scheduled_count}")

    except Exception as e:
        print(f"Error scheduling matchmaking: {e}")

    finally:
        cur.close()
        conn.close()


@app.task(name='tasks.match_runner.schedule_exhibition_matches')
def schedule_exhibition_matches():
    """
    Process pending exhibition match requests.
    Exhibition matches are created on-demand via the API.
    """
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Get pending exhibition matches
        cur.execute("""
            SELECT id FROM matches
            WHERE match_type = 'exhibition'
            AND status = 'pending'
            ORDER BY created_at ASC
            LIMIT 5
        """)

        pending_matches = cur.fetchall()

        for match in pending_matches:
            print(f"Queueing exhibition match: {match['id']}")
            run_match_task.delay(match['id'])

    except Exception as e:
        print(f"Error scheduling exhibition matches: {e}")

    finally:
        cur.close()
        conn.close()


@app.task(name='tasks.match_runner.cleanup_stuck_matches')
def cleanup_stuck_matches():
    """
    Clean up matches that have been stuck in 'in_progress' for too long.
    This handles cases where the worker crashed or timed out.
    """
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Find matches stuck in progress for more than 5 minutes
        cur.execute("""
            SELECT id, match_type FROM matches
            WHERE status = 'in_progress'
            AND started_at < NOW() - INTERVAL '5 minutes'
        """)

        stuck_matches = cur.fetchall()

        if stuck_matches:
            # Update all stuck matches to error status
            match_ids = [m['id'] for m in stuck_matches]
            cur.execute("""
                UPDATE matches
                SET status = 'error',
                    completed_at = NOW()
                WHERE id = ANY(%s)
            """, (match_ids,))
            conn.commit()

            print(f"Cleaned up {len(stuck_matches)} stuck matches: {match_ids}")

            # Trigger rescheduling if any matchmaking games were cleaned up
            if any(m['match_type'] == 'matchmaking' for m in stuck_matches):
                print("Triggering rescheduling after stuck match cleanup")
                schedule_round_robin.delay()

    except Exception as e:
        print(f"Error cleaning up stuck matches: {e}")

    finally:
        cur.close()
        conn.close()
