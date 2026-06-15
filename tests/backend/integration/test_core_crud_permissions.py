"""Representative CRUD, permissions, and relationship edge tests.

This file intentionally covers common route patterns across core backend modules
without trying to assert every field of every registered route.
"""

from conftest import make_http_client, seed_admin_project_member


client = make_http_client(seed_fn=seed_admin_project_member)


def _notifs(client, user_id):
    from app import models

    db = client.SessionLocal()
    try:
        return (
            db.query(models.Notification)
            .filter(models.Notification.user_id == user_id)
            .order_by(models.Notification.id)
            .all()
        )
    finally:
        db.close()


def test_core_backend_crud_permissions_and_relationship_edges(client):
    from app import models

    project = client.post("/projects", json={"name": "CRUD Project", "description": "route smoke"})
    assert project.status_code == 200, project.text
    project_id = project.json()["id"]
    assert client.get(f"/projects/{project_id}").status_code == 200
    updated_project = client.put(f"/projects/{project_id}", json={"description": "updated"})
    assert updated_project.status_code == 200, updated_project.text
    assert updated_project.json()["description"] == "updated"

    suite = client.post("/test-suites", json={"name": "CRUD Suite", "project_id": client.project_id})
    assert suite.status_code == 200, suite.text
    suite_id = suite.json()["id"]
    section = client.post("/test-case-sections", json={"name": "Auth", "test_suite_id": suite_id})
    assert section.status_code == 200, section.text
    case = client.post("/test-cases", json={
        "title": "Login route case",
        "test_suite_id": suite_id,
        "section_id": section.json()["id"],
        "priority": "high",
        "test_type": "manual",
    })
    assert case.status_code == 200, case.text
    case_id = case.json()["id"]
    assert client.delete(f"/test-suites/{suite_id}").status_code == 409

    folder = client.post("/requirements/folders", json={"name": "Release", "project_id": client.project_id})
    assert folder.status_code == 200, folder.text
    requirement = client.post("/requirements", json={
        "title": "Login requirement",
        "project_id": client.project_id,
        "created_by": 99999,
        "folder_id": folder.json()["id"],
        "priority": "high",
    })
    assert requirement.status_code == 200, requirement.text
    requirement_id = requirement.json()["id"]
    assert requirement.json()["created_by"] != 99999
    assert client.put(f"/requirements/{requirement_id}", json={"status": "approved"}).status_code == 200

    defect = client.post("/defects", json={"title": "Login defect", "project_id": client.project_id})
    assert defect.status_code == 200, defect.text
    defect_update = client.put(f"/defects/{defect.json()['id']}", json={"status": "in_progress"})
    assert defect_update.status_code == 200, defect_update.text

    milestone = client.post("/milestones", json={"title": "M1", "project_id": client.project_id})
    assert milestone.status_code == 200, milestone.text
    milestone_id = milestone.json()["id"]
    other_milestone = client.post("/milestones", json={"title": "Foreign milestone", "project_id": project_id})
    assert other_milestone.status_code == 200, other_milestone.text
    bad_plan = client.post("/test-plans", json={
        "title": "Wrong milestone",
        "project_id": client.project_id,
        "created_by": client.member_id,
        "milestone_id": other_milestone.json()["id"],
    })
    assert bad_plan.status_code == 400, bad_plan.text
    plan = client.post("/test-plans", json={
        "title": "Plan 1",
        "project_id": client.project_id,
        "created_by": client.member_id,
        "milestone_id": milestone_id,
    })
    assert plan.status_code == 200, plan.text
    plan_id = plan.json()["id"]
    linked = client.post(f"/test-plans/{plan_id}/requirements/bulk", json={
        "requirement_ids": [requirement_id],
        "action": "link",
    })
    assert linked.status_code == 200, linked.text
    plan_reqs = client.get(f"/test-plans/{plan_id}/requirements")
    assert plan_reqs.status_code == 200, plan_reqs.text
    assert plan_reqs.json()["total"] == 1

    run = client.post("/test-runs", json={
        "name": "Run 1",
        "project_id": client.project_id,
        "test_plan_id": plan_id,
        "milestone_id": milestone_id,
    })
    assert run.status_code == 200, run.text
    run_id = run.json()["id"]
    bad_run = client.post("/test-runs", json={
        "name": "Wrong milestone run",
        "project_id": client.project_id,
        "test_plan_id": plan_id,
        "milestone_id": other_milestone.json()["id"],
    })
    assert bad_run.status_code == 400, bad_run.text
    result = client.post("/test-results", json={"test_case_id": case_id, "test_run_id": run_id, "status": "failed"})
    assert result.status_code == 200, result.text
    result_update = client.put(f"/test-results/{result.json()['id']}", json={
        "status": "blocked",
        "blocker_reason": "dependency",
    })
    assert result_update.status_code == 200, result_update.text
    assert client.get(f"/test-runs/{run_id}/defect-coverage").status_code == 200
    assert client.get(f"/test-runs/{run_id}/flakiness").status_code == 200

    field = client.post("/custom-fields/definitions", json={
        "name": "Browser",
        "field_type": "text",
        "project_id": client.project_id,
        "entity_types": ["test_case", "defect"],
    })
    assert field.status_code == 200, field.text
    field_update = client.put(f"/custom-fields/definitions/{field.json()['id']}", json={"description": "covered"})
    assert field_update.status_code == 200, field_update.text

    health = client.get(f"/projects/{client.project_id}/test-asset-health/summary")
    assert health.status_code == 200, health.text
    debt = client.post(f"/projects/{client.project_id}/test-asset-health/debt-items", json={
        "test_case_id": case_id,
        "debt_type": "stale",
        "severity": "medium",
        "suggested_action": "update",
        "details": "Needs review",
    })
    assert debt.status_code == 200, debt.text
    assert client.post(f"/projects/{client.project_id}/test-asset-health/debt-items/{debt.json()['id']}/resolve").status_code == 200

    report = client.post("/coverage-reports/", json={
        "project_id": client.project_id,
        "generated_by": client.member_id,
        "test_run_id": run_id,
        "report_type": "summary",
        "total_requirements": 1,
        "covered_requirements": 1,
        "coverage_percentage": 100,
    })
    assert report.status_code == 200, report.text
    report_update = client.put(f"/coverage-reports/{report.json()['id']}", json={"coverage_percentage": 80})
    assert report_update.status_code == 200, report_update.text
    assert report_update.json()["coverage_percentage"] == 80

    db = client.SessionLocal()
    viewer = models.User(username="viewer", email="viewer@b.c", hashed_password="x", role="viewer", is_active=True)
    db.add(viewer)
    db.commit()
    db.refresh(viewer)
    db.add(models.ProjectAssignment(project_id=client.project_id, user_id=viewer.id, role=models.Role.VIEWER))
    db.commit()
    viewer_id = viewer.id
    db.close()
    client.set_current_user(viewer_id)

    assert client.get("/requirements", params={"project_id": client.project_id}).status_code == 200
    assert client.post("/requirements", json={"title": "Blocked", "project_id": client.project_id, "created_by": viewer_id}).status_code == 403
    assert client.put(f"/test-plans/{plan_id}", json={"title": "Blocked"}).status_code == 403
    assert client.post(f"/projects/{client.project_id}/test-asset-health/detect").status_code == 403


