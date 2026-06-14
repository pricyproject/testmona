"""Unit coverage for defect-comment notifications (mentions + replies).

Exercises ``_notify_defect_comment`` directly against an in-memory DB: a defect
comment that @mentions a project member notifies them, a reply notifies the
parent author, and a user who is *both* mentioned and the reply target gets a
single row — the higher-priority mention — via the notification ladder, with no
hand-rolled suppression.
"""

import pytest

from app import models
from app.api.defect_management import _notify_defect_comment


@pytest.fixture()
def defect_db(mem_db):
    """A project (owner=1) with members alice(1)/bob(2)/carol(3) and one defect."""
    db = mem_db
    db.add(models.User(id=1, username="alice", email="a@x.com", hashed_password="x", full_name="Alice", is_active=True))
    db.add(models.User(id=2, username="bob", email="b@x.com", hashed_password="x", full_name="Bob", is_active=True))
    db.add(models.User(id=3, username="carol", email="c@x.com", hashed_password="x", full_name="Carol", is_active=True))
    db.add(models.Project(id=1, name="P1", owner_id=1))
    # Membership drives @mention resolution (owner + assignments).
    db.add(models.ProjectAssignment(user_id=2, project_id=1, role="member"))
    db.add(models.ProjectAssignment(user_id=3, project_id=1, role="member"))
    db.add(models.Defect(
        id=1, title="Login broken", defect_id="DEF-1", project_id=1,
        status=models.DefectStatus.OPEN, reported_by=1,
    ))
    db.commit()
    return db


def _comment(db, *, body, user_id, parent_id=None):
    c = models.DefectComment(defect_id=1, user_id=user_id, comment=body, parent_id=parent_id)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _rows(db, **filters):
    q = db.query(models.Notification)
    for k, v in filters.items():
        q = q.filter(getattr(models.Notification, k) == v)
    return q.all()


def test_mention_in_defect_comment_notifies_member(defect_db):
    actor = defect_db.get(models.User, 1)
    defect = defect_db.get(models.Defect, 1)
    comment = _comment(defect_db, body="hey @bob take a look", user_id=1)

    _notify_defect_comment(defect_db, defect, comment, actor, parent_author_id=None)

    rows = _rows(defect_db, user_id=2)
    assert len(rows) == 1
    assert rows[0].category == "mention"
    assert rows[0].related_entity_type == "defect"
    assert rows[0].related_entity_id == 1


def test_reply_notifies_parent_author(defect_db):
    actor = defect_db.get(models.User, 1)
    defect = defect_db.get(models.Defect, 1)
    parent = _comment(defect_db, body="original thought", user_id=2)
    reply = _comment(defect_db, body="good point", user_id=1, parent_id=parent.id)

    _notify_defect_comment(defect_db, defect, reply, actor, parent_author_id=parent.user_id)

    rows = _rows(defect_db, user_id=2)
    assert len(rows) == 1
    assert rows[0].category == "comment_reply"


def test_mention_beats_reply_for_same_user(defect_db):
    """Parent author who is also @mentioned gets one row — the mention."""
    actor = defect_db.get(models.User, 1)
    defect = defect_db.get(models.Defect, 1)
    parent = _comment(defect_db, body="original", user_id=2)
    reply = _comment(defect_db, body="thanks @bob, fixed", user_id=1, parent_id=parent.id)

    _notify_defect_comment(defect_db, defect, reply, actor, parent_author_id=parent.user_id)

    rows = _rows(defect_db, user_id=2)
    assert len(rows) == 1
    assert rows[0].category == "mention"


def test_actor_self_reply_and_self_mention_produce_nothing(defect_db):
    actor = defect_db.get(models.User, 1)
    defect = defect_db.get(models.Defect, 1)
    # Actor replies to their own comment and @mentions themselves.
    parent = _comment(defect_db, body="mine", user_id=1)
    reply = _comment(defect_db, body="@alice following up", user_id=1, parent_id=parent.id)

    _notify_defect_comment(defect_db, defect, reply, actor, parent_author_id=parent.user_id)

    assert _rows(defect_db) == []
