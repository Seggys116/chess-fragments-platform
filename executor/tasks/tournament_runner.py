"""
Tournament Match Runner - Swiss System

Implements Swiss-system tournament across 3 brackets:
- Challenger (Bottom 25%)
- Contender (Middle 50%)
- Elite (Top 25%)

Swiss System Rules:
1. Players with similar scores play each other
2. No player plays the same opponent twice
3. Colors alternate where possible
4. Number of rounds = ceil(log2(n)) where n = number of players

Note: Swiss state is computed in-memory from existing match data.
No additional database tables required.
"""

from worker import app
from tasks.match_runner import run_match_task
import psycopg2
import psycopg2.extras
import os
import math
import random
import json
import redis
from datetime import datetime, timezone as tz
from typing import List, Dict, Tuple
from executor_registry import get_registry

# Redis connection for bracket caching
_redis_client = None
BRACKET_CACHE_KEY = "tournament:bracket_assignments"
BRACKET_CACHE_TTL = 24 * 60 * 60  # 24 hours

def get_redis():
    global _redis_client
    if _redis_client is None:
        redis_url = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')
        _redis_client = redis.from_url(redis_url)
    return _redis_client


def get_cached_brackets() -> Dict[str, List[str]] | None:
    """Get cached bracket assignments from Redis."""
    try:
        r = get_redis()
        data = r.get(BRACKET_CACHE_KEY)
        if data:
            return json.loads(data)
    except Exception as e:
        print(f"[SWISS] Error reading bracket cache: {e}")
    return None


def set_cached_brackets(brackets: Dict[str, List[str]]):
    """Cache bracket assignments in Redis."""
    try:
        r = get_redis()
        r.setex(BRACKET_CACHE_KEY, BRACKET_CACHE_TTL, json.dumps(brackets))
        print(f"[SWISS] Cached bracket assignments: challenger={len(brackets.get('challenger', []))}, contender={len(brackets.get('contender', []))}, elite={len(brackets.get('elite', []))}")
    except Exception as e:
        print(f"[SWISS] Error caching brackets: {e}")


def clear_bracket_cache():
    """Clear cached bracket assignments."""
    try:
        r = get_redis()
        r.delete(BRACKET_CACHE_KEY)
        print("[SWISS] Cleared bracket cache")
    except Exception as e:
        print(f"[SWISS] Error clearing bracket cache: {e}")


def is_tournament_time():
    """Check if tournament should be active based on start time."""
    tournament_start = datetime(2025, 12, 12, 17, 0, 0, tzinfo=tz.utc)
    now = datetime.now(tz.utc)
    return now >= tournament_start


def get_bracket_agents(cur, bracket_id: str) -> list:
    """
    Get agents for a specific bracket.
    Uses cached bracket assignments if available (fixed at tournament start).
    Only includes uploaded (server) agents, not linked (local) agents.
    """
    # Try to use cached brackets first (fixed at tournament start)
    cached = get_cached_brackets()
    if cached and bracket_id in cached:
        agent_ids = cached[bracket_id]
        if not agent_ids:
            return []
        # Fetch agent details for cached IDs
        cur.execute("""
            SELECT
                a.id,
                a.name,
                a.code_text,
                a.execution_mode,
                COALESCE(r.elo_rating, 1500) as elo_rating,
                COALESCE(r.games_played, 0) as games_played
            FROM agents a
            LEFT JOIN rankings r ON a.id = r.agent_id
            WHERE a.id = ANY(%s)
            ORDER BY elo_rating ASC
        """, (agent_ids,))
        return cur.fetchall()

    # Fallback to dynamic calculation if no cache
    cur.execute("""
        WITH ranked_agents AS (
            SELECT
                a.id,
                a.name,
                a.code_text,
                a.execution_mode,
                COALESCE(r.elo_rating, 1500) as elo_rating,
                COALESCE(r.games_played, 0) as games_played
            FROM agents a
            LEFT JOIN rankings r ON a.id = r.agent_id
            WHERE a.active = true
            AND a.execution_mode = 'server'
            AND COALESCE(r.games_played, 0) > 0
            ORDER BY elo_rating ASC
        )
        SELECT * FROM ranked_agents
    """)

    all_agents = cur.fetchall()
    total = len(all_agents)

    if total == 0:
        return []

    if total < 8:
        if bracket_id == 'contender':
            return all_agents
        else:
            return []

    bottom_25_end = max(1, round(total * 0.25))
    top_25_start = max(bottom_25_end, round(total * 0.75))

    if bracket_id == 'challenger':
        return all_agents[:bottom_25_end]
    elif bracket_id == 'contender':
        return all_agents[bottom_25_end:top_25_start]
    elif bracket_id == 'elite':
        return all_agents[top_25_start:]

    return []


