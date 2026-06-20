"""Regression tests for per-project priority definition defaults.

Priority catalogs are per-project. Marking a priority as the default in one
project must not disturb another project's default (previously
``update_priority_definition`` cleared ``is_default`` globally).
"""

from conftest import make_http_client


client = make_http_client()


def _defaults(client, project_id):
    resp = client.get(f"/priority-definitions/?project_id={project_id}")
    assert resp.status_code == 200, resp.text
    return {p["name"]: p["is_default"] for p in resp.json()}


def test_setting_default_in_one_project_leaves_other_project_untouched(client):
    project_a = client.project_id
    project_b = client.post("/projects", json={"name": "Project B", "description": "b"}).json()["id"]

    # First GET seeds each project's standard catalog (Medium is the default).
    defaults_a = _defaults(client, project_a)
    defaults_b = _defaults(client, project_b)
    assert defaults_a["Medium"] is True
    assert defaults_b["Medium"] is True

    # Promote a different priority to default in project A only.
    high_a = next(
        p for p in client.get(f"/priority-definitions/?project_id={project_a}").json()
        if p["name"] == "High"
    )
    resp = client.put(f"/priority-definitions/{high_a['id']}", json={"is_default": True})
    assert resp.status_code == 200, resp.text

    after_a = _defaults(client, project_a)
    after_b = _defaults(client, project_b)

    # Project A's default moved from Medium to High...
    assert after_a["High"] is True
    assert after_a["Medium"] is False
    # ...while project B's default is completely untouched.
    assert after_b["Medium"] is True
    assert sum(1 for v in after_b.values() if v) == 1


def test_duplicate_priority_name_in_same_project_returns_409(client):
    project_a = client.project_id
    _defaults(client, project_a)  # seed standards (includes "High")

    resp = client.post("/priority-definitions/", json={
        "project_id": project_a,
        "name": "High",
        "value": 5,
        "color": "#123456",
        "created_by": 1,
    })
    assert resp.status_code == 409, resp.text