def test_test_run_notifications_keep_assignment_and_completion_contract(client):
    from app import models

    milestone = client.post("/milestones", json={
        "title": "Run notification milestone",
        "project_id": client.project_id,
    })
    assert milestone.status_code == 200, milestone.text
    milestone_id = milestone.json()["id"]

    db = client.SessionLocal()
    try:
        db.query(models.Milestone).filter(models.Milestone.id == milestone_id).update(
            {"owner_id": client.member_id}
        )
        db.commit()
    finally:
        db.close()

    run = client.post("/test-runs", json={
        "name": "Run notification contract",
        "project_id": client.project_id,
        "milestone_id": milestone_id,
        "assigned_to": client.member_id,
    })
    assert run.status_code == 200, run.text
    run_id = run.json()["id"]

    member_notifications = _notifs(client, client.member_id)
    assert len(member_notifications) == 1
    assignment = member_notifications[0]
    assert assignment.category == "assignment"
    assert assignment.title == "Test run assigned"
    assert assignment.related_entity_type == "test_run"
    assert assignment.related_entity_id == run_id
    assert assignment.actor_id == 1

    completed = client.put(f"/test-runs/{run_id}", json={"status": "completed"})
    assert completed.status_code == 200, completed.text

    member_notifications = _notifs(client, client.member_id)
    assert [notification.category for notification in member_notifications] == [
        "assignment",
        "status",
    ]
    status = member_notifications[1]
    assert status.title == "Test run completed"
    assert status.type == models.NotificationType.SUCCESS
    assert status.related_entity_type == "test_run"
    assert status.related_entity_id == run_id
    assert status.actor_id == 1
