"""Integration coverage for the Root Cause Analysis (RCA) routes.

Exercises the create/list/update/delete lifecycle plus the validation and
enrichment added to the endpoints: enum-guarded status/severity, project-scoped
link validation, the structured ``analysis_data`` blob, assignee notifications,
and the rich list serialization the modern UI renders from.
"""

from conftest import make_http_client, seed_admin_project_member


client = make_http_client(seed_fn=seed_admin_project_member)


def _seed_defect(client, *, project_id=None, defect_key="DEF-RCA"):
    """Insert a defect directly so RCAs have a real link target."""
    from app import models

    db = client.SessionLocal()
    try:
        defect = models.Defect(
            title="Checkout 500",
            defect_id=defect_key,
            project_id=project_id or client.project_id,
            reported_by=1,
        )
        db.add(defect)
        db.commit()
        db.refresh(defect)
        return defect.id
    finally:
        db.close()


def _base_payload(client, **overrides):
    payload = {
        "project_id": client.project_id,
        "analysis_title": "Race condition in session cache",
        "root_cause": "Two writers updated the cache without a lock.",
        "severity": "high",
        "status": "open",
    }
    payload.update(overrides)
    return payload


def test_create_and_list_returns_rich_fields(client):
    resp = client.post("/analytics/root-cause-analysis", json=_base_payload(
        client,
        impact_assessment="Intermittent logout for ~3% of users.",
        resolution_time_hours=4.5,
        analysis_data={
            "category": "code_defect",
            "corrective_action": "Add a row lock around cache writes.",
            "preventive_action": "Add a concurrency regression test.",
        },
    ))
    assert resp.status_code == 200, resp.text
    created = resp.json()
    assert created["discovered_by"] == 1  # server records the creator
    assert created["analysis_data"]["category"] == "code_defect"

    listed = client.get("/analytics/root-cause-analyses", params={"project_id": client.project_id})
    assert listed.status_code == 200, listed.text
    rows = listed.json()
    assert len(rows) == 1
    row = rows[0]
    # Rich serialization the UI depends on.
    assert row["discoverer_name"] == "Admin"
    assert row["assigned_to"] is None
    assert row["analysis_data"]["corrective_action"].startswith("Add a row lock")
    assert "updated_at" in row


def test_invalid_status_and_severity_rejected(client):
    bad_status = client.post("/analytics/root-cause-analysis", json=_base_payload(client, status="wat"))
    assert bad_status.status_code == 400

    bad_sev = client.post("/analytics/root-cause-analysis", json=_base_payload(client, severity="apocalyptic"))
    assert bad_sev.status_code == 400


def test_blank_title_or_root_cause_rejected(client):
    blank_title = client.post("/analytics/root-cause-analysis", json=_base_payload(client, analysis_title="   "))
    assert blank_title.status_code == 400

    blank_cause = client.post("/analytics/root-cause-analysis", json=_base_payload(client, root_cause=""))
    assert blank_cause.status_code == 400


def test_bad_category_rejected(client):
    resp = client.post("/analytics/root-cause-analysis", json=_base_payload(
        client, analysis_data={"category": "not_a_real_category"}
    ))
    assert resp.status_code == 400


def test_link_to_foreign_or_missing_defect_rejected(client):
    # A defect id that does not exist at all.
    resp = client.post("/analytics/root-cause-analysis", json=_base_payload(client, defect_id=99999))
    assert resp.status_code == 400

    # A defect that exists but belongs to a different project.
    other = client.SessionLocal()
    try:
        from app import models
        proj = models.Project(name="Other", description="d", owner_id=1)
        other.add(proj)
        other.commit()
        other.refresh(proj)
        foreign_project_id = proj.id
    finally:
        other.close()
    foreign_defect = _seed_defect(client, project_id=foreign_project_id, defect_key="DEF-OTHER")
    resp = client.post("/analytics/root-cause-analysis", json=_base_payload(client, defect_id=foreign_defect))
    assert resp.status_code == 400


def test_link_to_in_project_defect_succeeds(client):
    defect_id = _seed_defect(client)
    resp = client.post("/analytics/root-cause-analysis", json=_base_payload(client, defect_id=defect_id))
    assert resp.status_code == 200, resp.text
    assert resp.json()["defect_id"] == defect_id


def test_list_filters_by_defect(client):
    defect_id = _seed_defect(client)
    # One RCA linked to the defect, one unlinked.
    client.post("/analytics/root-cause-analysis", json=_base_payload(client, defect_id=defect_id))
    client.post("/analytics/root-cause-analysis", json=_base_payload(client, analysis_title="Unlinked"))

    scoped = client.get(
        "/analytics/root-cause-analyses",
        params={"project_id": client.project_id, "defect_id": defect_id},
    )
    assert scoped.status_code == 200, scoped.text
    rows = scoped.json()
    assert len(rows) == 1
    assert rows[0]["defect_id"] == defect_id

    all_rows = client.get("/analytics/root-cause-analyses", params={"project_id": client.project_id})
    assert len(all_rows.json()) == 2


def test_assignment_notifies_member(client):
    resp = client.post("/analytics/root-cause-analysis", json=_base_payload(
        client, assigned_to=client.member_id
    ))
    assert resp.status_code == 200, resp.text

    db = client.SessionLocal()
    try:
        from app import models
        notifs = db.query(models.Notification).filter(
            models.Notification.user_id == client.member_id,
            models.Notification.related_entity_type == "root_cause_analysis",
        ).all()
        assert len(notifs) == 1
        assert notifs[0].category == "assignment"
    finally:
        db.close()


def test_assign_to_invalid_user_rejected(client):
    resp = client.post("/analytics/root-cause-analysis", json=_base_payload(client, assigned_to=99999))
    assert resp.status_code == 400


def test_update_validates_and_persists(client):
    created = client.post("/analytics/root-cause-analysis", json=_base_payload(client)).json()
    analysis_id = created["id"]

    # Invalid status on update is rejected.
    bad = client.put(f"/analytics/root-cause-analysis/{analysis_id}", json={"status": "bogus"})
    assert bad.status_code == 400

    ok = client.put(f"/analytics/root-cause-analysis/{analysis_id}", json={
        "status": "resolved",
        "resolution_time_hours": 2.0,
    })
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "resolved"


def test_delete_requires_manage_and_removes(client):
    created = client.post("/analytics/root-cause-analysis", json=_base_payload(client)).json()
    analysis_id = created["id"]

    resp = client.delete(f"/analytics/root-cause-analysis/{analysis_id}")
    assert resp.status_code == 200, resp.text

    listed = client.get("/analytics/root-cause-analyses", params={"project_id": client.project_id})
    assert listed.json() == []
