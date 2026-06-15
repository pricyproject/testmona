"""Unit coverage for milestone owner-assignment notifications.

Exercises ``notify_milestone_owner_assigned`` directly: a new owner is notified via
the ASSIGNMENT category, while the unchanged / self-assignment / unowned /
deactivated-owner guards each produce nothing — matching the test-plan, requirement
and defect assignment twins. This is the owner-*change* event, distinct from the
run-completion STATUS notice.
"""

import pytest

from app import models
from app.routes.requirements_defects_plans import notify_milestone_owner_assigned
from app.services import notification_engine as ne


@pytest.fixture()
def ms_db(mem_db):
    """A project with users alice(1)/bob(2)/carol(3, deactivated) and one milestone."""
    db = mem_db
    db.add(models.User(id=1, username="alice", email="a@x.com", hashed_password="x", full_name="Alice", is_active=True))
    db.add(models.User(id=2, username="bob", email="b@x.com", hashed_password="x", full_name="Bob", is_active=True))
    db.add(models.User(id=3, username="carol", email="c@x.com", hashed_password="x", full_name="Carol", is_active=False))
    db.add(models.Project(id=1, name="P1", owner_id=1))
    db.add(models.Milestone(id=1, title="v2.4 sign-off", project_id=1, created_by=1))
    db.commit()
    return db


def _milestone(db):
    return db.get(models.Milestone, 1)


def _rows(db, **filters):
    q = db.query(models.Notification)
    for k, v in filters.items():
        q = q.filter(getattr(models.Notification, k) == v)
    return q.all()


def test_new_owner_is_notified(ms_db):
    milestone = _milestone(ms_db)
    milestone.owner_id = 2
    ms_db.commit()
    actor = ms_db.get(models.User, 1)

    notify_milestone_owner_assigned(ms_db, milestone, actor, previous_owner_id=None)

    rows = _rows(ms_db, user_id=2)
    assert len(rows) == 1
    assert rows[0].category == "assignment"
    assert rows[0].related_entity_type == "milestone"
    assert rows[0].related_entity_id == 1


def test_unchanged_owner_is_noop(ms_db):
    milestone = _milestone(ms_db)
    milestone.owner_id = 2
    ms_db.commit()
    actor = ms_db.get(models.User, 1)

    # Same owner as before → editing other fields must not re-notify.
    notify_milestone_owner_assigned(ms_db, milestone, actor, previous_owner_id=2)

    assert _rows(ms_db) == []


def test_self_assignment_is_noop(ms_db):
    milestone = _milestone(ms_db)
    milestone.owner_id = 1
    ms_db.commit()
    actor = ms_db.get(models.User, 1)

    notify_milestone_owner_assigned(ms_db, milestone, actor, previous_owner_id=None)

    assert _rows(ms_db) == []


def test_unowned_is_noop(ms_db):
    milestone = _milestone(ms_db)  # owner_id stays None
    actor = ms_db.get(models.User, 1)

    notify_milestone_owner_assigned(ms_db, milestone, actor, previous_owner_id=2)

    assert _rows(ms_db) == []


def test_deactivated_owner_is_noop(ms_db):
    milestone = _milestone(ms_db)
    milestone.owner_id = 3  # carol is deactivated
    ms_db.commit()
    actor = ms_db.get(models.User, 1)

    notify_milestone_owner_assigned(ms_db, milestone, actor, previous_owner_id=None)

    assert _rows(ms_db) == []


def test_batch_defers_emit_until_flush(ms_db):
    milestone = _milestone(ms_db)
    milestone.owner_id = 2
    ms_db.commit()
    actor = ms_db.get(models.User, 1)
    batch = ne.NotificationBatch()

    notify_milestone_owner_assigned(ms_db, milestone, actor, previous_owner_id=None, batch=batch)
    # Nothing emitted until the caller flushes the batch.
    assert _rows(ms_db) == []

    batch.flush(ms_db)
    assert {r.user_id for r in _rows(ms_db)} == {2}
