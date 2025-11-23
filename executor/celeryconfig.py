import os
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

beat_schedule = {
    'continuous-matchmaking': {
        'task': 'tasks.match_runner.schedule_round_robin',
        'schedule': 5.0,
    },
    'process-exhibition-matches': {
        'task': 'tasks.match_runner.schedule_exhibition_matches',
        'schedule': 10.0,
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
