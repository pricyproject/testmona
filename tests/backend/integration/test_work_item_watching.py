"""Integration coverage for watching defects / test plans (Phase 5).

Drives the real HTTP surface: the watch endpoints, the reporter/assignee auto-watch
heuristics, and the change broadcast that lands a ``*_change`` notification in a
watcher's feed (but never the actor's).
"""

from conftest import make_http_client, seed_admin_project_member


client = make_http_client(seed_fn=seed_admin_project_member)


def _create_defect(client, **overrides):
    body = {"title": "Login crashes", "project_id": client.project_id}
    body.update(overrides)
    resp = client.post("/defects", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _change_types(client):
    resp = client.get("/notifications/", params={"limit": 100})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_reporter_auto_watches_new_defect(client):
    defect = _create_defect(client)

    status = client.get(f"/defects/{defect['id']}/watch")
    assert status.status_code == 200, status.text
    body = status.json()
    assert body["watching"] is True       # admin == reporter, auto-watched
    assert body["watcher_count"] == 1


def test_watch_toggle_endpoints(client):
    defect = _create_defect(client)
    did = defect["id"]

    # Reporter already watches; the member starts as a non-watcher.
    client.set_current_user(client.member_id)
    assert client.get(f"/defects/{did}/watch").json()["watching"] is False

    watched = client.post(f"/defects/{did}/watch")
    assert watched.status_code == 200, watched.text
    assert watched.json() == {"watching": True, "watcher_count": 2}

    unwatched = client.delete(f"/defects/{did}/watch")
    assert unwatched.status_code == 200, unwatched.text
    assert unwatched.json()["watching"] is False
    assert unwatched.json()["watcher_count"] == 1


def test_assignee_auto_watches_on_assignment(client):
    defect = _create_defect(client)
    did = defect["id"]

    assign = client.put(f"/defects/{did}", json={"assigned_to": client.member_id})
    assert assign.status_code == 200, assign.text

    client.set_current_user(client.member_id)
    assert client.get(f"/defects/{did}/watch").json()["watching"] is True


def test_change_broadcasts_to_watcher_not_actor(client):
    """The member watches; an admin edit notifies the member via defect_change,
    and the admin (the actor) never notifies themselves."""
    defect = _create_defect(client)
    did = defect["id"]
    admin_id = defect["reported_by"]  # the create's authenticated user

    # Member opts in to watching.
    client.set_current_user(client.member_id)
    client.post(f"/defects/{did}/watch")

    # Admin edits a watched field.
    client.set_current_user(admin_id)
    edit = client.put(f"/defects/{did}", json={"description": "Repro on Safari too."})
    assert edit.status_code == 200, edit.text

    # The member (watcher) is notified via defect_change.
    client.set_current_user(client.member_id)
    assert "defect_change" in [n["related_entity_type"] for n in _change_types(client)]

    # The admin (actor) is never notified of their own change.
    client.set_current_user(admin_id)
    assert "defect_change" not in [n["related_entity_type"] for n in _change_types(client)]
