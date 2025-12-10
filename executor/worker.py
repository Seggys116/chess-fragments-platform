from celery import Celery
from celery.signals import celeryd_after_setup, worker_shutdown
import os
import threading

app = Celery('fragmentarena')
app.config_from_object('celeryconfig')
app.autodiscover_tasks(['tasks'], force=True)

# Import registry configuration
from executor_registry import get_registry, HEARTBEAT_INTERVAL

# Background heartbeat thread control
_heartbeat_thread = None
_heartbeat_stop = threading.Event()


def _heartbeat_loop(worker_id: str):
    """Background thread that sends periodic heartbeats."""
    registry = get_registry()
    while not _heartbeat_stop.is_set():
        try:
            registry.send_heartbeat(worker_id)
        except Exception as e:
            print(f"[WORKER] Heartbeat failed: {e}")
        _heartbeat_stop.wait(HEARTBEAT_INTERVAL)


@celeryd_after_setup.connect
def register_executor(sender, instance, **kwargs):
    """Register executor when worker starts."""
    global _heartbeat_thread

    worker_id = sender  # Worker name like 'celery@hostname'

    # Get concurrency from instance if available
    concurrency = 8
    if hasattr(instance, 'concurrency'):
        concurrency = instance.concurrency

    registry = get_registry()
    registry.register_executor(worker_id, concurrency)

    # Start heartbeat thread
    _heartbeat_stop.clear()
    _heartbeat_thread = threading.Thread(
        target=_heartbeat_loop,
        args=(worker_id,),
        daemon=True
    )
    _heartbeat_thread.start()

    print(f"[WORKER] Executor {worker_id} registered and heartbeat started")


@worker_shutdown.connect
def deregister_executor(sender, **kwargs):
    """Deregister executor when worker shuts down."""
    global _heartbeat_thread

    # Stop heartbeat thread
    _heartbeat_stop.set()
    if _heartbeat_thread:
        _heartbeat_thread.join(timeout=5)

    registry = get_registry()
    registry.deregister_executor()

    print(f"[WORKER] Executor deregistered")


if __name__ == '__main__':
    app.start()
