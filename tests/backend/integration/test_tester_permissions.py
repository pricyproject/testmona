"""Integration coverage for the tester-role capability boundary.

A tester may delete test *content* (test cases, defects, …) but not project
*structure/config* (projects, requirements, milestones, …). The frontend reads
``GET /users/me/permissions`` to gate controls accordingly. These tests drive
the real routes as a tester to lock that boundary in.
"""

from conftest import make_http_client


def _seed(db, _engine):
    """Admin-owned project with a test case, a defect and a requirement, plus a
    tester assigned to the project. Acts as the tester by default."""
    from app import models

    admin = models.User(
        username="owner", email="owner@b.c", hashed_password="x",
        role="admin", is_active=True, full_name="Owner",
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)

    project = models.Project(name="Proj", description="d", owner_id=admin.id)
    db.add(project)
    db.commit()
    db.refresh(project)

    tester = models.User(
        username="tess", email="tess@b.c", hashed_password="x",
        role="tester", is_active=True, full_name="Tess Tester",
    )
    db.add(tester)
    db.commit()
    db.refresh(tester)
    db.add(models.ProjectAssignment(project_id=project.id, user_id=tester.id, role=models.Role.TESTER))

    suite = models.TestSuite(name="S1", project_id=project.id)
    db.add(suite)
    db.commit()
    db.refresh(suite)
    case = models.TestCase(
        title="TC", test_suite_id=suite.id, status="active",
        priority="high", test_type="manual", created_by=tester.id,
    )
    defect = models.Defect(
        title="Bug", defect_id="DEF-1", project_id=project.id,
        status=models.DefectStatus.OPEN, reported_by=tester.id,
    )
    requirement = models.Requirement(
        title="Req", requirement_id="REQ-1", project_id=project.id,
        created_by=admin.id,
    )
    db.add_all([case, defect, requirement])
    db.commit()
    db.refresh(case)
    db.refresh(defect)
    db.refresh(requirement)

    # A project the tester OWNS — they get manager+ capabilities there, so it must
    # surface in the per-project map (elevation above the global tester role).
    owned = models.Project(name="Owned", description="d", owner_id=tester.id)
    db.add(owned)
    db.commit()
    db.refresh(owned)

    return tester.id, project.id, {
        "test_case_id": case.id,
        "defect_id": defect.id,
        "requirement_id": requirement.id,
        "owned_project_id": owned.id,
    }


client = make_http_client(seed_fn=_seed)


def test_effective_permissions_endpoint_for_tester(client):
    resp = client.get("/users/me/permissions")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Global tester capability: delete test content, but not manage projects.
    assert "delete" in body["global"]
    assert "write" in body["global"]
    assert "manage_projects" not in body["global"]

    # An assigned-as-tester project has the same perms as global, so it is
    # omitted from the map (the client falls back to `global`).
    assert str(client.project_id) not in body["projects"]

    # The project the tester OWNS is elevated, so it appears with manage_projects.
    owned = body["projects"][str(client.owned_project_id)]
    assert "manage_projects" in owned
    assert "delete" in owned


def test_test_case_detail_exposes_capability_flags(client):
    resp = client.get(f"/test-cases/{client.test_case_id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["can_edit"] is True
    assert body["can_delete"] is True


def test_tester_can_delete_test_content(client):
    # Test case and defect are test content — a tester owns the delete.
    assert client.delete(f"/test-cases/{client.test_case_id}").status_code == 200
    assert client.delete(f"/defects/{client.defect_id}").status_code == 200


def test_tester_cannot_delete_project_structure(client):
    # Requirements and the project itself are manager+ to delete.
    assert client.delete(f"/requirements/{client.requirement_id}").status_code == 403
    assert client.delete(f"/projects/{client.project_id}").status_code == 403


def test_tester_bulk_requirement_delete_is_skipped_not_applied(client):
    # Bulk delete must mirror the single-delete boundary: testers lack
    # manage_projects, so the requirement is skipped, not deleted.
    resp = client.post("/requirements/bulk/delete", json={"ids": [client.requirement_id]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["updated"] == 0
    assert client.requirement_id in body["skipped_ids"]
    # And it still exists.
    assert client.get(f"/requirements/{client.requirement_id}").status_code == 200


def test_tester_cannot_delete_defect_template(client):
    # Defect templates are reusable project config (catalog) → manager+ to delete.
    created = client.post(
        f"/projects/{client.project_id}/defect-templates",
        json={"name": "Tmpl", "description": "D"},
    )
    assert created.status_code in (200, 201), created.text
    template_id = created.json()["id"]
    resp = client.delete(f"/projects/{client.project_id}/defect-templates/{template_id}")
    assert resp.status_code == 403, resp.text
