import os
from datetime import datetime, timezone as tz
from celery.schedules import crontab

broker_url = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')
result_backend = os.getenv('CELERY_RESULT_BACKEND', 'redis://localhost:6379/1')

task_serializer = 'json'
result_serializer = 'json'
accept_content = ['json']
timezone = 'UTC'
enable_utc = True

worker_prefetch_multiplier = 2
task_acks_late = True
task_reject_on_worker_lost = True
worker_pool_restarts = True

task_time_limit = 300
task_soft_time_limit = 240


def is_tournament_active():
    """Check if tournament should be active based on start time."""
    tournament_start = datetime(2025, 12, 12, 17, 0, 0, tzinfo=tz.utc)
    now = datetime.now(tz.utc)
    return now >= tournament_start


# Always run both schedules - the tasks themselves check if tournament is active
# This allows automatic switching without restarting celery beat
beat_schedule = {
    # Tournament task - checks time internally, only runs when tournament is active
    'tournament-check': {
        'task': 'tasks.tournament_runner.tournament_tick',
        'schedule': 5.0,  # Check every 5 seconds
    },
    # Regular matchmaking - checks time internally, stops when tournament starts
    'matchmaking-check': {
        'task': 'tasks.match_runner.matchmaking_tick',
        'schedule': 5.0,
    },
    'cleanup-stuck-matches': {
        'task': 'tasks.match_runner.cleanup_stuck_matches',
        'schedule': 60.0,
    },
    'update-elo-ratings': {
        'task': 'tasks.elo_updater.update_all_ratings',
        'schedule': crontab(minute='*/10'),
    },
    'process-validation-queue': {
        'task': 'tasks.agent_tester.process_validation_queue',
        'schedule': 10.0,
    },
}
