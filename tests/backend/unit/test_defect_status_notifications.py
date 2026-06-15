"""Unit coverage for defect status-change notifications (Phase 4).

Exercises ``notify_defect_status_change`` directly: a real status transition emits
the STATUS category to the reporter and assignee (SUCCESS styling when the defect is
resolved), while the unchanged guard produces nothing. Also covers the ladder
interaction with ``notify_defect_assignee`` when one save both reassigns and changes
status — the new assignee's ASSIGNMENT outranks STATUS, the reporter still gets STATUS.
"""

import pytest

from app import models
from app.routes.requirements_defects_plans import (
    notify_defect_assignee,
    notify_defect_status_change,
)
from app.services import notification_engine as ne


@pytest.fixture()
def defect_db(mem_db):
    """A project with alice(1)/bob(2)/carol(3, deactivated)/dave(4) and one defect.

    The defect is reported by alice(1), assigned to bob(2), status OPEN.
    """
    db = mem_db
    db.add(models.User(id=1, username="alice", email="a@x.com", hashed_password="x", full_name="Alice", is_active=True))
    db.add(models.User(id=2, username="bob", email="b@x.com", hashed_password="x", full_name="Bob", is_active=True))
    db.add(models.User(id=3, username="carol", email="c@x.com", hashed_password="x", full_name="Carol", is_active=False))
    db.add(models.User(id=4, username="dave", email="d@x.com", hashed_password="x", full_name="Dave", is_active=True))
    db.add(models.Project(id=1, name="P1", owner_id=1))
    db.add(models.Defect(
        id=1, defect_id="DEF-1", title="Boom", project_id=1,
        reported_by=1, assigned_to=2, status=models.DefectStatus.OPEN,
    ))
    db.commit()
    return db


def _defect(db):
    return db.get(models.Defect, 1)


def _rows(db, **filters):
    q = db.query(models.Notification)
    for k, v in filters.items():
        q = q.filter(getattr(models.Notification, k) == v)
    return q.all()


def test_status_change_notifies_reporter_and_assignee(defect_db):
    defect = _defect(defect_db)
    defect.status = models.DefectStatus.IN_PROGRESS
    defect_db.commit()
    actor = defect_db.get(models.User, 4)  # third party, neither reporter nor assignee

    notify_defect_status_change(defect_db, defect, actor, previous_status=models.DefectStatus.OPEN)

    rows = _rows(defect_db, category="status")
    assert {r.user_id for r in rows} == {1, 2}
    for r in rows:
        assert r.related_entity_type == "defect"
        assert r.related_entity_id == 1
        assert r.type == models.NotificationType.INFO


def test_resolved_status_uses_success_type(defect_db):
    defect = _defect(defect_db)
    defect.status = models.DefectStatus.FIXED
    defect_db.commit()
    actor = defect_db.get(models.User, 4)

    notify_defect_status_change(defect_db, defect, actor, previous_status=models.DefectStatus.OPEN)

    rows = _rows(defect_db, category="status")
    assert {r.user_id for r in rows} == {1, 2}
    assert all(r.type == models.NotificationType.SUCCESS for r in rows)


def test_unchanged_status_is_noop(defect_db):
    defect = _defect(defect_db)  # status stays OPEN
    actor = defect_db.get(models.User, 4)

    notify_defect_status_change(defect_db, defect, actor, previous_status=models.DefectStatus.OPEN)

    assert _rows(defect_db) == []


def test_actor_is_excluded(defect_db):
    """When the reporter makes the change, only the assignee is notified."""
    defect = _defect(defect_db)
    defect.status = models.DefectStatus.IN_PROGRESS
    defect_db.commit()
    actor = defect_db.get(models.User, 1)  # alice == reporter

    notify_defect_status_change(defect_db, defect, actor, previous_status=models.DefectStatus.OPEN)

    rows = _rows(defect_db, category="status")
    assert {r.user_id for r in rows} == {2}


def test_deactivated_recipient_dropped(defect_db):
    defect = _defect(defect_db)
    defect.assigned_to = 3  # carol is deactivated
    defect.status = models.DefectStatus.IN_PROGRESS
    defect_db.commit()
    actor = defect_db.get(models.User, 4)

    notify_defect_status_change(defect_db, defect, actor, previous_status=models.DefectStatus.OPEN)

    # Only the active reporter survives; the deactivated assignee is dropped.
    assert {r.user_id for r in _rows(defect_db, category="status")} == {1}


def test_reassign_plus_status_dedupes_via_ladder(defect_db):
    """One save that both reassigns and changes status: the new assignee gets a
    single ASSIGNMENT row (outranks STATUS), the reporter still gets STATUS."""
    defect = _defect(defect_db)
    prior_assigned_to = defect.assigned_to  # bob(2)
    prior_status = defect.status            # OPEN
    defect.assigned_to = 4  # hand to dave
    defect.status = models.DefectStatus.IN_PROGRESS
    defect_db.commit()
    actor = defect_db.get(models.User, 2)  # bob makes the change

    batch = ne.NotificationBatch()
    notify_defect_assignee(defect_db, defect, actor, previous_assigned_to=prior_assigned_to, batch=batch)
    notify_defect_status_change(defect_db, defect, actor, previous_status=prior_status, batch=batch)
    batch.flush(defect_db)

    # New assignee dave(4): ASSIGNMENT wins over STATUS — exactly one row.
    dave_rows = _rows(defect_db, user_id=4)
    assert len(dave_rows) == 1
    assert dave_rows[0].category == "assignment"

    # Reporter alice(1): STATUS row.
    alice_rows = _rows(defect_db, user_id=1)
    assert len(alice_rows) == 1
    assert alice_rows[0].category == "status"

    # Actor bob(2) is never notified of his own change.
    assert _rows(defect_db, user_id=2) == []
