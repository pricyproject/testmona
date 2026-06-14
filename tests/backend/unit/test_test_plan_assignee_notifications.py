"""Unit coverage for test-plan assignment notifications.

Exercises ``notify_test_plan_assignee`` directly: a new assignee is notified via
the ASSIGNMENT category, while the unchanged / self-assignment / unassigned guards
each produce nothing — matching the requirement and defect twins.
"""

import pytest

from app import models
from app.routes.requirements_defects_plans import notify_test_plan_assignee
from app.services import notification_engine as ne


@pytest.fixture()
def plan_db(mem_db):
    """A project with users alice(1)/bob(2)/carol(3, deactivated) and one plan."""
    db = mem_db
    db.add(models.User(id=1, username="alice", email="a@x.com", hashed_password="x", full_name="Alice", is_active=True))
    db.add(models.User(id=2, username="bob", email="b@x.com", hashed_password="x", full_name="Bob", is_active=True))
    db.add(models.User(id=3, username="carol", email="c@x.com", hashed_password="x", full_name="Carol", is_active=False))
    db.add(models.Project(id=1, name="P1", owner_id=1))
    db.add(models.TestPlan(id=1, title="Regression plan", project_id=1, created_by=1))
    db.commit()
    return db


def _plan(db):
    return db.get(models.TestPlan, 1)


def _rows(db, **filters):
    q = db.query(models.Notification)
    for k, v in filters.items():
        q = q.filter(getattr(models.Notification, k) == v)
    return q.all()


def test_new_assignment_notifies_assignee(plan_db):
    plan = _plan(plan_db)
    plan.assigned_to = 2
    plan_db.commit()
    actor = plan_db.get(models.User, 1)

    notify_test_plan_assignee(plan_db, plan, actor, previous_assigned_to=None)

    rows = _rows(plan_db, user_id=2)
    assert len(rows) == 1
    assert rows[0].category == "assignment"
    assert rows[0].related_entity_type == "test_plan"
    assert rows[0].related_entity_id == 1


def test_unchanged_assignee_is_noop(plan_db):
    plan = _plan(plan_db)
    plan.assigned_to = 2
    plan_db.commit()
    actor = plan_db.get(models.User, 1)

    # Same assignee as before → editing other fields must not re-notify.
    notify_test_plan_assignee(plan_db, plan, actor, previous_assigned_to=2)

    assert _rows(plan_db) == []


def test_self_assignment_is_noop(plan_db):
    plan = _plan(plan_db)
    plan.assigned_to = 1
    plan_db.commit()
    actor = plan_db.get(models.User, 1)

    notify_test_plan_assignee(plan_db, plan, actor, previous_assigned_to=None)

    assert _rows(plan_db) == []


def test_unassigned_is_noop(plan_db):
    plan = _plan(plan_db)  # assigned_to stays None
    actor = plan_db.get(models.User, 1)

    notify_test_plan_assignee(plan_db, plan, actor, previous_assigned_to=2)

    assert _rows(plan_db) == []


def test_batch_defers_emit_until_flush(plan_db):
    plan = _plan(plan_db)
    plan.assigned_to = 2
    plan_db.commit()
    actor = plan_db.get(models.User, 1)
    batch = ne.NotificationBatch()

    notify_test_plan_assignee(plan_db, plan, actor, previous_assigned_to=None, batch=batch)
    # Nothing emitted until the caller flushes the batch.
    assert _rows(plan_db) == []

    batch.flush(plan_db)
    assert {r.user_id for r in _rows(plan_db)} == {2}
