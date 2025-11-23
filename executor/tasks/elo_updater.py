from worker import app
import psycopg2
import psycopg2.extras
import os


def calculate_elo_change(rating_a: int, rating_b: int, score_a: float, k_factor: int = 32) -> int:
    expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    change = round(k_factor * (score_a - expected_a))
    return change


@app.task(name='tasks.elo_updater.update_match_ratings', autoretry_for=(Exception,), retry_kwargs={'max_retries': 3, 'countdown': 1})
def update_match_ratings(match_id: str):
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        cur.execute("SET lock_timeout = '5s';")
        cur.execute("""
            SELECT m.white_agent_id, m.black_agent_id, m.winner,
                   wr.elo_rating as white_elo, wr.games_played as white_games,
                   br.elo_rating as black_elo, br.games_played as black_games
            FROM matches m
            JOIN rankings wr ON m.white_agent_id = wr.agent_id
            JOIN rankings br ON m.black_agent_id = br.agent_id
            WHERE m.id = %s AND m.status = 'completed'
        """, (match_id,))

        match = cur.fetchone()
        if not match:
            print(f"Match {match_id} not found or not completed")
            return

        # Calculate average move times for each agent
        cur.execute("""
            SELECT
                AVG(CASE WHEN move_number %% 2 = 1 THEN move_time_ms END) as white_avg_time,
                AVG(CASE WHEN move_number %% 2 = 0 THEN move_time_ms END) as black_avg_time
            FROM game_states
            WHERE match_id = %s AND move_time_ms IS NOT NULL
        """, (match_id,))

        move_times = cur.fetchone()
        white_avg_time = int(move_times['white_avg_time']) if move_times and move_times['white_avg_time'] else None
        black_avg_time = int(move_times['black_avg_time']) if move_times and move_times['black_avg_time'] else None

        # Determine scores
        if match['winner'] == 'white':
            white_score, black_score = 1.0, 0.0
        elif match['winner'] == 'black':
            white_score, black_score = 0.0, 1.0
        elif match['winner'] == 'draw' or match['winner'] is None:
            white_score, black_score = 0.5, 0.5
        else:
            print(f"Unknown winner value: {match['winner']}")
            white_score, black_score = 0.5, 0.5

        # Determine K-factors (higher for new agents)
        white_k = 32 if match['white_games'] < 20 else 16
        black_k = 32 if match['black_games'] < 20 else 16

        # Calculate rating changes
        white_change = calculate_elo_change(
            match['white_elo'],
            match['black_elo'],
            white_score,
            white_k
        )
        black_change = calculate_elo_change(
            match['black_elo'],
            match['white_elo'],
            black_score,
            black_k
        )

        # Lock both ranking rows in a consistent order (by agent_id) to prevent deadlocks
        # Always lock in alphabetical order by agent_id
        agents_ordered = sorted([match['white_agent_id'], match['black_agent_id']])

        cur.execute("""
            SELECT agent_id FROM rankings
            WHERE agent_id IN (%s, %s)
            ORDER BY agent_id
            FOR UPDATE
        """, (agents_ordered[0], agents_ordered[1]))

        # Update white agent ranking with rolling average move time
        if white_avg_time is not None:
            cur.execute("""
                UPDATE rankings
                SET elo_rating = elo_rating + %s,
                    games_played = games_played + 1,
                    wins = wins + %s,
                    losses = losses + %s,
                    draws = draws + %s,
                    avg_move_time_ms = CASE
                        WHEN avg_move_time_ms IS NULL THEN %s
                        ELSE ((avg_move_time_ms * games_played + %s) / (games_played + 1))
                    END,
                    last_updated = NOW()
                WHERE agent_id = %s
            """, (
                white_change,
                1 if white_score == 1.0 else 0,
                1 if white_score == 0.0 else 0,
                1 if white_score == 0.5 else 0,
                white_avg_time,
                white_avg_time,
                match['white_agent_id']
            ))
        else:
            cur.execute("""
                UPDATE rankings
                SET elo_rating = elo_rating + %s,
                    games_played = games_played + 1,
                    wins = wins + %s,
                    losses = losses + %s,
                    draws = draws + %s,
                    last_updated = NOW()
                WHERE agent_id = %s
            """, (
                white_change,
                1 if white_score == 1.0 else 0,
                1 if white_score == 0.0 else 0,
                1 if white_score == 0.5 else 0,
                match['white_agent_id']
            ))

        # Update black agent ranking with rolling average move time
        if black_avg_time is not None:
            cur.execute("""
                UPDATE rankings
                SET elo_rating = elo_rating + %s,
                    games_played = games_played + 1,
                    wins = wins + %s,
                    losses = losses + %s,
                    draws = draws + %s,
                    avg_move_time_ms = CASE
                        WHEN avg_move_time_ms IS NULL THEN %s
                        ELSE ((avg_move_time_ms * games_played + %s) / (games_played + 1))
                    END,
                    last_updated = NOW()
                WHERE agent_id = %s
            """, (
                black_change,
                1 if black_score == 1.0 else 0,
                1 if black_score == 0.0 else 0,
                1 if black_score == 0.5 else 0,
                black_avg_time,
                black_avg_time,
                match['black_agent_id']
            ))
        else:
            cur.execute("""
                UPDATE rankings
                SET elo_rating = elo_rating + %s,
                    games_played = games_played + 1,
                    wins = wins + %s,
                    losses = losses + %s,
                    draws = draws + %s,
                    last_updated = NOW()
                WHERE agent_id = %s
            """, (
                black_change,
                1 if black_score == 1.0 else 0,
                1 if black_score == 0.0 else 0,
                1 if black_score == 0.5 else 0,
                match['black_agent_id']
            ))

        conn.commit()
        print(f"Updated ratings for match {match_id}: White {white_change:+d}, Black {black_change:+d}")

    except Exception as e:
        print(f"Error updating ratings for match {match_id}: {e}")
        conn.rollback()

    finally:
        cur.close()
        conn.close()


@app.task(name='tasks.elo_updater.update_all_ratings')
def update_all_ratings():
    """Update ratings for all recent completed matches"""
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Find completed matches without rating updates (last 24 hours)
        cur.execute("""
            SELECT m.id
            FROM matches m
            WHERE m.status = 'completed'
            AND m.completed_at > NOW() - INTERVAL '24 hours'
            ORDER BY m.completed_at ASC
            LIMIT 100
        """)

        matches = cur.fetchall()

        for match in matches:
            update_match_ratings.delay(match['id'])

        print(f"Queued rating updates for {len(matches)} matches")

    finally:
        cur.close()
        conn.close()