def get_bracket_agent_ids(cur, bracket_id: str) -> List[str]:
    """Get just the agent IDs for a bracket. Uses cached brackets if available."""
    # Try to use cached brackets first (fixed at tournament start)
    cached = get_cached_brackets()
    if cached and bracket_id in cached:
        return cached[bracket_id]

    # Fallback to dynamic calculation if no cache
    agents = get_bracket_agents(cur, bracket_id)
    return [a['id'] for a in agents]


def compute_swiss_standings(cur, bracket_id: str, bracket_agent_ids: List[str]) -> Dict[str, dict]:
    """
    Compute Swiss standings from completed tournament matches.
    Returns dict of agent_id -> {points, matches_played, opponents, buchholz}
    """
    if not bracket_agent_ids:
        return {}

    # Initialize standings for all agents
    standings = {}
    for agent_id in bracket_agent_ids:
        standings[agent_id] = {
            'points': 0.0,
            'matches_played': 0,
            'opponents': [],
            'buchholz': 0.0
        }

    # Get all completed tournament matches for this bracket
    cur.execute("""
        SELECT white_agent_id, black_agent_id, winner
        FROM matches
        WHERE match_type = 'tournament'
        AND status = 'completed'
        AND white_agent_id = ANY(%s)
        AND black_agent_id = ANY(%s)
        ORDER BY completed_at ASC
    """, (bracket_agent_ids, bracket_agent_ids))

    matches = cur.fetchall()

    for match in matches:
        white_id = match['white_agent_id']
        black_id = match['black_agent_id']
        winner = match['winner']

        # Skip if either agent not in our bracket anymore
        if white_id not in standings or black_id not in standings:
            continue

        # Update opponents lists
        if black_id not in standings[white_id]['opponents']:
            standings[white_id]['opponents'].append(black_id)
            standings[white_id]['matches_played'] += 1

        if white_id not in standings[black_id]['opponents']:
            standings[black_id]['opponents'].append(white_id)
            standings[black_id]['matches_played'] += 1

        # Update points
        if winner == 'white':
            standings[white_id]['points'] += 1.0
        elif winner == 'black':
            standings[black_id]['points'] += 1.0
        else:  # Draw
            standings[white_id]['points'] += 0.5
            standings[black_id]['points'] += 0.5

    # Calculate Buchholz (sum of opponents' points)
    for agent_id, standing in standings.items():
        buchholz = 0.0
        for opp_id in standing['opponents']:
            if opp_id in standings:
                buchholz += standings[opp_id]['points']
        standing['buchholz'] = buchholz

    return standings


def calculate_total_rounds(num_agents: int) -> int:
    """Calculate total rounds for Swiss tournament."""
    if num_agents < 2:
        return 0
    # For Swiss: min of ceil(log2(n)) and (n-1) since each player can only play n-1 unique opponents
    log_rounds = math.ceil(math.log2(num_agents))
    max_possible_rounds = num_agents - 1
    # Use at least 3 rounds if we have enough agents, but cap at max possible
    return min(max(3, log_rounds), max_possible_rounds)


def get_current_round(standings: Dict[str, dict], total_rounds: int) -> int:
    """Determine current round based on matches played."""
    if not standings:
        return 1

    # Find min/max matches played
    match_counts = [s['matches_played'] for s in standings.values()]
    max_matches = max(match_counts)
    min_matches = min(match_counts)

    # If everyone has played same number, we're starting next round
    if min_matches == max_matches:
        return min(max_matches + 1, total_rounds)
    else:
        return min(max_matches, total_rounds)


def has_played_before(standings: Dict[str, dict], agent1_id: str, agent2_id: str) -> bool:
    """Check if two agents have played each other."""
    if agent1_id not in standings or agent2_id not in standings:
        return False
    return agent2_id in standings[agent1_id]['opponents']


