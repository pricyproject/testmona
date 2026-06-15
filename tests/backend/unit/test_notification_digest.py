"""Unit coverage for the weekly notification digest (Phase 9).

The digest is built directly from unread :class:`Notification` rows (not the inbox
summary), one email per active user who has any, and is a no-op when email is not
configured. SMTP is monkeypatched so nothing is actually sent.
"""

import pytest

from app import models
from app.config import settings
from app.services import digest_service, email_service


@pytest.fixture()
def digest_db(mem_db):
    db = mem_db
    db.add(models.User(id=1, username="alice", email="alice@x.com", hashed_password="x", full_name="Alice", is_active=True))
    db.add(models.User(id=2, username="bob", email="bob@x.com", hashed_password="x", full_name="Bob", is_active=True))
    db.add(models.User(id=3, username="ghost", email="", hashed_password="x", full_name="Ghost", is_active=True))
    db.add(models.User(id=4, username="gone", email="gone@x.com", hashed_password="x", full_name="Gone", is_active=False))
    db.commit()
    return db


def _add(db, user_id, *, is_read=False, archived=False, title="t", message="m"):
    db.add(models.Notification(
        user_id=user_id, title=title, message=message, category="assignment",
        is_read=is_read, archived=archived, related_entity_type="defect", related_entity_id=1,
    ))
    db.commit()


def test_build_user_digest_only_unread(digest_db):
    _add(digest_db, 1, is_read=False, title="unread-1")
    _add(digest_db, 1, is_read=True, title="already-read")
    _add(digest_db, 1, archived=True, title="archived")

    digest = digest_service.build_user_digest(digest_db, 1)
    assert digest is not None
    assert digest["unread_total"] == 1
    assert digest["items"][0]["title"] == "unread-1"
    assert "/n/" in digest["items"][0]["link"]


def test_build_user_digest_none_when_all_read(digest_db):
    _add(digest_db, 2, is_read=True)
    assert digest_service.build_user_digest(digest_db, 2) is None


def test_send_weekly_digests_noop_without_email(digest_db, monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", None)
    _add(digest_db, 1)
    summary = digest_service.send_weekly_digests(digest_db)
    assert summary["sent"] == 0


def test_send_weekly_digests_one_email_per_user_with_unread(digest_db, monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "email_notifications_enabled", True)
    monkeypatch.setattr(email_service, "send_email", lambda **kw: sent.append(kw) or True)

    _add(digest_db, 1, title="for-alice")   # alice has unread → emailed
    _add(digest_db, 2, is_read=True)        # bob all read → skipped
    _add(digest_db, 3)                      # ghost has unread but no email → skipped
    # user 4 is inactive and is never considered.

    summary = digest_service.send_weekly_digests(digest_db)

    assert {kw["to"] for kw in sent} == {"alice@x.com"}
    assert summary["sent"] == 1
    # alice + bob + ghost are active; the inactive user is excluded from the run.
    assert summary["considered"] == 3
