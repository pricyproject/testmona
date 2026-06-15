"""Route-level tests for Phase 9 delivery endpoints: the SSE stream and the
admin weekly-digest trigger.
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
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    db = TestingSession()
    admin = models.User(username="admin", email="a@b.c", hashed_password="x", role="admin", is_active=True, is_superuser=True, full_name="Admin")
    member = models.User(username="bob", email="bob@b.c", hashed_password="x", role="tester", is_active=True, full_name="Bob")
    db.add_all([admin, member])
    db.commit()
    aid, mid = admin.id, member.id
    db.close()

    state = {"uid": aid}

    def override_db():
        d = TestingSession()
        try:
            yield d
        finally:
            d.close()

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
    c.admin_id, c.member_id = aid, mid  # type: ignore[attr-defined]
    c.set_current_user = lambda uid: state.__setitem__("uid", uid)  # type: ignore[attr-defined]
    try:
        yield c
    finally:
        main.app.dependency_overrides.clear()
        engine.dispose()
        os.unlink(path)


def test_weekly_digest_requires_admin(client):
    client.set_current_user(client.member_id)
    resp = client.post("/admin/notifications/weekly-digest")
    assert resp.status_code == 403


def test_weekly_digest_runs_for_admin(client):
    resp = client.post("/admin/notifications/weekly-digest")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Email isn't configured in the test env → a clean no-op run summary.
    assert body["sent"] == 0
    assert "considered" in body


def test_stream_disabled_returns_404(client, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "realtime_sse_enabled", False)
    resp = client.get("/notifications/stream")
    assert resp.status_code == 404


def test_stream_route_is_not_shadowed_by_id_route(client):
    # "/notifications/stream" must resolve to the SSE handler, not be parsed as
    # "/notifications/{notification_id}" with id="stream" (which would 422).
    from app.config import settings
    settings_was = settings.realtime_sse_enabled
    settings.realtime_sse_enabled = False
    try:
        resp = client.get("/notifications/stream")
        # 404 (disabled) proves it hit the stream handler; a 422 would mean the
        # id route shadowed it.
        assert resp.status_code == 404
    finally:
        settings.realtime_sse_enabled = settings_was
