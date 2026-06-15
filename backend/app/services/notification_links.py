"""Server-side deep-link resolution for notification delivery channels.

The in-app bell resolves a notification's target route on the client
(``frontend/src/lib/notificationNavigation.ts``) because it can chase the extra
API lookups a deep-link sometimes needs (a defect's project id, a requirement's
per-project sequence). Email and Slack messages can't run that logic, so they
link to a single stable **landing route** — ``/n/{id}`` — that the frontend
resolves and redirects through the very same client-side logic. This keeps one
source of truth for "where does this notification go" and means new entity types
never need a second server-side mapping.

``absolute_link`` returns the full URL for a notification (or the inbox, when the
row names no concrete entity); ``inbox_link`` is the fallback used by the weekly
digest. Both are pure string builders — no DB access — so they are cheap and
safe to call from the best-effort dispatch path.
"""

from __future__ import annotations

from typing import Optional

from ..config import settings
from ..models import Notification


def _base() -> str:
    return settings.resolved_frontend_base_url()


def inbox_link() -> str:
    """Absolute URL of the Work Inbox — the safe fallback target."""
    return f"{_base()}/inbox"


def absolute_link(notification: Notification) -> str:
    """Absolute deep-link for a notification.

    Points at the ``/n/{id}`` landing route when the row has an id (the frontend
    resolves it to the entity and redirects), otherwise at the inbox. The landing
    route degrades gracefully to the inbox for rows with no navigable target, so
    an email link is never a dead end.
    """
    nid: Optional[int] = getattr(notification, "id", None)
    if nid is None:
        return inbox_link()
    return f"{_base()}/n/{nid}"
