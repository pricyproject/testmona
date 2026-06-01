from datetime import datetime, timezone, timedelta
from typing import Any, Mapping, Optional


COMPLETED_RESULT_STATUSES = {
    "pass",
    "passed",
    "fail",
    "failed",
    "block",
    "blocked",
    "skip",
    "skipped",
}

# Execution states for pause/resume functionality
EXECUTION_STATES = {
    "idle",
    "running", 
    "paused",
    "completed"
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_status(value: Optional[str]) -> str:
    return str(value or "").strip().lower().replace("-", "_")


def _safe_seconds(value: Any) -> float:
    """Coerce a paused/adjustment value to a float.

    The relevant columns default to ``0.0`` but can be ``None`` on a freshly
    constructed (not-yet-flushed) result or when an update payload sends the
    field explicitly as ``null``. Treat any non-numeric/None value as ``0`` so
    the timing arithmetic never raises ``TypeError``.
    """
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _is_completed_result_status(value: Optional[str]) -> bool:
    return _normalize_status(value) in COMPLETED_RESULT_STATUSES


def apply_test_result_execution_timing(test_result: Any, incoming_data: Mapping[str, Any]) -> None:
    """Keep execution start and elapsed seconds consistent for result status changes."""
    status = incoming_data.get("status", getattr(test_result, "status", None))
    
    # Handle pause/resume state changes
    execution_state = incoming_data.get("execution_state")
    if execution_state:
        setattr(test_result, "execution_state", execution_state)
        
        # Handle pause timing
        if execution_state == "paused":
            setattr(test_result, "paused_at", _utc_now())
            # Update execution_time to current elapsed time when pausing
            started_at = getattr(test_result, "execution_started_at", None)
            if started_at:
                now = _utc_now()
                elapsed_seconds = max(0.0, (now - _as_aware_utc(started_at)).total_seconds())
                elapsed_seconds -= _safe_seconds(getattr(test_result, "total_paused_time", 0))
                elapsed_seconds += _safe_seconds(getattr(test_result, "manual_time_adjustment", 0))
                setattr(test_result, "execution_time", round(max(0.0, elapsed_seconds), 2))
        elif execution_state == "running":
            # Resume from pause
            paused_at = getattr(test_result, "paused_at", None)
            total_paused_time = _safe_seconds(getattr(test_result, "total_paused_time", 0))

            if paused_at:
                pause_duration = (_utc_now() - _as_aware_utc(paused_at)).total_seconds()
                total_paused_time += pause_duration
                setattr(test_result, "total_paused_time", total_paused_time)
                setattr(test_result, "paused_at", None)
                # Update execution_time to current elapsed time when resuming
                started_at = getattr(test_result, "execution_started_at", None)
                if started_at:
                    now = _utc_now()
                    elapsed_seconds = max(0.0, (now - _as_aware_utc(started_at)).total_seconds())
                    elapsed_seconds -= total_paused_time
                    elapsed_seconds += _safe_seconds(getattr(test_result, "manual_time_adjustment", 0))
                    setattr(test_result, "execution_time", round(max(0.0, elapsed_seconds), 2))
    
        
    # Only apply timing logic for completed statuses and not during pause/resume state changes
    # Skip timing calculation if only execution_state is changing (pause/resume operations)
    if not _is_completed_result_status(status):
        return

    # Additional check: skip timing calculation if this is a pause/resume operation
    # even for completed statuses, to preserve manual time additions
    keys_incoming = set(incoming_data.keys())
    if keys_incoming == {"execution_state"} or (
        len(keys_incoming) == 1 and "execution_state" in keys_incoming
    ):
        # Only execution_state is changing (pause/resume) - don't recalculate timing
        return

    now = _utc_now()
    explicit_execution_time = incoming_data.get("execution_time")
    manual_time_adjustment = _safe_seconds(incoming_data.get("manual_time_adjustment", 0))
    total_paused_time = _safe_seconds(getattr(test_result, "total_paused_time", 0))

    # ``status`` being present in the payload means the caller is *recording*
    # the result right now (creating it, or completing/re-running a test). That
    # is the only moment ``executed_at`` should advance. Updates that merely
    # carry an existing completed status through (e.g. editing a comment, or a
    # bare add-time adjustment) must leave timing and ``executed_at`` alone so
    # the trend chart and analytics keep reflecting when tests were actually run.
    status_being_recorded = "status" in incoming_data

    if explicit_execution_time is not None:
        # An authoritative duration was supplied (a timed completion from the UI,
        # or a manual add-time adjustment). Trust it; never recompute from the
        # clock. Ensure it's not negative.
        safe_execution_time = max(0.0, float(explicit_execution_time))
        setattr(test_result, "execution_time", round(safe_execution_time, 2))
        # Back-fill a start time for first-time completions so the "execution
        # started" timestamp stays consistent with the recorded duration.
        if status_being_recorded and getattr(test_result, "execution_started_at", None) is None and safe_execution_time > 0:
            setattr(test_result, "execution_started_at", now - timedelta(seconds=safe_execution_time))
    elif status_being_recorded:
        started_at = getattr(test_result, "execution_started_at", None)
        if started_at is None:
            if manual_time_adjustment > 0:
                # Manual time but no start time: don't fabricate an elapsed time,
                # just seed execution_time from the adjustment if it has none yet.
                current_execution_time = getattr(test_result, "execution_time", 0)
                if not current_execution_time:
                    setattr(test_result, "execution_time", round(manual_time_adjustment, 2))
            else:
                started_at = now
                setattr(test_result, "execution_started_at", started_at)
        if started_at is not None:
            # Calculate elapsed time excluding paused periods
            elapsed_seconds = max(0.0, (now - _as_aware_utc(started_at)).total_seconds())
            elapsed_seconds -= total_paused_time  # Subtract paused time
            elapsed_seconds += manual_time_adjustment  # Add any manual adjustments
            setattr(test_result, "execution_time", round(max(0.0, elapsed_seconds), 2))
    else:
        # Neither an explicit duration nor a status change — nothing to time.
        return

    # Stamp ``executed_at`` only when the status is actually being recorded now.
    # A bare add-time adjustment carries no ``status`` and must not move it.
    if status_being_recorded or getattr(test_result, "executed_at", None) is None:
        setattr(test_result, "executed_at", now)
