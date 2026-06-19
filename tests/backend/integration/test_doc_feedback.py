"""End-to-end tests for the document reader-feedback flow.

Readers cast a quick helpful / not-helpful vote or file an actionable issue
(needs-clarity / outdated, comment required). Each reader holds a single feedback
row, so switching between a vote and an issue replaces it. Editors triage the
actionable items via the items list + resolve/reopen; the doc owner is notified of
non-helpful feedback.
"""

import os
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture()
def client():
    from app.database import Base, get_db
    from app.auth import get_current_active_user, get_current_user
    from app import models
    import app.main as main

    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    engine = create_engine(
        f"sqlite:///{path}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    db = TestingSession()
    owner = models.User(username="owner", email="o@b.c", hashed_password="x",
                        role="admin", is_active=True, full_name="Owner")
    db.add(owner)
    db.commit()
    db.refresh(owner)
    project = models.Project(name="Proj", description="d", owner_id=owner.id)
    db.add(project)
    db.commit()
    db.refresh(project)

    reader = models.User(username="reader", email="r@b.c", hashed_password="x", role="tester", is_active=True, full_name="Reader")
    reader2 = models.User(username="reader2", email="r2@b.c", hashed_password="x", role="tester", is_active=True, full_name="Reader Two")
    db.add_all([reader, reader2])
    db.commit()
    for u in (reader, reader2):
        db.refresh(u)
        db.add(models.ProjectAssignment(project_id=project.id, user_id=u.id, role=models.Role.TESTER))
    db.commit()

    space = models.DocSpace(name="KB", slug="kb", project_id=project.id, created_by=owner.id)
    db.add(space)
    db.commit()
    db.refresh(space)
    doc = models.Doc(title="API Guide", slug="api-guide", space_id=space.id,
                     project_id=project.id, created_by=owner.id, status=models.DocStatus.DRAFT)
    db.add(doc)
    db.commit()
    db.refresh(doc)

    ids = dict(owner=owner.id, reader=reader.id, reader2=reader2.id, doc=doc.id, project=project.id)
    db.close()

    def override_db():
        d = TestingSession()
        try:
            yield d
        finally:
            d.close()

    state = {"uid": ids["owner"]}

    def override_user():
        d = TestingSession()
        try:
            return d.query(models.User).filter(models.User.id == state["uid"]).first()
        finally:
            d.close()

    main.app.dependency_overrides[get_db] = override_db
    main.app.dependency_overrides[get_current_active_user] = override_user
    main.app.dependency_overrides[get_current_user] = override_user
    c = TestClient(main.app)
    c.ids = ids  # type: ignore[attr-defined]
    c.SessionLocal = TestingSession  # type: ignore[attr-defined]
    c.set_current_user = lambda user_id: state.__setitem__("uid", user_id)  # type: ignore[attr-defined]
    try:
        yield c
    finally:
        main.app.dependency_overrides.clear()
        engine.dispose()
        os.unlink(path)


def _notifs(client, user_id):
    from app import models
    db = client.SessionLocal()
    try:
        return db.query(models.Notification).filter(models.Notification.user_id == user_id).all()
    finally:
        db.close()


def test_helpful_vote_counts_and_no_notification(client):
    client.set_current_user(client.ids["reader"])
    resp = client.put(f"/docs/{client.ids['doc']}/feedback", json={"feedback_type": "helpful"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["helpful"] == 1
    assert body["my_feedback"]["feedback_type"] == "helpful"
    # Helpful votes never notify the owner.
    assert _notifs(client, client.ids["owner"]) == []


def test_switching_vote_to_issue_replaces_single_row(client):
    client.set_current_user(client.ids["reader"])
    client.put(f"/docs/{client.ids['doc']}/feedback", json={"feedback_type": "helpful"})
    resp = client.put(
        f"/docs/{client.ids['doc']}/feedback",
        json={"feedback_type": "clarification", "comment": "The auth section is unclear"},
    )
    assert resp.status_code == 200
    body = resp.json()
    # One row per reader: helpful is gone, clarification is current.
    assert body["helpful"] == 0
    assert body["clarification"] == 1
    assert body["my_feedback"]["feedback_type"] == "clarification"
    assert body["unresolved"] == 1
    # The owner is notified of the actionable feedback.
    rows = _notifs(client, client.ids["owner"])
    assert any(n.category == "feedback" for n in rows)


def test_clarification_requires_comment(client):
    client.set_current_user(client.ids["reader"])
    resp = client.put(f"/docs/{client.ids['doc']}/feedback", json={"feedback_type": "clarification"})
    assert resp.status_code == 422


def test_clear_my_feedback(client):
    client.set_current_user(client.ids["reader"])
    client.put(f"/docs/{client.ids['doc']}/feedback", json={"feedback_type": "not_helpful"})
    resp = client.delete(f"/docs/{client.ids['doc']}/feedback")
    assert resp.status_code == 200
    body = resp.json()
    assert body["not_helpful"] == 0
    assert body["my_feedback"] is None


def test_items_list_excludes_helpful_votes(client):
    # A helpful vote and an actionable issue from two readers...
    client.set_current_user(client.ids["reader"])
    client.put(f"/docs/{client.ids['doc']}/feedback", json={"feedback_type": "outdated", "comment": "Stale"})
    client.set_current_user(client.ids["reader2"])
    client.put(f"/docs/{client.ids['doc']}/feedback", json={"feedback_type": "helpful"})
    # ...the triage list surfaces only the actionable one (helpful never appears).
    client.set_current_user(client.ids["owner"])
    items = client.get(f"/docs/{client.ids['doc']}/feedback/items").json()
    assert len(items) == 1
    assert items[0]["feedback_type"] == "outdated"


def test_resolve_and_reopen(client):
    client.set_current_user(client.ids["reader"])
    client.put(f"/docs/{client.ids['doc']}/feedback", json={"feedback_type": "clarification", "comment": "huh"})
    client.set_current_user(client.ids["owner"])
    item = client.get(f"/docs/{client.ids['doc']}/feedback/items").json()[0]

    resolved = client.put(f"/docs/{client.ids['doc']}/feedback/{item['id']}", json={"resolved": True})
    assert resolved.status_code == 200
    assert resolved.json()["resolved"] is True
    # Resolved items drop out of the default (open-only) list.
    assert client.get(f"/docs/{client.ids['doc']}/feedback/items").json() == []
    assert len(client.get(f"/docs/{client.ids['doc']}/feedback/items?include_resolved=true").json()) == 1

    reopened = client.put(f"/docs/{client.ids['doc']}/feedback/{item['id']}", json={"resolved": False})
    assert reopened.json()["resolved"] is False


def test_resolving_helpful_vote_rejected(client):
    client.set_current_user(client.ids["reader"])
    client.put(f"/docs/{client.ids['doc']}/feedback", json={"feedback_type": "helpful"})
    from app import models
    db = client.SessionLocal()
    try:
        fid = db.query(models.DocFeedback).filter_by(doc_id=client.ids["doc"]).first().id
    finally:
        db.close()
    client.set_current_user(client.ids["owner"])
    resp = client.put(f"/docs/{client.ids['doc']}/feedback/{fid}", json={"resolved": True})
    assert resp.status_code == 400


def test_editing_issue_reopens_and_renotifies(client):
    client.set_current_user(client.ids["reader"])
    client.put(f"/docs/{client.ids['doc']}/feedback", json={"feedback_type": "clarification", "comment": "first"})
    client.set_current_user(client.ids["owner"])
    item = client.get(f"/docs/{client.ids['doc']}/feedback/items").json()[0]
    client.put(f"/docs/{client.ids['doc']}/feedback/{item['id']}", json={"resolved": True})

    # The reader edits their feedback: it reopens and the owner is notified again.
    client.set_current_user(client.ids["reader"])
    resp = client.put(
        f"/docs/{client.ids['doc']}/feedback",
        json={"feedback_type": "clarification", "comment": "updated detail"},
    )
    assert resp.status_code == 200
    assert resp.json()["unresolved"] == 1
    assert resp.json()["my_feedback"]["comment"] == "updated detail"


def test_two_readers_counted_independently(client):
    client.set_current_user(client.ids["reader"])
    client.put(f"/docs/{client.ids['doc']}/feedback", json={"feedback_type": "helpful"})
    client.set_current_user(client.ids["reader2"])
    client.put(f"/docs/{client.ids['doc']}/feedback", json={"feedback_type": "not_helpful"})
    summary = client.get(f"/docs/{client.ids['doc']}/feedback").json()
    assert summary["helpful"] == 1
    assert summary["not_helpful"] == 1
    # reader2's own summary reflects their not-helpful vote.
    assert summary["my_feedback"]["feedback_type"] == "not_helpful"