def swiss_pairing(agents: list, standings: Dict[str, dict]) -> List[Tuple[dict, dict]]:
    """
    Swiss pairing algorithm.
    Groups players by score, then pairs within groups, avoiding repeat matchups.
    """
    if len(agents) < 2:
        return []

    # Filter to agents that haven't played all possible opponents
    eligible_agents = []
    for agent in agents:
        standing = standings.get(agent['id'], {'opponents': []})
        played_count = len(standing.get('opponents', []))
        max_opponents = len(agents) - 1
        if played_count < max_opponents:
            eligible_agents.append(agent)

    if len(eligible_agents) < 2:
        return []

    # Sort agents by points (desc), buchholz (desc), elo (desc)
    def sort_key(agent):
        s = standings.get(agent['id'], {'points': 0, 'buchholz': 0})
        return (-s.get('points', 0), -s.get('buchholz', 0), -agent.get('elo_rating', 1500))

    sorted_agents = sorted(eligible_agents, key=sort_key)

    # Group by points
    score_groups: Dict[float, List[dict]] = {}
    for agent in sorted_agents:
        points = standings.get(agent['id'], {'points': 0})['points']
        if points not in score_groups:
            score_groups[points] = []
        score_groups[points].append(agent)

    # Shuffle within groups for variety
    for group in score_groups.values():
        random.shuffle(group)

    # Flatten maintaining score order
    ordered_agents = []
    for score in sorted(score_groups.keys(), reverse=True):
        ordered_agents.extend(score_groups[score])

    # Greedy pairing
    pairings = []
    paired = set()

    for agent1 in ordered_agents:
        if agent1['id'] in paired:
            continue

        best_opponent = None
        best_score_diff = float('inf')

        for agent2 in ordered_agents:
            if agent1['id'] == agent2['id'] or agent2['id'] in paired:
                continue

            if has_played_before(standings, agent1['id'], agent2['id']):
                continue

            points1 = standings.get(agent1['id'], {'points': 0})['points']
            points2 = standings.get(agent2['id'], {'points': 0})['points']
            score_diff = abs(points1 - points2)

            if score_diff < best_score_diff:
                best_score_diff = score_diff
                best_opponent = agent2

        if best_opponent:
            paired.add(agent1['id'])
            paired.add(best_opponent['id'])

            # Randomize colors
            if random.random() < 0.5:
                pairings.append((agent1, best_opponent))
            else:
                pairings.append((best_opponent, agent1))

    return pairings


def count_active_tournament_matches(cur, bracket_agent_ids: List[str]) -> int:
    """Count active tournament matches for agents in this bracket."""
    if not bracket_agent_ids:
        return 0

    cur.execute("""
        SELECT COUNT(*) as count FROM matches
        WHERE match_type = 'tournament'
        AND status IN ('pending', 'in_progress')
        AND white_agent_id = ANY(%s)
        AND black_agent_id = ANY(%s)
    """, (bracket_agent_ids, bracket_agent_ids))

    result = cur.fetchone()
    return result['count'] if result else 0


@app.task(name='tasks.tournament_runner.schedule_tournament_bracket')
def schedule_tournament_bracket(bracket_id: str, max_concurrent: int = None):
    """
    Schedule Swiss-system tournament matches for a specific bracket.
    max_concurrent is calculated dynamically from executor count if not provided.
    """
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Set concurrent matches per bracket:
        # Elite/Challenger (25% brackets): 2 matches
        # Contender (50% bracket): 3 matches
        if bracket_id == 'contender':
            max_concurrent = 3
        else:
            max_concurrent = 2
        print(f"[SWISS] max_concurrent set to {max_concurrent} for {bracket_id}")

        bracket_agents = get_bracket_agents(cur, bracket_id)
        bracket_agent_ids = [a['id'] for a in bracket_agents]

        if len(bracket_agents) < 2:
            print(f"[SWISS] Not enough agents in {bracket_id} bracket: {len(bracket_agents)}")
            return

        # Compute current standings from matches
        standings = compute_swiss_standings(cur, bracket_id, bracket_agent_ids)

        # Calculate total rounds using new function
        total_rounds = calculate_total_rounds(len(bracket_agents))
        current_round = get_current_round(standings, total_rounds)

        # Check if tournament is complete
        min_matches = min(s['matches_played'] for s in standings.values()) if standings else 0
        if min_matches >= total_rounds:
            print(f"[SWISS] {bracket_id} bracket tournament complete (all agents played {total_rounds} rounds)")
            return

        # Check active matches
        active_count = count_active_tournament_matches(cur, bracket_agent_ids)
        if active_count >= max_concurrent:
            print(f"[SWISS] {bracket_id} at capacity: {active_count}/{max_concurrent} active matches")
            return

        # Check if all current matches are complete before scheduling new round
        if active_count > 0:
            print(f"[SWISS] {bracket_id} waiting for {active_count} matches to complete")
            return

        # Generate Swiss pairings
        pairings = swiss_pairing(bracket_agents, standings)

        if not pairings:
            print(f"[SWISS] No valid pairings for {bracket_id} round {current_round}")
            return

        print(f"[SWISS] Creating {len(pairings)} matches for {bracket_id} round {current_round}/{total_rounds}")

        # Create matches
        slots_available = max_concurrent - active_count
        created = 0

        for white_agent, black_agent in pairings:
            if created >= slots_available:
                break

            # Double-check they haven't played (race condition protection)
            cur.execute("""
                SELECT COUNT(*) as count FROM matches
                WHERE match_type = 'tournament'
                AND (
                    (white_agent_id = %s AND black_agent_id = %s)
                    OR (white_agent_id = %s AND black_agent_id = %s)
                )
            """, (white_agent['id'], black_agent['id'], black_agent['id'], white_agent['id']))

            if cur.fetchone()['count'] > 0:
                continue

            cur.execute("""
                INSERT INTO matches (id, white_agent_id, black_agent_id, status, match_type)
                VALUES (gen_random_uuid(), %s, %s, 'pending', 'tournament')
                RETURNING id
            """, (white_agent['id'], black_agent['id']))

            new_match = cur.fetchone()
            conn.commit()

            print(f"[SWISS] Round {current_round}: {white_agent['name']} vs {black_agent['name']}")

            run_match_task.delay(new_match['id'])
            created += 1

        print(f"[SWISS] Created {created} matches for {bracket_id}")

    except Exception as e:
        print(f"[SWISS] Error scheduling {bracket_id} bracket: {e}")
        import traceback
        traceback.print_exc()
        conn.rollback()

    finally:
        cur.close()
        conn.close()


