"""End-to-end tests for the document review flow (Phase 6).

``POST /docs/{id}/request-review`` moves a doc into the ``in_review`` status and
emits a REVIEW notification to each chosen reviewer, validating that every reviewer
exists, is active, and can read the doc. A reviewer who also watches the doc gets a
single, higher-priority REVIEW row (the batch ladder folds the watch broadcast onto
it), while other watchers get the informational watch_change alert.
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

    # Two reviewers + a watcher, all project members (read access); one outsider.
    reviewer = models.User(username="rev", email="rev@b.c", hashed_password="x", role="tester", is_active=True, full_name="Rev")
    reviewer2 = models.User(username="rev2", email="rev2@b.c", hashed_password="x", role="tester", is_active=True, full_name="Rev2")
    watcher = models.User(username="watch", email="w@b.c", hashed_password="x", role="tester", is_active=True, full_name="Watcher")
    outsider = models.User(username="out", email="out@b.c", hashed_password="x", role="tester", is_active=True, full_name="Out")
    db.add_all([reviewer, reviewer2, watcher, outsider])
    db.commit()
    for u in (reviewer, reviewer2, watcher):
        db.refresh(u)
        db.add(models.ProjectAssignment(project_id=project.id, user_id=u.id, role=models.Role.TESTER))
    db.refresh(outsider)
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
    # The watcher subscribes to the doc.
    db.add(models.EntityWatch(user_id=watcher.id, entity_type="doc", entity_id=doc.id))
    db.commit()

    ids = dict(
        owner=owner.id, reviewer=reviewer.id, reviewer2=reviewer2.id,
        watcher=watcher.id, outsider=outsider.id, doc=doc.id, project=project.id,
    )
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


def _doc_status(client):
    from app import models
    db = client.SessionLocal()
    try:
        return db.query(models.Doc).filter(models.Doc.id == client.ids["doc"]).first().status
    finally:
        db.close()


def test_request_review_sets_status_and_notifies_reviewers(client):
    resp = client.post(
        f"/docs/{client.ids['doc']}/request-review",
        json={"reviewer_ids": [client.ids["reviewer"], client.ids["reviewer2"]], "note": "Please check section 3"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "in_review"
    assert body["notified_count"] == 2
    assert set(body["reviewer_ids"]) == {client.ids["reviewer"], client.ids["reviewer2"]}

    from app import models
    assert _doc_status(client) == models.DocStatus.IN_REVIEW
    rev_rows = _notifs(client, client.ids["reviewer"])
    assert len(rev_rows) == 1
    assert rev_rows[0].category == "review"
    assert rev_rows[0].related_entity_type == "doc"
    assert rev_rows[0].related_entity_id == client.ids["doc"]


def test_requester_is_not_notified(client):
    # The owner requests review and also names themselves — they get nothing.
    resp = client.post(
        f"/docs/{client.ids['doc']}/request-review",
        json={"reviewer_ids": [client.ids["owner"], client.ids["reviewer"]]},
    )
    assert resp.status_code == 200
    assert resp.json()["notified_count"] == 1
    assert _notifs(client, client.ids["owner"]) == []


def test_watcher_who_reviews_gets_single_review_row(client):
    # The watcher is also named as a reviewer: REVIEW outranks watch_change, so they
    # receive exactly one row — the review — not a duplicate watch alert.
    resp = client.post(
        f"/docs/{client.ids['doc']}/request-review",
        json={"reviewer_ids": [client.ids["watcher"]]},
    )
    assert resp.status_code == 200
    rows = _notifs(client, client.ids["watcher"])
    assert len(rows) == 1
    assert rows[0].category == "review"


def test_other_watchers_get_watch_change(client):
    # The watcher is NOT a reviewer, so they get the informational watch alert that
    # the doc entered review.
    resp = client.post(
        f"/docs/{client.ids['doc']}/request-review",
        json={"reviewer_ids": [client.ids["reviewer"]]},
    )
    assert resp.status_code == 200
    rows = _notifs(client, client.ids["watcher"])
    assert len(rows) == 1
    assert rows[0].category == "watch_change"
    assert rows[0].related_entity_type == "doc_change"


def test_unknown_or_inactive_reviewer_rejected(client):
    resp = client.post(
        f"/docs/{client.ids['doc']}/request-review",
        json={"reviewer_ids": [999999]},
    )
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"].lower()


def test_reviewer_without_access_rejected(client):
    resp = client.post(
        f"/docs/{client.ids['doc']}/request-review",
        json={"reviewer_ids": [client.ids["outsider"]]},
    )
    assert resp.status_code == 400
    assert "access" in resp.json()["detail"].lower()
    # Status must not have changed on a rejected request.
    from app import models
    assert _doc_status(client) == models.DocStatus.DRAFT


def test_request_review_requires_write_permission(client):
    # The outsider has no write access to the project.
    client.set_current_user(client.ids["outsider"])
    resp = client.post(
        f"/docs/{client.ids['doc']}/request-review",
        json={"reviewer_ids": [client.ids["reviewer"]]},
    )
    assert resp.status_code == 403
