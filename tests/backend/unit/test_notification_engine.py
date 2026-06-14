"""Unit coverage for the central notification engine.

Focuses on the product rules the engine enforces for every feature: actor
exclusion, recipient dedupe, dropping deactivated accounts, and coalescing of
repetitive informational notifications to fight unread pile-up.
"""

import pytest

from app import models
from app.services import notification_engine as ne


@pytest.fixture()
def users_db(mem_db):
    """mem_db with three users; user 3 is deactivated."""
    db = mem_db
    db.add(models.User(id=1, username="alice", email="a@x.com", hashed_password="x", full_name="Alice", is_active=True))
    db.add(models.User(id=2, username="bob", email="b@x.com", hashed_password="x", full_name="Bob", is_active=True))
    db.add(models.User(id=3, username="carol", email="c@x.com", hashed_password="x", full_name="Carol", is_active=False))
    db.commit()
    return db


def _count(db, **filters):
    q = db.query(models.Notification)
    for k, v in filters.items():
        q = q.filter(getattr(models.Notification, k) == v)
    return q.count()


def test_actor_excluded_and_recipients_deduped(users_db):
    rows = ne.emit(
        users_db,
        category=ne.ASSIGNMENT,
        user_ids=[1, 2, 2, 1],
        actor_id=1,
        title="Assigned",
        message="You were assigned",
        related_entity_type="defect",
        related_entity_id=10,
    )
    # User 1 is the actor (excluded); user 2 deduped to a single row.
    assert {r.user_id for r in rows} == {2}
    assert _count(users_db, user_id=1) == 0
    assert _count(users_db, user_id=2) == 1


def test_deactivated_recipient_dropped(users_db):
    rows = ne.emit(
        users_db,
        category=ne.ASSIGNMENT,
        user_ids=[2, 3],
        actor_id=1,
        title="Assigned",
        message="msg",
        related_entity_type="defect",
        related_entity_id=10,
    )
    assert {r.user_id for r in rows} == {2}
    assert _count(users_db, user_id=3) == 0


def test_coalesce_folds_repeat_into_unread_row(users_db):
    first = ne.emit(
        users_db,
        category=ne.WATCH_CHANGE,
        user_ids=[2],
        actor_id=1,
        title="Doc was updated",
        message="v1",
        related_entity_type="doc_change",
        related_entity_id=5,
    )
    second = ne.emit(
        users_db,
        category=ne.WATCH_CHANGE,
        user_ids=[2],
        actor_id=1,
        title="Doc was updated",
        message="v2",
        related_entity_type="doc_change",
        related_entity_id=5,
    )
    # Still a single unread row for user 2, now carrying the latest text.
    assert _count(users_db, user_id=2, category="watch_change") == 1
    assert first[0].id == second[0].id
    refreshed = users_db.get(models.Notification, first[0].id)
    assert refreshed.message == "v2"


def test_coalesce_creates_fresh_row_after_read(users_db):
    first = ne.emit(
        users_db,
        category=ne.WATCH_CHANGE,
        user_ids=[2],
        actor_id=1,
        title="Doc was updated",
        message="v1",
        related_entity_type="doc_change",
        related_entity_id=5,
    )
    # User reads the notification, then a new change arrives.
    first[0].is_read = True
    users_db.commit()
    ne.emit(
        users_db,
        category=ne.WATCH_CHANGE,
        user_ids=[2],
        actor_id=1,
        title="Doc was updated",
        message="v2",
        related_entity_type="doc_change",
        related_entity_id=5,
    )
    # New activity after read is not swallowed: a second row exists.
    assert _count(users_db, user_id=2, category="watch_change") == 2


def test_actionable_category_does_not_coalesce(users_db):
    for note in ("first mention", "second mention"):
        ne.emit(
            users_db,
            category=ne.MENTION,
            user_ids=[2],
            actor_id=1,
            title="Mentioned",
            message=note,
            related_entity_type="doc",
            related_entity_id=5,
        )
    # Every mention is individually meaningful, so both survive.
    assert _count(users_db, user_id=2, category="mention") == 2
