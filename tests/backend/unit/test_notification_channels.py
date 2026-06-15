"""Unit coverage for Phase 9 delivery channels.

Exercises the channel layer's contracts without a real SMTP/Slack server: deep-link
building, the in-memory realtime pub/sub, the per-category email-flag gate, that
only actionable categories email, and that ``emit`` hands committed rows to
``dispatch`` on the post-commit path. Network sends are monkeypatched, so nothing
leaves the process.
"""

import queue

import pytest

from app import models
from app.config import settings
from app.services import (
    email_service,
    notification_channels as channels,
    notification_engine as ne,
    notification_links,
    realtime_service,
)


@pytest.fixture()
def chan_db(mem_db):
    db = mem_db
    db.add(models.User(id=1, username="alice", email="alice@x.com", hashed_password="x", full_name="Alice", is_active=True))
    db.add(models.User(id=2, username="bob", email="bob@x.com", hashed_password="x", full_name="Bob", is_active=True))
    db.add(models.User(id=3, username="noemail", email="", hashed_password="x", full_name="No Email", is_active=True))
    db.commit()
    return db


# --- deep links ------------------------------------------------------------- #

def test_absolute_link_points_at_landing_route(chan_db):
    n = models.Notification(id=42, user_id=1, title="t", message="m", related_entity_type="doc", related_entity_id=7)
    link = notification_links.absolute_link(n)
    assert link.endswith("/n/42")
    assert link.startswith("http")


def test_inbox_link_is_fallback():
    assert notification_links.inbox_link().endswith("/inbox")


# --- realtime --------------------------------------------------------------- #

def test_realtime_publish_reaches_subscriber():
    q = realtime_service.subscribe(99)
    try:
        realtime_service.publish(99)
        assert q.get_nowait() == "notification"
    finally:
        realtime_service.unsubscribe(99, q)
    assert not realtime_service.has_subscribers(99)


def test_realtime_publish_no_subscribers_is_noop():
    # Must never raise when nobody is listening.
    realtime_service.publish(123456)


def test_dispatch_publishes_realtime_for_all_categories(chan_db, monkeypatch):
    pushed = []
    monkeypatch.setattr(realtime_service, "publish", lambda uid, event="notification": pushed.append(uid))
    rows = ne.emit(
        chan_db, category=ne.WATCH_CHANGE, user_ids=[1, 2],
        title="t", message="m", related_entity_type="doc", related_entity_id=1,
    )
    assert rows
    # WATCH_CHANGE is informational, but realtime still fires for every recipient.
    assert set(pushed) == {1, 2}


# --- email gate ------------------------------------------------------------- #

def _make_rows(db, category, uids, *, title="t", message="m", entity_type="defect", entity_id=5):
    """Persist notification rows directly (bypassing emit's channel dispatch)."""
    rows = []
    for uid in uids:
        r = models.Notification(
            user_id=uid, title=title, message=message, category=category.key,
            related_entity_type=entity_type, related_entity_id=entity_id,
        )
        db.add(r)
        rows.append(r)
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


def _deliveries_for(rows):
    return [
        channels._Delivery(
            notification_id=r.id, user_id=r.user_id, title=r.title,
            message=r.message, link=notification_links.absolute_link(r),
        )
        for r in rows
    ]


def test_email_sent_for_opted_in_recipients(chan_db, monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "email_notifications_enabled", True)
    monkeypatch.setattr(email_service, "send_email", lambda **kw: sent.append(kw) or True)

    rows = _make_rows(chan_db, ne.ASSIGNMENT, [1, 2], title="Assigned", message="You were assigned")
    channels._dispatch_email(chan_db, _deliveries_for(rows), ne.ASSIGNMENT.key)

    recipients = {kw["to"] for kw in sent}
    assert recipients == {"alice@x.com", "bob@x.com"}
    assert all("/n/" in kw["text_body"] for kw in sent)


def test_email_respects_per_category_email_flag(chan_db, monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(email_service, "send_email", lambda **kw: sent.append(kw) or True)
    # Bob mutes the email channel for assignments (but keeps in-app).
    chan_db.add(models.NotificationPreference(user_id=2, category=ne.ASSIGNMENT.key, in_app=True, email=False))
    chan_db.commit()

    rows = _make_rows(chan_db, ne.ASSIGNMENT, [1, 2])
    channels._dispatch_email(chan_db, _deliveries_for(rows), ne.ASSIGNMENT.key)

    assert {kw["to"] for kw in sent} == {"alice@x.com"}


def test_email_skips_users_without_address(chan_db, monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(email_service, "send_email", lambda **kw: sent.append(kw) or True)
    rows = _make_rows(chan_db, ne.MENTION, [3], entity_type="doc", entity_id=1)
    channels._dispatch_email(chan_db, _deliveries_for(rows), ne.MENTION.key)
    assert sent == []


def test_email_noop_when_unconfigured(chan_db, monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "smtp_host", None)
    monkeypatch.setattr(email_service, "send_email", lambda **kw: sent.append(kw) or True)
    rows = _make_rows(chan_db, ne.ASSIGNMENT, [1])
    channels._dispatch_email(chan_db, _deliveries_for(rows), ne.ASSIGNMENT.key)
    assert sent == []


def test_informational_category_does_not_spawn_external(chan_db, monkeypatch):
    # dispatch() must not start the email/Slack thread for non-actionable rows.
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "slack_webhook_url", "https://hooks.slack.test/x")
    called = []
    monkeypatch.setattr(channels, "_deliver_external", lambda *a, **k: called.append(a))
    rows = ne.emit(
        chan_db, category=ne.STATUS, user_ids=[1],
        title="t", message="m", related_entity_type="defect", related_entity_id=5,
    )
    # Realtime still happened, but no external delivery for an informational row.
    assert rows and called == []


# --- slack ------------------------------------------------------------------ #

def test_slack_posts_once_per_event(chan_db, monkeypatch):
    posts = []
    monkeypatch.setattr(settings, "slack_webhook_url", "https://hooks.slack.test/x")
    monkeypatch.setattr(channels.requests, "post", lambda url, **kw: posts.append((url, kw)))
    rows = _make_rows(
        chan_db, ne.REVIEW, [1, 2],
        title="Review requested", message="please review", entity_type="doc", entity_id=9,
    )
    channels._dispatch_slack(_deliveries_for(rows))
    # Two recipients, one shared event → exactly one Slack post.
    assert len(posts) == 1
    assert "Review requested" in posts[0][1]["json"]["text"]
