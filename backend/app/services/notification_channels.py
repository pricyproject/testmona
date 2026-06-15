"""Delivery-channel dispatch for the notification engine (Phase 9).

After :func:`app.services.notification_engine.emit` durably persists the bell/inbox
rows, it hands them here to fan out to the *other* channels a user might want:

* **Realtime bell push (SSE).** Every persisted row pings the user's open bell
  connections so the badge updates without waiting for the next poll. Fires for
  *all* categories (the bell shows everything) and is instant + in-memory, so it
  runs inline.
* **Email.** Actionable categories (mention/assignment/review/feedback/comment
  reply) are emailed, each gated by the recipient's per-category ``email`` flag
  (:class:`NotificationPreference`, default on) — the "email flag" the channel
  abstraction dispatches on. Informational categories (watch_change/status/system)
  are intentionally left to the weekly digest so email never floods.
* **Slack.** When a workspace webhook is configured, one message per *event*
  (deduped across recipients) mirrors actionable notifications into a channel.

Two hard rules, identical to the engine's: **never block** the request and
**never break** the caller. Realtime is the only inline step; the network-bound
channels (email, Slack) run on a background daemon thread with their own database
session (mirroring ``webhook_service``), and every path swallows and logs its own
failures. ``emit`` only calls :func:`dispatch` once its transaction has committed,
so a delivery can never resurrect or roll back a half-written change.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import List, Optional

import requests
from sqlalchemy.orm import Session

from ..config import settings
from ..database import SessionLocal
from ..models import NotificationPreference, User
from . import email_service, notification_links, realtime_service

logger = logging.getLogger(__name__)

_SLACK_TIMEOUT_SECONDS = 8


@dataclass(frozen=True)
class _Delivery:
    """Detached snapshot of a persisted notification, safe to hand to a thread."""

    notification_id: int
    user_id: int
    title: str
    message: str
    link: str


def dispatch(db: Session, notifications: list, category) -> None:
    """Fan a freshly-committed batch of notifications out to the side channels.

    ``notifications`` are persisted :class:`~app.models.Notification` rows from a
    single :func:`emit` (they share a title/message/entity, differing only by
    recipient). ``category`` is the engine category. Best-effort throughout.
    """
    if not notifications:
        return
    try:
        # Realtime is instant and in-process — do it inline so the bell updates
        # the moment the request returns.
        if settings.realtime_sse_enabled:
            for n in notifications:
                realtime_service.publish(getattr(n, "user_id", None))

        # Email/Slack only matter for actionable categories and only when a
        # channel is actually configured; otherwise skip the thread entirely.
        if not category.actionable:
            return
        if not (settings.email_configured or settings.slack_webhook_url):
            return

        deliveries = [
            _Delivery(
                notification_id=n.id,
                user_id=n.user_id,
                title=n.title or "",
                message=n.message or "",
                link=notification_links.absolute_link(n),
            )
            for n in notifications
            if getattr(n, "id", None) is not None and getattr(n, "user_id", None) is not None
        ]
        if not deliveries:
            return

        thread = threading.Thread(
            target=_deliver_external,
            args=(deliveries, category.key),
            name="notif-channels",
            daemon=True,
        )
        thread.start()
    except Exception:
        logger.exception("Failed to dispatch notification channels (%s)", getattr(category, "key", "?"))


def _deliver_external(deliveries: List[_Delivery], category_key: str) -> None:
    """Background worker: email each opted-in recipient, then mirror to Slack."""
    db = SessionLocal()
    try:
        _dispatch_email(db, deliveries, category_key)
    except Exception:
        logger.exception("Email dispatch failed for %s", category_key)
    finally:
        db.close()
    try:
        _dispatch_slack(deliveries)
    except Exception:
        logger.exception("Slack dispatch failed for %s", category_key)


def _email_muted_user_ids(db: Session, user_ids: set[int], category_key: str) -> set[int]:
    """Recipients who turned the email channel off for this category."""
    if not user_ids:
        return set()
    return {
        uid
        for (uid,) in db.query(NotificationPreference.user_id)
        .filter(
            NotificationPreference.user_id.in_(user_ids),
            NotificationPreference.category == category_key,
            NotificationPreference.email == False,  # noqa: E712
        )
        .all()
    }


def _dispatch_email(db: Session, deliveries: List[_Delivery], category_key: str) -> None:
    if not settings.email_configured:
        return
    user_ids = {d.user_id for d in deliveries}
    emails = {
        uid: email
        for (uid, email) in db.query(User.id, User.email).filter(User.id.in_(user_ids)).all()
    }
    muted = _email_muted_user_ids(db, user_ids, category_key)
    for d in deliveries:
        if d.user_id in muted:
            continue
        to = emails.get(d.user_id)
        if not to:
            continue
        html_body, text_body = email_service.render_notification_email(
            title=d.title, message=d.message, link=d.link
        )
        email_service.send_email(
            to=to,
            subject=d.title or "New notification",
            html_body=html_body,
            text_body=text_body,
        )


def _dispatch_slack(deliveries: List[_Delivery]) -> None:
    """Post one message per event (deduped across recipients) to the workspace."""
    url = settings.slack_webhook_url
    if not url or not deliveries:
        return
    # All deliveries from one emit share the same event text; post it once.
    head = deliveries[0]
    text = f"*{head.title}*\n{head.message}" if head.message else f"*{head.title}*"
    try:
        requests.post(url, json={"text": text}, timeout=_SLACK_TIMEOUT_SECONDS)
    except Exception:
        logger.exception("Failed to post notification to Slack")
