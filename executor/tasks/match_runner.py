from worker import app
from sandbox.agent_executor import run_match_local
import psycopg2
import psycopg2.extras
import os
import json
import sys
import time
from datetime import datetime, timezone as tz
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / 'shared'))
from samples import get_sample0, get_sample1
from random_boards import get_random_board
import random
from tasks.elo_updater import update_match_ratings
from executor_registry import get_registry


def is_tournament_time():
    """Check if tournament should be active based on start time."""
    tournament_start = datetime(2025, 12, 12, 17, 0, 0, tzinfo=tz.utc)
    now = datetime.now(tz.utc)
    return now >= tournament_start


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
        is_tournament = match.get('match_type') == 'tournament'
        move_delay = 1.5 if is_exhibition else 0  # 1-2 seconds for exhibition

        # Update status to in_progress
        cur.execute("""
            UPDATE matches
            SET status = 'in_progress', started_at = NOW()
            WHERE id = %s
        """, (match_id,))
        conn.commit()

        # Select board based on match type
        if is_tournament:
            # Tournament matches: ALWAYS use sample boards (no random)
            if hash(match_id) % 2 == 0:
                board = get_sample0()
                board_type = "sample0"
            else:
                board = get_sample1()
                board_type = "sample1"
        else:
            # Non-tournament: 60% sample boards, 40% random
            board_selection = random.random()
            if board_selection < 0.60:
                if hash(match_id) % 2 == 0:
                    board = get_sample0()
                    board_type = "sample0"
                else:
                    board = get_sample1()
                    board_type = "sample1"
            else:
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

        # Create live update callback for tournament matches (enables real-time viewing)
        # Only tournament matches need live updates - matchmaking can batch at end
        def live_move_callback(move_number, board_state, move_time_ms, notation):
            """Save each move to database immediately for live viewing"""
            try:
                evaluation = calculate_evaluation(board_state, move_number % 2)
                cur.execute("""
                    INSERT INTO game_states (id, match_id, move_number, board_state, move_time_ms, move_notation, evaluation)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (match_id, move_number) DO NOTHING
                """, (
                    match_id,
                    move_number,
                    json.dumps(board_state),
                    move_time_ms or 0,
                    notation or '',
                    evaluation
                ))
                conn.commit()
                print(f"[LIVE] Saved move {move_number} for match {match_id}")
            except Exception as e:
                print(f"[LIVE] Error saving move {move_number}: {e}")
                conn.rollback()

        # Use live callback only for tournament matches
        use_live_callback = match.get('match_type') == 'tournament'

        # Check if we have any local agents
        has_local_agents = (match['white_execution_mode'] == 'local' or match['black_execution_mode'] == 'local')

        # Determine if this executor is external
        is_external_executor = os.getenv('EXECUTOR_IS_EXTERNAL', 'false').lower() == 'true'

        # Use hybrid executor for all matches (supports both local and server agents)
        # Both internal and external executors can now run local agent matches
        if has_local_agents or not is_external_executor:
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
                match_id=match_id,
                on_move_callback=live_move_callback if use_live_callback else None
            )
        else:
            # External executors running server-vs-server matches can use simpler executor
            result = run_match_local(
                match['white_code'],
                match['black_code'],
                board,
                on_move_callback=live_move_callback if use_live_callback else None
            )

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
                schedule_round_robin.delay() if not is_tournament_time() else None
            return

        # Check if match ended in error with insufficient moves (< 2 per agent = < 4 total)
        # These games are meaningless and should be deleted entirely
        is_error = result['termination'] in ('error', 'white_error', 'black_error', 'system_error', 'stuck_timeout')
        if is_error and result['moves'] < 4:
            error_msg = result.get('error', 'Unknown error during match execution')
            print(f"Match {match_id} ended in error with only {result['moves']} moves: {error_msg}")
            print(f"Deleting insufficient-moves error match {match_id} from database")

            try:
                cur.execute("DELETE FROM game_states WHERE match_id = %s", (match_id,))
                conn.commit()
            except Exception as state_error:
                print(f"Error deleting game states for error match {match_id}: {state_error}")
                conn.rollback()

            try:
                cur.execute("DELETE FROM matches WHERE id = %s", (match_id,))
                conn.commit()
                print(f"Removed error match {match_id} from matches table")
            except Exception as delete_error:
                print(f"Error deleting error match {match_id}: {delete_error}")
                conn.rollback()

            if match.get('match_type') == 'matchmaking':
                schedule_round_robin.delay() if not is_tournament_time() else None
            return

        # Insert game states with delay for exhibition matches
        # Skip for tournament matches - they were already saved live via callback
        if not use_live_callback:
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
        # Games with 3 or fewer moves are invalid (< 2 per agent) - delete them entirely
        if result['moves'] <= 3:
            print(f"Match {match_id} INVALID: Only {result['moves']} move(s), deleting from database")

            try:
                cur.execute("DELETE FROM game_states WHERE match_id = %s", (match_id,))
                conn.commit()
            except Exception as state_error:
                print(f"Error deleting game states for invalid match {match_id}: {state_error}")
                conn.rollback()

            try:
                cur.execute("DELETE FROM matches WHERE id = %s", (match_id,))
                conn.commit()
                print(f"Removed invalid match {match_id} from matches table")
            except Exception as delete_error:
                print(f"Error deleting invalid match {match_id}: {delete_error}")
                conn.rollback()

            if match.get('match_type') == 'matchmaking':
                schedule_round_robin.delay() if not is_tournament_time() else None
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

        # Trigger ELO rating update for matchmaking and tournament games (not for errors or exhibitions)
        if match.get('match_type') in ('matchmaking', 'tournament'):
            update_match_ratings.delay(match_id)
            # Trigger immediate rescheduling to fill the now-available slot (matchmaking only)
            if match.get('match_type') == 'matchmaking':
                schedule_round_robin.delay() if not is_tournament_time() else None
            # Tournament matches: schedule_all_brackets is handled by celery beat

    except Exception as e:
        import traceback
        print(f"[MATCH_RUNNER] SYSTEM_ERROR for match {match_id}: {e}")
        print(f"[MATCH_RUNNER] Traceback: {traceback.format_exc()}")
        # Rollback the transaction first to clear any error state
        conn.rollback()

        try:
            # Now try to update match status to error with termination reason
            cur.execute("""
                UPDATE matches
                SET status = 'error', termination = 'system_error', completed_at = NOW()
                WHERE id = %s
            """, (match_id,))
            conn.commit()
            print(f"[MATCH_RUNNER] Marked match {match_id} as system_error")
        except Exception as update_error:
            print(f"[MATCH_RUNNER] Failed to update match status to error: {update_error}")
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
    # TOURNAMENT MODE: No regular matchmaking allowed
    if is_tournament_time():
        print("[MATCHMAKING] Tournament mode active - skipping regular matchmaking")
        return

    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Get dynamic match limit from executor registry (4 matches per executor)
        # Single shared pool for all match types (server-vs-server and local-vs-server)
        # local vs local: unlimited (runs on user machines)
        MAX_MATCHES = get_registry().get_match_limit()

        # Count all active matchmaking matches that use executor resources
        # (excludes local-vs-local which runs on user machines)
        cur.execute("""
            SELECT COUNT(*) as count FROM matches m
            JOIN agents wa ON m.white_agent_id = wa.id
            JOIN agents ba ON m.black_agent_id = ba.id
            WHERE m.match_type = 'matchmaking'
            AND m.status IN ('pending', 'in_progress')
            AND NOT (wa.execution_mode = 'local' AND ba.execution_mode = 'local')
        """)
        result = cur.fetchone()
        current_matches = result['count'] if result else 0

        print(f"Active matches: {current_matches}/{MAX_MATCHES} (dynamic limit from {get_registry().get_active_executors().__len__()} executors)")

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
                    AND COALESCE(am.active_count, 0) < 4
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

        # Calculate slots available in shared pool
        slots_available = MAX_MATCHES - current_matches

        print(f"Slots available: {slots_available}")

        # Don't schedule if at capacity (race condition protection)
        if slots_available <= 0:
            print("All match slots at capacity, skipping scheduling")
            return

        scheduled_count = 0
        max_attempts = min(3, slots_available)  # Schedule up to 3 or available slots per round

        # ELO-based matchmaking settings
        ELO_RANGE = 200  # Initial ELO range for matching
        ELO_RANGE_MULTIPLIERS = [1, 2, 3]  # 200, 400, 600 ELO ranges

        for attempt in range(max_attempts):
            if len(all_agents) < 2:
                print(f"Not enough agents to schedule more matches")
                break

            # Check if we can schedule any more matches
            if slots_available <= 0:
                print(f"All match slots filled (scheduled {scheduled_count} this round)")
                break

            # ELO-based matching: Find best pair within ELO range
            # Prioritize agents with fewer active matches, then match by ELO
            matched_pair = None
            match_elo_diff = None

            # Sort by fewest active matches first
            all_agents.sort(key=lambda x: (x['active_matches'], random.random()))

            # Try to find a pair within progressively wider ELO ranges
            for range_mult in ELO_RANGE_MULTIPLIERS:
                current_range = ELO_RANGE * range_mult
                for i, agent1 in enumerate(all_agents):
                    for j, agent2 in enumerate(all_agents):
                        if i >= j:
                            continue

                        elo_diff = abs(agent1['elo_rating'] - agent2['elo_rating'])

                        if elo_diff <= current_range:
                            matched_pair = (agent1, agent2)
                            match_elo_diff = elo_diff
                            break

                    if matched_pair:
                        break
                if matched_pair:
                    print(f"ELO match found within {current_range} range (diff: {match_elo_diff})")
                    break

            # Fallback: match any two agents if no ELO-appropriate match
            if not matched_pair and len(all_agents) >= 2:
                matched_pair = (all_agents[0], all_agents[1])
                match_elo_diff = abs(all_agents[0]['elo_rating'] - all_agents[1]['elo_rating'])
                print(f"No ELO match within range, using fallback (diff: {match_elo_diff})")

            if not matched_pair:
                print(f"Not enough agents for pairing")
                break

            agent1, agent2 = matched_pair

            # Randomly assign colors for fairness (50/50 chance)
            if random.random() < 0.5:
                white_agent = agent1
                black_agent = agent2
            else:
                white_agent = agent2
                black_agent = agent1

            # Check if this match uses executor resources (not local-vs-local)
            both_local = (white_agent['execution_mode'] == 'local' and black_agent['execution_mode'] == 'local')

            # Local-vs-local doesn't use executor slots
            if not both_local and slots_available <= 0:
                print(f"No executor slots available for this match type")
                break

            # Create matchmaking game
            cur.execute("""
                INSERT INTO matches (id, white_agent_id, black_agent_id, status, match_type)
                VALUES (gen_random_uuid(), %s, %s, 'pending', 'matchmaking')
                RETURNING id
            """, (white_agent['id'], black_agent['id']))

            new_match = cur.fetchone()
            conn.commit()

            # Decrement slot counter only if using executor resources
            if not both_local:
                slots_available -= 1

            # Update agent active match counts and re-sort
            for agent in all_agents:
                if agent['id'] == white_agent['id'] or agent['id'] == black_agent['id']:
                    agent['active_matches'] += 1

            # Re-sort by active matches for next iteration
            all_agents.sort(key=lambda x: (x['active_matches'], random.random()))

            # Enhanced logging with ELO info
            print(f"Scheduled game #{scheduled_count + 1}: {white_agent['name']} (ELO={white_agent['elo_rating']}, {white_agent['execution_mode']}) vs {black_agent['name']} (ELO={black_agent['elo_rating']}, {black_agent['execution_mode']}) [ELO diff: {match_elo_diff}]")

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
            # Update all stuck matches to error status with termination reason
            match_ids = [m['id'] for m in stuck_matches]
            cur.execute("""
                UPDATE matches
                SET status = 'error',
                    termination = 'stuck_timeout',
                    completed_at = NOW()
                WHERE id = ANY(%s)
            """, (match_ids,))
            conn.commit()

            print(f"[MATCH_RUNNER] STUCK_TIMEOUT: Cleaned up {len(stuck_matches)} stuck matches: {match_ids}")

            # Trigger rescheduling if any matchmaking games were cleaned up
            if any(m['match_type'] == 'matchmaking' for m in stuck_matches):
                print("Triggering rescheduling after stuck match cleanup")
                schedule_round_robin.delay() if not is_tournament_time() else None

    except Exception as e:
        print(f"Error cleaning up stuck matches: {e}")

    finally:
        cur.close()
        conn.close()


@app.task(name='tasks.match_runner.matchmaking_tick')
def matchmaking_tick():
    """
    Called every 5 seconds by celery beat.
    Runs regular matchmaking only if tournament has NOT started.
    """
    if is_tournament_time():
        return  # Tournament is active, no regular matchmaking

    # Run regular matchmaking
    schedule_round_robin()
    schedule_exhibition_matches()
