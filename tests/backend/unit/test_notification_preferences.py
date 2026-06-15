"""Unit coverage for the per-user notification preference gate.

The engine consults :class:`NotificationPreference` after dropping deactivated
accounts: a user with an explicit ``in_app == False`` row for the emitted category
never receives it, while users with no row (the default) or an explicit ``True``
row are unaffected. The gate is per-category, so muting one category leaves others
untouched.
"""

import pytest

from app import models
from app.services import notification_engine as ne


@pytest.fixture()
def pref_db(mem_db):
    """Three active users (alice/bob/carol)."""
    db = mem_db
    db.add(models.User(id=1, username="alice", email="a@x.com", hashed_password="x", full_name="Alice", is_active=True))
    db.add(models.User(id=2, username="bob", email="b@x.com", hashed_password="x", full_name="Bob", is_active=True))
    db.add(models.User(id=3, username="carol", email="c@x.com", hashed_password="x", full_name="Carol", is_active=True))
    db.commit()
    return db


def _mute(db, user_id, category_key, *, in_app=False, email=True):
    db.add(
        models.NotificationPreference(
            user_id=user_id, category=category_key, in_app=in_app, email=email
        )
    )
    db.commit()


def _recipients(db, category):
    rows = ne.emit(
        db,
        category=category,
        user_ids=[1, 2, 3],
        title="t",
        message="m",
        related_entity_type="defect",
        related_entity_id=7,
    )
    return {r.user_id for r in rows}


def test_default_is_delivered_to_everyone(pref_db):
    # No preference rows at all → every active recipient is notified.
    assert _recipients(pref_db, ne.ASSIGNMENT) == {1, 2, 3}


def test_muted_user_is_dropped(pref_db):
    _mute(pref_db, 2, ne.ASSIGNMENT.key, in_app=False)
    assert _recipients(pref_db, ne.ASSIGNMENT) == {1, 3}


def test_explicit_enabled_row_still_delivers(pref_db):
    # An explicit in_app=True row is the same as no row: delivered.
    _mute(pref_db, 2, ne.ASSIGNMENT.key, in_app=True)
    assert _recipients(pref_db, ne.ASSIGNMENT) == {1, 2, 3}


def test_mute_is_per_category(pref_db):
    # Bob mutes status only; an assignment still reaches him.
    _mute(pref_db, 2, ne.STATUS.key, in_app=False)
    assert _recipients(pref_db, ne.ASSIGNMENT) == {1, 2, 3}
    assert _recipients(pref_db, ne.STATUS) == {1, 3}


def test_email_flag_does_not_gate_in_app(pref_db):
    # Muting email while leaving in_app on must not suppress the bell notification.
    _mute(pref_db, 2, ne.ASSIGNMENT.key, in_app=True, email=False)
    assert _recipients(pref_db, ne.ASSIGNMENT) == {1, 2, 3}
