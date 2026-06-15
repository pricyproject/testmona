"""Integration coverage for the requirement review-request flow.

`POST /requirements/{id}/request-review` is the flow that wires the engine's
REVIEW category (Work Inbox "Reviews", warning-styled) to a real user action.
"""

from conftest import make_http_client, seed_admin_project_member


client = make_http_client(seed_fn=seed_admin_project_member)


def _notifs(client, user_id):
    from app import models

    db = client.SessionLocal()
    try:
        return db.query(models.Notification).filter(
            models.Notification.user_id == user_id
        ).all()
    finally:
        db.close()


def _create_requirement(client):
    resp = client.post("/requirements", json={
        "title": "Login must support SSO",
        "project_id": client.project_id,
        "created_by": 0,  # server overrides with the authenticated user
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def test_request_review_notifies_reviewer_and_lands_in_inbox(client):
    requirement_id = _create_requirement(client)

    review = client.post(f"/requirements/{requirement_id}/request-review", json={
        "reviewer_ids": [client.member_id],
        "note": "Please check the SSO acceptance criteria.",
    })
    assert review.status_code == 200, review.text
    body = review.json()
    assert body["notified_count"] == 1
    assert body["reviewer_ids"] == [client.member_id]

    # The reviewer sees a warning-typed, actionable item in their Work Inbox.
    client.set_current_user(client.member_id)
    inbox = client.get("/inbox", params={"category": "review"})
    assert inbox.status_code == 200, inbox.text
    items = inbox.json()
    assert len(items) == 1
    item = items[0]
    assert item["category"] == "review"
    assert item["type"].lower() == "warning"
    assert item["title"] == "Review requested"
    assert "SSO acceptance criteria" in item["message"]

    persisted = _notifs(client, client.member_id)
    assert len(persisted) == 1
    assert persisted[0].category == "review"
    assert persisted[0].title == "Review requested"
    assert persisted[0].related_entity_type == "requirement"
    assert persisted[0].related_entity_id == requirement_id
    assert persisted[0].actor_id == 1

    # It is counted as an open, actionable review in the inbox summary.
    summary = client.get("/inbox/summary")
    assert summary.status_code == 200, summary.text
    review_cat = next(c for c in summary.json()["categories"] if c["key"] == "review")
    assert review_cat["open"] == 1


def test_request_review_excludes_self(client):
    requirement_id = _create_requirement(client)
    # Admin (id 1) requests review from themselves only.
    review = client.post(f"/requirements/{requirement_id}/request-review", json={
        "reviewer_ids": [1],
    })
    assert review.status_code == 200, review.text
    assert review.json()["notified_count"] == 0


def test_request_review_rejects_unknown_reviewer(client):
    requirement_id = _create_requirement(client)
    review = client.post(f"/requirements/{requirement_id}/request-review", json={
        "reviewer_ids": [999999],
    })
    assert review.status_code == 400, review.text


def test_request_review_requires_existing_requirement(client):
    review = client.post("/requirements/999999/request-review", json={
        "reviewer_ids": [client.member_id],
    })
    assert review.status_code == 404, review.text
