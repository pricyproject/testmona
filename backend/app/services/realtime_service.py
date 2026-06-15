"""In-process realtime fan-out for the notification bell (Phase 9, SSE).

A tiny publish/subscribe registry: each open ``GET /notifications/stream`` adds a
per-connection :class:`queue.Queue` keyed by user id; :func:`publish` drops a
short event onto every queue that user has open. The SSE endpoint blocks on its
queue (in a threadpool worker) and yields events as they arrive, with a periodic
heartbeat to keep the connection alive and detect disconnects.

This is deliberately in-memory and single-process — matching the rest of the app,
which runs without a separate worker/broker (see ``webhook_service``). With
multiple replicas a client only receives pushes generated on the replica it is
connected to; the frontend still polls as a backstop, so realtime is a latency
optimisation, never a correctness requirement. Everything here is best-effort:
publishing never raises into the caller.
"""

from __future__ import annotations

import logging
import queue
import threading
from typing import Dict, List

logger = logging.getLogger(__name__)

# user_id -> list of live subscriber queues. Guarded by ``_lock``.
_subscribers: Dict[int, List["queue.Queue[str]"]] = {}
_lock = threading.Lock()

# Bounded so a stalled/disconnected client can never grow a queue without limit;
# once full we drop the oldest event (the client will reconcile via its poll).
_MAX_QUEUED = 50


def subscribe(user_id: int) -> "queue.Queue[str]":
    """Register and return a fresh queue for one SSE connection."""
    q: "queue.Queue[str]" = queue.Queue(maxsize=_MAX_QUEUED)
    with _lock:
        _subscribers.setdefault(user_id, []).append(q)
    return q


def unsubscribe(user_id: int, q: "queue.Queue[str]") -> None:
    """Remove a connection's queue when its SSE stream closes."""
    with _lock:
        queues = _subscribers.get(user_id)
        if not queues:
            return
        try:
            queues.remove(q)
        except ValueError:
            pass
        if not queues:
            _subscribers.pop(user_id, None)


def has_subscribers(user_id: int) -> bool:
    with _lock:
        return bool(_subscribers.get(user_id))


def publish(user_id: int, event: str = "notification") -> None:
    """Notify every open connection for ``user_id``. Never raises.

    The payload is intentionally contentless (just an event name): it tells the
    bell "something changed, refetch" rather than trying to be a second delivery
    copy of the notification. That keeps the realtime path trivial and avoids it
    ever disagreeing with the authoritative ``/notifications`` data.
    """
    try:
        with _lock:
            queues = list(_subscribers.get(user_id, ()))
        for q in queues:
            try:
                q.put_nowait(event)
            except queue.Full:
                # Drop the oldest event to make room — the client reconciles on
                # its next poll anyway.
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except queue.Empty:
                    pass
    except Exception:
        logger.exception("Failed to publish realtime event for user %s", user_id)
