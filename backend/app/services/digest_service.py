"""Weekly notification digest (Phase 9).

A scheduled summary email of everything a user has *not yet read*, built directly
from the authoritative :class:`~app.models.Notification` rows — not from the Work
Inbox summary, which only counts actionable categories and would silently drop the
informational ones a digest is most useful for. One email per active user with at
least one unread row; users with an empty unread list are skipped entirely.

Best-effort, like every channel: a per-user failure is logged and the loop moves
on, so one bad address can't stop the rest of the run. There is no scheduler in
this app, so the run is triggered explicitly (an admin endpoint, or an external
cron hitting it); :func:`send_weekly_digests` is the single entry point.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Notification, User
from . import email_service, notification_links

logger = logging.getLogger(__name__)

# Cap how many rows we itemise per email so a long-neglected inbox doesn't produce
# a giant message; the count line still reflects the true total.
_MAX_ITEMS = 20


def build_user_digest(db: Session, user_id: int) -> Optional[dict]:
    """Return the digest payload for one user, or ``None`` if they have no unread.

    Shaped as ``{"unread_total", "items": [{"title","message","link"}, ...]}`` so
    it is trivially testable without sending anything.
    """
    rows = (
        db.query(Notification)
        .filter(
            Notification.user_id == user_id,
            Notification.is_read == False,  # noqa: E712
            Notification.archived == False,  # noqa: E712
        )
        .order_by(Notification.created_at.desc())
        .all()
    )
    if not rows:
        return None
    items = [
        {
            "title": n.title or "",
            "message": n.message or "",
            "link": notification_links.absolute_link(n),
        }
        for n in rows[:_MAX_ITEMS]
    ]
    return {"unread_total": len(rows), "items": items}


def send_weekly_digests(db: Session) -> dict:
    """Send the weekly digest to every active user with unread notifications.

    Returns a small run summary (``{"considered", "sent", "skipped"}``). A no-op
    that reports ``sent=0`` when email is not configured, so it is always safe to
    call.
    """
    summary = {"considered": 0, "sent": 0, "skipped": 0}
    if not settings.email_configured:
        logger.info("Weekly digest skipped: email not configured")
        return summary

    inbox_url = notification_links.inbox_link()
    users = (
        db.query(User.id, User.email, User.full_name, User.username)
        .filter(User.is_active == True)  # noqa: E712
        .all()
    )
    for uid, email, full_name, username in users:
        summary["considered"] += 1
        if not email:
            summary["skipped"] += 1
            continue
        digest = build_user_digest(db, uid)
        if digest is None:
            summary["skipped"] += 1
            continue
        name = full_name or username or "there"
        heading = f"Hi {name} — you have {digest['unread_total']} unread notification(s)"
        html_body, text_body = email_service.render_digest_email(
            heading=heading, items=digest["items"], inbox_url=inbox_url
        )
        ok = email_service.send_email(
            to=email,
            subject="Your weekly notification digest",
            html_body=html_body,
            text_body=text_body,
        )
        summary["sent" if ok else "skipped"] += 1
    return summary
