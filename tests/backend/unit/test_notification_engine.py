"""Unit coverage for the central notification engine.

Focuses on the product rules the engine enforces for every feature: actor
exclusion, recipient dedupe, dropping deactivated accounts, and coalescing of
repetitive informational notifications to fight unread pile-up.
"""

import re
from pathlib import Path

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


# --- NotificationBatch / the de-duplication ladder --------------------------


def test_batch_keeps_highest_priority_category_per_user_and_entity(users_db):
    """assignee + watcher + reporter for one save → one row, the highest-priority."""
    batch = ne.NotificationBatch()
    # User 2 is the assignee...
    batch.add(
        category=ne.ASSIGNMENT,
        user_ids=[2],
        actor_id=1,
        title="Requirement assigned",
        message="assigned",
        related_entity_type="requirement",
        related_entity_id=42,
    )
    # ...and a watcher of the same requirement (note the watch alias entity type)...
    batch.add(
        category=ne.WATCH_CHANGE,
        user_ids=[2],
        actor_id=1,
        title="Requirement updated",
        message="watched change",
        related_entity_type="requirement_change",
        related_entity_id=42,
    )
    # ...and mentioned in the same save — the top of the ladder.
    batch.add(
        category=ne.MENTION,
        user_ids=[2],
        actor_id=1,
        title="You were mentioned",
        message="mention",
        related_entity_type="requirement",
        related_entity_id=42,
    )
    rows = batch.flush(users_db)

    assert _count(users_db, user_id=2, related_entity_id=42) == 1
    assert {r.category for r in rows} == {"mention"}
    survivor = users_db.query(models.Notification).filter_by(user_id=2, related_entity_id=42).one()
    assert survivor.category == "mention"
    assert survivor.message == "mention"


def test_batch_does_not_dedupe_across_distinct_entities(users_db):
    """The ladder is per-entity: colliding categories on different entities coexist."""
    batch = ne.NotificationBatch()
    batch.add(
        category=ne.ASSIGNMENT,
        user_ids=[2],
        actor_id=1,
        title="Assigned A",
        message="a",
        related_entity_type="requirement",
        related_entity_id=1,
    )
    batch.add(
        category=ne.MENTION,
        user_ids=[2],
        actor_id=1,
        title="Mention B",
        message="b",
        related_entity_type="requirement",
        related_entity_id=2,
    )
    batch.flush(users_db)
    assert _count(users_db, user_id=2) == 2


def test_batch_lower_priority_survives_for_users_the_winner_does_not_cover(users_db):
    """A higher-priority intent only suppresses the users it actually names."""
    batch = ne.NotificationBatch()
    # Watch broadcast to two watchers...
    batch.add(
        category=ne.WATCH_CHANGE,
        user_ids=[1, 2],
        actor_id=99,
        title="Updated",
        message="watch",
        related_entity_type="requirement_change",
        related_entity_id=7,
    )
    # ...but only user 2 is the assignee.
    batch.add(
        category=ne.ASSIGNMENT,
        user_ids=[2],
        actor_id=99,
        title="Assigned",
        message="assignment",
        related_entity_type="requirement",
        related_entity_id=7,
    )
    batch.flush(users_db)

    u1 = users_db.query(models.Notification).filter_by(user_id=1, related_entity_id=7).one()
    u2 = users_db.query(models.Notification).filter_by(user_id=2, related_entity_id=7).one()
    # User 1 (watcher only) keeps the watch broadcast; user 2 gets the assignment.
    assert u1.category == "watch_change"
    assert u2.category == "assignment"


def test_batch_applies_actor_exclusion_and_dedupe_via_emit(users_db):
    """The batch funnels through emit, so actor-exclusion still applies."""
    batch = ne.NotificationBatch()
    batch.add(
        category=ne.ASSIGNMENT,
        user_ids=[1, 2],
        actor_id=1,  # actor must never be notified, even via the batch
        title="Assigned",
        message="m",
        related_entity_type="defect",
        related_entity_id=3,
    )
    rows = batch.flush(users_db)
    assert {r.user_id for r in rows} == {2}
    assert _count(users_db, user_id=1) == 0


def test_batch_mention_beats_reply_without_handrolled_suppression(users_db):
    """The comment path's two intents collapse by the ladder: mention > reply."""
    batch = ne.NotificationBatch()
    batch.add(
        category=ne.MENTION,
        user_ids=[2],
        actor_id=1,
        title="Mentioned",
        message="mention",
        related_entity_type="requirement",
        related_entity_id=9,
    )
    batch.add(
        category=ne.COMMENT_REPLY,
        user_ids=[2],  # same user is also the parent-comment author
        actor_id=1,
        title="Reply",
        message="reply",
        related_entity_type="requirement",
        related_entity_id=9,
    )
    batch.flush(users_db)
    rows = users_db.query(models.Notification).filter_by(user_id=2, related_entity_id=9).all()
    assert len(rows) == 1
    assert rows[0].category == "mention"


def test_batch_forwards_commit_flag_to_emit(users_db, monkeypatch):
    """flush(commit=…) is forwarded to emit, so the version-save path can keep
    commit=False and persist notifications atomically with its own change."""
    seen = []

    def fake_emit(db, **kwargs):
        seen.append(kwargs.get("commit"))
        return []

    monkeypatch.setattr(ne, "emit", fake_emit)
    batch = ne.NotificationBatch()
    batch.add(
        category=ne.WATCH_CHANGE,
        user_ids=[2],
        actor_id=1,
        title="Updated",
        message="m",
        related_entity_type="requirement_change",
        related_entity_id=11,
    )
    batch.flush(users_db, commit=False)
    assert seen == [False]

    seen.clear()
    batch.flush(users_db)  # default commits
    assert seen == [True]


def test_empty_batch_flush_is_noop(users_db):
    assert ne.NotificationBatch().flush(users_db) == []


def test_priority_ladder_matches_notification_contract():
    assert ne.CATEGORY_PRIORITY == {
        ne.MENTION.key: 0,
        ne.COMMENT_REPLY.key: 1,
        ne.REVIEW.key: 2,
        ne.ASSIGNMENT.key: 3,
        ne.FEEDBACK.key: 4,
        ne.STATUS.key: 5,
        ne.WATCH_CHANGE.key: 6,
    }


def test_every_registered_category_has_an_emitter():
    """Guard the category registry from drifting beyond implemented producers."""
    category_constant_names = {
        ne.MENTION.key: "MENTION",
        ne.COMMENT_REPLY.key: "COMMENT_REPLY",
        ne.ASSIGNMENT.key: "ASSIGNMENT",
        ne.REVIEW.key: "REVIEW",
        ne.FEEDBACK.key: "FEEDBACK",
        ne.WATCH_CHANGE.key: "WATCH_CHANGE",
        ne.STATUS.key: "STATUS",
        ne.SYSTEM.key: "SYSTEM",
    }
    assert set(category_constant_names) == {
        category.key for category in ne.all_categories()
    }

    app_dir = Path(__file__).resolve().parents[3] / "backend" / "app"
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in app_dir.rglob("*.py")
        if path.name != "notification_engine.py"
    )

    missing_emitters = [
        category_key
        for category_key, constant_name in category_constant_names.items()
        if not re.search(rf"category\s*=\s*notification_engine\.{constant_name}\b", source)
    ]
    assert missing_emitters == []
