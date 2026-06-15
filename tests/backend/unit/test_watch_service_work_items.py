"""Unit coverage for watching defects / test cases / test plans (Phase 5).

The watch table is generic, so this focuses on the new entity types: auto-watch
seeding, the watch primitives accepting the new kinds, and the change broadcast for
unversioned work items (no version number, ``*_change`` related type, actor excluded).
"""

import pytest

from app import models
from app.services import watch_service as ws
from app.services import notification_engine as ne


@pytest.fixture()
def watch_db(mem_db):
    db = mem_db
    db.add(models.User(id=1, username="alice", email="a@x.com", hashed_password="x", full_name="Alice", is_active=True))
    db.add(models.User(id=2, username="bob", email="b@x.com", hashed_password="x", full_name="Bob", is_active=True))
    db.add(models.User(id=3, username="carol", email="c@x.com", hashed_password="x", full_name="Carol", is_active=True))
    db.commit()
    return db


def _notifs(db, **filters):
    q = db.query(models.Notification)
    for k, v in filters.items():
        q = q.filter(getattr(models.Notification, k) == v)
    return q.all()


def test_new_entity_types_are_valid():
    for et in (ws.DEFECT, ws.TEST_CASE, ws.TEST_PLAN):
        assert et in ws._VALID_ENTITY_TYPES
        assert et in ws._CHANGE_NOTIFICATION_TYPE


def test_invalid_entity_type_rejected(watch_db):
    with pytest.raises(ValueError):
        ws.is_watching(watch_db, 1, "milestone", 5)


def test_auto_watch_seeds_and_dedupes(watch_db):
    # Reporter(1) + assignee(2), with a None and a duplicate that must be ignored.
    ws.auto_watch(watch_db, entity_type=ws.DEFECT, entity_id=7, user_ids=[1, 2, None, 1])
    assert ws.is_watching(watch_db, 1, ws.DEFECT, 7)
    assert ws.is_watching(watch_db, 2, ws.DEFECT, 7)
    assert ws.count_watchers(watch_db, ws.DEFECT, 7) == 2

    # Idempotent: re-running adds nothing.
    ws.auto_watch(watch_db, entity_type=ws.DEFECT, entity_id=7, user_ids=[1, 2])
    assert ws.count_watchers(watch_db, ws.DEFECT, 7) == 2


def test_change_broadcast_for_unversioned_item(watch_db):
    # alice(1) and bob(2) watch defect 7; carol(3) makes the change.
    ws.add_watch(watch_db, 1, ws.DEFECT, 7)
    ws.add_watch(watch_db, 2, ws.DEFECT, 7)

    batch = ne.NotificationBatch()
    ws.notify_watchers_of_change(
        watch_db,
        entity_type=ws.DEFECT,
        entity_id=7,
        label="DEF-7",
        action="updated",
        actor_id=3,
        changed_fields=["status", "priority"],
        batch=batch,
    )
    batch.flush(watch_db)

    rows = _notifs(watch_db, category="watch_change")
    assert {r.user_id for r in rows} == {1, 2}  # actor(3) excluded
    for r in rows:
        assert r.related_entity_type == "defect_change"
        assert r.related_entity_id == 7
        # Unversioned message: no "(vN)" and no version-history tail.
        assert "(v" not in r.message
        assert "version history" not in r.message
        assert "Changed: status, priority." in r.message


def test_actor_only_watcher_yields_nothing(watch_db):
    ws.add_watch(watch_db, 3, ws.TEST_PLAN, 9)  # only the actor watches
    ws.notify_watchers_of_change(
        watch_db, entity_type=ws.TEST_PLAN, entity_id=9, label="Plan",
        action="updated", actor_id=3, changed_fields=["status"],
    )
    assert _notifs(watch_db) == []
