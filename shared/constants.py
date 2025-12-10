"""Shared constants for agent execution."""
import random

# System timeout is 16s, but agents are told 14s
SYSTEM_TIMEOUT_SECONDS = 16
AGENT_TOLD_TIMEOUT = 14


def get_default_agent_var():
    """Return a fresh copy of the default agent var payload."""
    return [0, AGENT_TOLD_TIMEOUT]  # [ply_number, time_limit_seconds]


def cap_move_time(move_time_ms):
    """
    Cap move time if agent exceeded the told timeout (14s).
    If they took > 14s, report as ~13.9s with randomization.
    """
    told_timeout_ms = AGENT_TOLD_TIMEOUT * 1000  # 14000ms
    if move_time_ms > told_timeout_ms:
        # Cap to 13.9s + small random (13900-13990ms)
        return 13900 + random.randint(0, 90)
    return move_time_ms
