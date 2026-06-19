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
    assert rev_rows[0].title == "Review requested"
    assert rev_rows[0].type == models.NotificationType.WARNING
    assert rev_rows[0].related_entity_type == "doc"
    assert rev_rows[0].related_entity_id == client.ids["doc"]
    assert rev_rows[0].actor_id == client.ids["owner"]


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


# --------------------------------------------------------------------------- #
# Review rounds: decisions, resolution, cancellation, publish gate            #
# --------------------------------------------------------------------------- #

def _request_review(client, reviewer_ids, note=None):
    return client.post(
        f"/docs/{client.ids['doc']}/request-review",
        json={"reviewer_ids": reviewer_ids, "note": note},
    )


def test_request_review_opens_round_with_assignments(client):
    resp = _request_review(client, [client.ids["reviewer"], client.ids["reviewer2"]])
    assert resp.status_code == 200
    round_id = resp.json()["round_id"]
    assert round_id

    review = client.get(f"/docs/{client.ids['doc']}/review").json()
    assert review["doc_status"] == "in_review"
    cur = review["current_round"]
    assert cur["status"] == "open"
    assert cur["pending_count"] == 2
    assert {r["reviewer_id"] for r in cur["reviewers"]} == {client.ids["reviewer"], client.ids["reviewer2"]}


def test_all_approvals_resolve_round_and_keep_in_review(client):
    _request_review(client, [client.ids["reviewer"], client.ids["reviewer2"]])

    client.set_current_user(client.ids["reviewer"])
    r1 = client.post(f"/docs/{client.ids['doc']}/review/decision", json={"decision": "approved"})
    assert r1.status_code == 200
    # One approval is not enough; round stays open, doc stays in review.
    assert r1.json()["current_round"]["status"] == "open"
    assert _doc_status(client).value == "in_review"

    client.set_current_user(client.ids["reviewer2"])
    r2 = client.post(f"/docs/{client.ids['doc']}/review/decision", json={"decision": "approved"})
    assert r2.status_code == 200
    body = r2.json()
    assert body["current_round"] is None  # resolved → no longer the open round
    assert body["history"][0]["status"] == "approved"
    # Approved doc stays in_review, ready to publish.
    assert _doc_status(client).value == "in_review"
    # The requester (owner) was notified of the final approval.
    owner_rows = _notifs(client, client.ids["owner"])
    assert any(n.title == "Review approved" for n in owner_rows)


def test_changes_requested_kicks_doc_back_to_draft(client):
    _request_review(client, [client.ids["reviewer"], client.ids["reviewer2"]])
    client.set_current_user(client.ids["reviewer"])
    resp = client.post(
        f"/docs/{client.ids['doc']}/review/decision",
        json={"decision": "changes_requested", "comment": "Fix the auth section"},
    )
    assert resp.status_code == 200
    assert resp.json()["history"][0]["status"] == "changes_requested"
    assert _doc_status(client).value == "draft"
    owner_rows = _notifs(client, client.ids["owner"])
    assert any(n.title == "Changes requested" for n in owner_rows)


def test_non_reviewer_cannot_decide(client):
    _request_review(client, [client.ids["reviewer"]])
    # reviewer2 is a project member (read access) but not assigned to this round.
    client.set_current_user(client.ids["reviewer2"])
    resp = client.post(f"/docs/{client.ids['doc']}/review/decision", json={"decision": "approved"})
    assert resp.status_code == 403


def test_decision_without_open_round_conflicts(client):
    client.set_current_user(client.ids["reviewer"])
    resp = client.post(f"/docs/{client.ids['doc']}/review/decision", json={"decision": "approved"})
    assert resp.status_code == 409


def test_cancel_review_returns_doc_to_draft(client):
    _request_review(client, [client.ids["reviewer"]])
    resp = client.post(f"/docs/{client.ids['doc']}/review/cancel", json={"note": "Not ready"})
    assert resp.status_code == 200
    assert resp.json()["current_round"] is None
    assert _doc_status(client).value == "draft"
    # The pending reviewer is told the request was withdrawn.
    rev_rows = _notifs(client, client.ids["reviewer"])
    assert any(n.title == "Review withdrawn" for n in rev_rows)


def test_new_request_supersedes_open_round(client):
    first = _request_review(client, [client.ids["reviewer"]]).json()["round_id"]
    second = _request_review(client, [client.ids["reviewer2"]]).json()["round_id"]
    assert second != first

    from app import models
    db = client.SessionLocal()
    try:
        old = db.query(models.DocReviewRound).filter(models.DocReviewRound.id == first).first()
        assert old.status == models.DocReviewRoundStatus.CANCELLED
    finally:
        db.close()
    # Only the new round is current.
    review = client.get(f"/docs/{client.ids['doc']}/review").json()
    assert review["current_round"]["id"] == second


def test_publish_blocked_while_review_open(client):
    _request_review(client, [client.ids["reviewer"]])
    resp = client.put(f"/docs/{client.ids['doc']}", json={"status": "published"})
    assert resp.status_code == 409
    assert "review" in resp.json()["detail"].lower()
    assert _doc_status(client).value == "in_review"


def test_publish_allowed_after_approval(client):
    _request_review(client, [client.ids["reviewer"]])
    client.set_current_user(client.ids["reviewer"])
    client.post(f"/docs/{client.ids['doc']}/review/decision", json={"decision": "approved"})
    client.set_current_user(client.ids["owner"])
    resp = client.put(f"/docs/{client.ids['doc']}", json={"status": "published"})
    assert resp.status_code == 200
    assert _doc_status(client).value == "published"
