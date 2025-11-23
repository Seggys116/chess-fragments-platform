"""Shared constants for agent execution."""

DEFAULT_AGENT_VAR = [0, 14]  # [ply_number, time_limit_seconds]


def get_default_agent_var():
    """Return a fresh copy of the default agent var payload."""
    return DEFAULT_AGENT_VAR.copy()
