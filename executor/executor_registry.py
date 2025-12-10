"""
Executor Registry - Redis-based executor discovery with heartbeat mechanism.

Executors register themselves on startup and send periodic heartbeats.
The scheduler queries this registry to determine dynamic match limits.
"""
import os
import redis
import socket
from datetime import datetime, timezone
from typing import Dict, List

# Configuration
REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379')
HEARTBEAT_INTERVAL = int(os.getenv('EXECUTOR_HEARTBEAT_INTERVAL', '10'))
STALE_THRESHOLD = int(os.getenv('EXECUTOR_STALE_THRESHOLD', '30'))
MATCHES_PER_EXECUTOR = int(os.getenv('MATCHES_PER_EXECUTOR', '4'))
EXECUTOR_CONCURRENCY = int(os.getenv('EXECUTOR_CONCURRENCY', '8'))
EXECUTOR_IS_EXTERNAL = os.getenv('EXECUTOR_IS_EXTERNAL', 'false').lower() == 'true'

# Fallback limit when no executors registered
FALLBACK_MAX_MATCHES = 8


class ExecutorRegistry:
    """Manages executor registration and discovery via Redis."""

    def __init__(self, redis_url: str = None):
        self.redis_url = redis_url or REDIS_URL
        self._redis_client = None
        self.worker_id = None

    @property
    def redis_client(self):
        if self._redis_client is None:
            self._redis_client = redis.from_url(self.redis_url, decode_responses=True)
        return self._redis_client

    def register_executor(self, worker_id: str, concurrency: int = None):
        """Register this executor with the registry."""
        self.worker_id = worker_id
        concurrency = concurrency or EXECUTOR_CONCURRENCY

        now = datetime.now(timezone.utc).isoformat()
        executor_info = {
            'hostname': socket.gethostname(),
            'concurrency': concurrency,
            'matches_per_executor': MATCHES_PER_EXECUTOR,
            'last_heartbeat': now,
            'started_at': now,
            'is_external': str(EXECUTOR_IS_EXTERNAL).lower(),
        }

        key = f'executor:registry:{worker_id}'
        self.redis_client.hset(key, mapping=executor_info)
        self.redis_client.sadd('executor:registry:active', worker_id)

        # Set TTL slightly longer than stale threshold for auto-cleanup
        self.redis_client.expire(key, STALE_THRESHOLD + 10)

        print(f"[EXECUTOR_REGISTRY] Registered executor {worker_id} "
              f"(concurrency={concurrency}, matches_per={MATCHES_PER_EXECUTOR}, "
              f"external={EXECUTOR_IS_EXTERNAL})")

    def send_heartbeat(self, worker_id: str = None):
        """Send heartbeat to keep executor registration alive."""
        worker_id = worker_id or self.worker_id
        if not worker_id:
            return

        key = f'executor:registry:{worker_id}'
        now = datetime.now(timezone.utc).isoformat()

        # Update heartbeat and refresh TTL
        self.redis_client.hset(key, 'last_heartbeat', now)
        self.redis_client.expire(key, STALE_THRESHOLD + 10)
        self.redis_client.sadd('executor:registry:active', worker_id)

    def deregister_executor(self, worker_id: str = None):
        """Remove executor from registry (on shutdown)."""
        worker_id = worker_id or self.worker_id
        if not worker_id:
            return

        key = f'executor:registry:{worker_id}'
        self.redis_client.delete(key)
        self.redis_client.srem('executor:registry:active', worker_id)

        print(f"[EXECUTOR_REGISTRY] Deregistered executor {worker_id}")

    def get_active_executors(self) -> List[Dict]:
        """Get all active executors (heartbeat within threshold)."""
        active_ids = self.redis_client.smembers('executor:registry:active')

        if not active_ids:
            return []

        active_executors = []
        stale_ids = []
        now = datetime.now(timezone.utc)

        for worker_id in active_ids:
            key = f'executor:registry:{worker_id}'
            info = self.redis_client.hgetall(key)

            if not info:
                stale_ids.append(worker_id)
                continue

            # Check if heartbeat is within threshold
            try:
                last_heartbeat = datetime.fromisoformat(info.get('last_heartbeat', ''))
                age_seconds = (now - last_heartbeat).total_seconds()

                if age_seconds > STALE_THRESHOLD:
                    stale_ids.append(worker_id)
                    continue
            except (ValueError, TypeError):
                stale_ids.append(worker_id)
                continue

            active_executors.append({
                'worker_id': worker_id,
                'hostname': info.get('hostname', 'unknown'),
                'concurrency': int(info.get('concurrency', EXECUTOR_CONCURRENCY)),
                'matches_per_executor': int(info.get('matches_per_executor', MATCHES_PER_EXECUTOR)),
                'is_external': info.get('is_external', 'false') == 'true',
                'last_heartbeat': info.get('last_heartbeat'),
            })

        # Clean up stale entries
        if stale_ids:
            for stale_id in stale_ids:
                self.redis_client.srem('executor:registry:active', stale_id)
                self.redis_client.delete(f'executor:registry:{stale_id}')
            print(f"[EXECUTOR_REGISTRY] Cleaned up {len(stale_ids)} stale executors")

        return active_executors

    def get_match_limit(self) -> int:
        """
        Calculate dynamic match limit based on active executors.

        Returns:
            Total number of matches that can run concurrently
        """
        try:
            executors = self.get_active_executors()

            if not executors:
                print(f"[EXECUTOR_REGISTRY] No active executors, using fallback limit: {FALLBACK_MAX_MATCHES}")
                return FALLBACK_MAX_MATCHES

            # Sum up matches per executor from all active executors
            total_match_capacity = sum(e['matches_per_executor'] for e in executors)

            print(f"[EXECUTOR_REGISTRY] {len(executors)} active executors, "
                  f"total match capacity: {total_match_capacity}")

            return total_match_capacity

        except redis.RedisError as e:
            print(f"[EXECUTOR_REGISTRY] Redis error, using fallback limit: {e}")
            return FALLBACK_MAX_MATCHES


# Global registry instance
_registry = None


def get_registry() -> ExecutorRegistry:
    """Get the global executor registry instance."""
    global _registry
    if _registry is None:
        _registry = ExecutorRegistry()
    return _registry