_tournament_initialized = False


@app.task(name='tasks.tournament_runner.initialize_tournament')
def initialize_tournament():
    """
    Initialize tournament mode:
    - Cancel all in-progress and pending non-tournament matches
    - Deactivate all local (non-uploaded) agents
    - Snapshot bracket assignments to Redis (fixed for entire tournament)
    """
    global _tournament_initialized
    if _tournament_initialized:
        return

    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Cancel all non-tournament matches that are pending or in_progress
        cur.execute("""
            UPDATE matches
            SET status = 'cancelled'
            WHERE status IN ('pending', 'in_progress')
            AND match_type != 'tournament'
            RETURNING id
        """)
        cancelled_matches = cur.fetchall()
        print(f"[TOURNAMENT] Cancelled {len(cancelled_matches)} non-tournament matches")

        # Deactivate all local agents (only server/uploaded agents participate)
        cur.execute("""
            UPDATE agents
            SET active = false
            WHERE execution_mode = 'local'
            AND active = true
            RETURNING id, name
        """)
        deactivated_agents = cur.fetchall()
        print(f"[TOURNAMENT] Deactivated {len(deactivated_agents)} local agents")

        conn.commit()

        # Snapshot bracket assignments - this is the key fix!
        # Get all eligible agents ONCE and cache the bracket assignments
        cur.execute("""
            SELECT
                a.id,
                COALESCE(r.elo_rating, 1500) as elo_rating
            FROM agents a
            LEFT JOIN rankings r ON a.id = r.agent_id
            WHERE a.active = true
            AND a.execution_mode = 'server'
            AND COALESCE(r.games_played, 0) > 0
            ORDER BY elo_rating ASC
        """)
        all_agents = cur.fetchall()
        total = len(all_agents)

        brackets: Dict[str, List[str]] = {
            'challenger': [],
            'contender': [],
            'elite': []
        }

        if total > 0:
            if total < 8:
                # All agents go to contender
                brackets['contender'] = [a['id'] for a in all_agents]
            else:
                bottom_25_end = max(1, round(total * 0.25))
                top_25_start = max(bottom_25_end, round(total * 0.75))

                brackets['challenger'] = [a['id'] for a in all_agents[:bottom_25_end]]
                brackets['contender'] = [a['id'] for a in all_agents[bottom_25_end:top_25_start]]
                brackets['elite'] = [a['id'] for a in all_agents[top_25_start:]]

        # Cache the bracket assignments
        set_cached_brackets(brackets)

        _tournament_initialized = True
        print("[TOURNAMENT] Tournament initialized successfully")

    except Exception as e:
        print(f"[TOURNAMENT] Error initializing tournament: {e}")
        import traceback
        traceback.print_exc()
        conn.rollback()

    finally:
        cur.close()
        conn.close()


