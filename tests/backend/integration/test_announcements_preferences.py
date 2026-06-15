"""End-to-end tests for admin announcements (Phase 7) and the per-user
notification preference grid (Phase 8).

Self-contained: builds a fresh in-file SQLite DB and overrides the ``get_db`` and
auth dependencies, mirroring the Doc Hub integration harness.
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
    admin = models.User(username="admin", email="a@b.c", hashed_password="x",
                        role="admin", is_active=True, is_superuser=True, full_name="Admin")
    db.add(admin)
    db.commit()
    db.refresh(admin)
    # A project the admin owns, with one assigned member and one outsider.
    project = models.Project(name="Proj", description="d", owner_id=admin.id)
    db.add(project)
    db.commit()
    db.refresh(project)
    member = models.User(username="bob", email="bob@b.c", hashed_password="x",
                         role="tester", is_active=True, full_name="Bob")
    outsider = models.User(username="eve", email="eve@b.c", hashed_password="x",
                           role="tester", is_active=True, full_name="Eve")
    db.add_all([member, outsider])
    db.commit()
    db.refresh(member)
    db.refresh(outsider)
    db.add(models.ProjectAssignment(project_id=project.id, user_id=member.id))
    db.commit()
    aid, pid, mid, eid = admin.id, project.id, member.id, outsider.id
    db.close()

    def override_db():
        d = TestingSession()
        try:
            yield d
        finally:
            d.close()

    state = {"uid": aid}

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
    c.admin_id = aid  # type: ignore[attr-defined]
    c.project_id = pid  # type: ignore[attr-defined]
    c.member_id = mid  # type: ignore[attr-defined]
    c.outsider_id = eid  # type: ignore[attr-defined]
    c.SessionLocal = TestingSession  # type: ignore[attr-defined]
    c.set_current_user = lambda user_id: state.__setitem__("uid", user_id)  # type: ignore[attr-defined]
    try:
        yield c
    finally:
        main.app.dependency_overrides.clear()
        engine.dispose()
        os.unlink(path)


def _unread(client, user_id):
    """Count bell notifications a user currently holds."""
    from app import models
    db = client.SessionLocal()
    try:
        return db.query(models.Notification).filter(
            models.Notification.user_id == user_id
        ).all()
    finally:
        db.close()


# --- Phase 7: admin announcements ------------------------------------------

def test_announcement_to_all_notifies_every_active_user_except_sender(client):
    resp = client.post(
        "/admin/announcements",
        json={"title": "Maintenance", "message": "Down at 5pm", "audience": "all"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Admin (sender) is excluded; member + outsider notified.
    assert body["notified_count"] == 2
    assert {n.category for n in _unread(client, client.member_id)} == {"system"}
    assert len(_unread(client, client.admin_id)) == 0


def test_announcement_to_project_targets_members_only(client):
    resp = client.post(
        "/admin/announcements",
        json={
            "title": "Release",
            "message": "v2 is live",
            "audience": "project",
            "project_id": client.project_id,
        },
    )
    assert resp.status_code == 200, resp.text
    # Owner is the sender (excluded); only the assigned member is notified.
    assert resp.json()["notified_count"] == 1
    assert len(_unread(client, client.member_id)) == 1
    assert len(_unread(client, client.outsider_id)) == 0


def test_announcement_project_requires_project_id(client):
    resp = client.post(
        "/admin/announcements",
        json={"title": "x", "message": "y", "audience": "project"},
    )
    assert resp.status_code == 422


def test_announcement_requires_admin(client):
    client.set_current_user(client.member_id)
    resp = client.post(
        "/admin/announcements",
        json={"title": "x", "message": "y", "audience": "all"},
    )
    assert resp.status_code == 403


# --- Phase 8: preference grid ----------------------------------------------

def test_preferences_default_grid_is_all_on(client):
    resp = client.get("/notification-preferences")
    assert resp.status_code == 200, resp.text
    cats = resp.json()["categories"]
    # Every engine category is present and defaults to delivered.
    assert {c["key"] for c in cats} >= {"mention", "assignment", "status", "system"}
    assert all(c["in_app"] and c["email"] for c in cats)


def test_put_then_get_roundtrips_and_mutes_delivery(client):
    # Bob mutes in-app system announcements.
    client.set_current_user(client.member_id)
    put = client.put(
        "/notification-preferences",
        json={"preferences": [{"category": "system", "in_app": False, "email": True}]},
    )
    assert put.status_code == 200, put.text
    system = next(c for c in put.json()["categories"] if c["key"] == "system")
    assert system["in_app"] is False and system["email"] is True

    # An admin "all" announcement now skips Bob's bell.
    client.set_current_user(client.admin_id)
    resp = client.post(
        "/admin/announcements",
        json={"title": "t", "message": "m", "audience": "all"},
    )
    assert resp.status_code == 200
    assert len(_unread(client, client.member_id)) == 0
    # The outsider, who didn't mute, still receives it.
    assert len(_unread(client, client.outsider_id)) == 1


def test_put_rejects_unknown_category(client):
    resp = client.put(
        "/notification-preferences",
        json={"preferences": [{"category": "not_a_category", "in_app": False}]},
    )
    assert resp.status_code == 400