@app.task(name='tasks.tournament_runner.schedule_all_brackets')
def schedule_all_brackets():
    """Schedule Swiss tournament matches for all active brackets."""
    # Ensure tournament is initialized first
    initialize_tournament()

    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        cur.execute("""
            SELECT COUNT(*) as total
            FROM agents a
            LEFT JOIN rankings r ON a.id = r.agent_id
            WHERE a.active = true
            AND a.execution_mode = 'server'
            AND COALESCE(r.games_played, 0) > 0
        """)

        result = cur.fetchone()
        total = result['total'] or 0

        if total == 0:
            print("[SWISS] No agents available for tournament")
            return

        if total < 8:
            print(f"[SWISS] Only {total} agents - running single combined bracket")
            if total >= 2:
                schedule_tournament_bracket.delay('contender')
            return

        cur.execute("""
            WITH ranked_agents AS (
                SELECT
                    a.id,
                    COALESCE(r.elo_rating, 1500) as elo_rating,
                    ROW_NUMBER() OVER (ORDER BY COALESCE(r.elo_rating, 1500) ASC) as rn,
                    COUNT(*) OVER () as total
                FROM agents a
                LEFT JOIN rankings r ON a.id = r.agent_id
                WHERE a.active = true
                AND a.execution_mode = 'server'
                AND COALESCE(r.games_played, 0) > 0
            )
            SELECT
                SUM(CASE WHEN rn <= total * 0.25 THEN 1 ELSE 0 END) as challenger_count,
                SUM(CASE WHEN rn > total * 0.25 AND rn <= total * 0.75 THEN 1 ELSE 0 END) as contender_count,
                SUM(CASE WHEN rn > total * 0.75 THEN 1 ELSE 0 END) as elite_count,
                total
            FROM ranked_agents
            GROUP BY total
        """)

        result = cur.fetchone()
        if not result:
            return

        challenger_count = result['challenger_count'] or 0
        contender_count = result['contender_count'] or 0
        elite_count = result['elite_count'] or 0

        print(f"[SWISS] Brackets - Challenger: {challenger_count}, Contender: {contender_count}, Elite: {elite_count}")

        if challenger_count >= 2:
            schedule_tournament_bracket.delay('challenger')
        if contender_count >= 2:
            schedule_tournament_bracket.delay('contender')
        if elite_count >= 2:
            schedule_tournament_bracket.delay('elite')

    except Exception as e:
        print(f"[SWISS] Error scheduling all brackets: {e}")
        import traceback
        traceback.print_exc()

    finally:
        cur.close()
        conn.close()


@app.task(name='tasks.tournament_runner.get_tournament_status')
def get_tournament_status():
    """Get current Swiss tournament status."""
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        status = {}

        for bracket_id in ['challenger', 'contender', 'elite']:
            bracket_agents = get_bracket_agents(cur, bracket_id)
            bracket_agent_ids = [a['id'] for a in bracket_agents]

            bracket_status = {
                'agents': len(bracket_agents),
                'pending': 0,
                'in_progress': 0,
                'completed': 0,
                'current_round': 0,
                'total_rounds': 0,
                'tournament_complete': False
            }

            if bracket_agent_ids:
                # Compute standings
                standings = compute_swiss_standings(cur, bracket_id, bracket_agent_ids)

                total_rounds = calculate_total_rounds(len(bracket_agents))
                current_round = get_current_round(standings, total_rounds)

                bracket_status['current_round'] = current_round
                bracket_status['total_rounds'] = total_rounds

                # Check completion
                if standings:
                    min_matches = min(s['matches_played'] for s in standings.values())
                    bracket_status['tournament_complete'] = min_matches >= total_rounds

                # Count matches
                cur.execute("""
                    SELECT status, COUNT(*) as count
                    FROM matches
                    WHERE match_type = 'tournament'
                    AND white_agent_id = ANY(%s)
                    AND black_agent_id = ANY(%s)
                    GROUP BY status
                """, (bracket_agent_ids, bracket_agent_ids))

                for row in cur.fetchall():
                    if row['status'] in ('pending', 'in_progress', 'completed'):
                        bracket_status[row['status']] = row['count']

            status[bracket_id] = bracket_status

        return status

    except Exception as e:
        print(f"[SWISS] Error getting status: {e}")
        return None

    finally:
        cur.close()
        conn.close()


@app.task(name='tasks.tournament_runner.tournament_tick')
def tournament_tick():
    """
    Called every 5 seconds by celery beat.
    Only runs tournament scheduling if tournament time has started.
    """
    if not is_tournament_time():
        return  # Not tournament time yet

    # Tournament is active - run the scheduler
    schedule_all_brackets()
