"""Integration coverage for cross-cutting backend route groups."""

from conftest import make_http_client, seed_admin_project_member


client = make_http_client(seed_fn=seed_admin_project_member)


def test_users_settings_tokens_webhooks_and_audit_routes(client):
    from datetime import datetime, timedelta, timezone

    me = client.get("/users/me")
    assert me.status_code == 200, me.text
    assert {"id", "username", "email", "role"} <= set(me.json())
    profile = client.put("/users/me", json={"full_name": "Admin Updated"})
    assert profile.status_code == 200, profile.text
    assert client.get("/system/setup-status").json() == {"needs_setup": False}
    public_app_name = client.get("/system/settings/public/app_name")
    assert public_app_name.status_code == 200, public_app_name.text
    assert public_app_name.json()["value"]

    bad_setting = client.post("/system/settings", json={"key": "app_logo_url", "value": "ftp://bad"})
    assert bad_setting.status_code == 400, bad_setting.text
    setting = client.post("/system/settings", json={"key": "support_email", "value": "support@example.com"})
    assert setting.status_code == 200, setting.text
    fetched_setting = client.get("/system/settings/support_email")
    assert fetched_setting.status_code == 200, fetched_setting.text
    assert fetched_setting.json()["value"] == "support@example.com"

    expires = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    token = client.post("/api-tokens", json={"name": "CI", "expires_at": expires})
    assert token.status_code == 201, token.text
    created_token = token.json()
    assert created_token["token"].startswith("tmona_")
    listed_tokens = client.get("/api-tokens")
    assert listed_tokens.status_code == 200, listed_tokens.text
    assert listed_tokens.json()[0]["prefix"] == created_token["prefix"]
    assert "token" not in listed_tokens.json()[0]
    assert client.delete(f"/api-tokens/{created_token['id']}").status_code == 204

    events = client.get("/webhooks/supported-events")
    assert events.status_code == 200, events.text
    event = "defect.created" if "defect.created" in events.json() else events.json()[0]
    webhook = client.post(f"/projects/{client.project_id}/webhooks", json={
        "project_id": client.project_id,
        "name": "Quality hook",
        "url": "https://example.com/hooks/quality",
        "events": [event],
    })
    assert webhook.status_code == 201, webhook.text
    webhook_body = webhook.json()
    assert webhook_body["secret"]
    webhook_id = webhook_body["id"]
    webhook_list = client.get(f"/projects/{client.project_id}/webhooks")
    assert webhook_list.status_code == 200, webhook_list.text
    assert "secret" not in webhook_list.json()[0]
    rotated = client.put(f"/projects/{client.project_id}/webhooks/{webhook_id}", json={"rotate_secret": True})
    assert rotated.status_code == 200, rotated.text
    deliveries = client.get(f"/projects/{client.project_id}/webhooks/{webhook_id}/deliveries")
    assert deliveries.status_code == 200, deliveries.text
    assert client.delete(f"/projects/{client.project_id}/webhooks/{webhook_id}").status_code == 204

    audit = client.get("/audit-trails", params={"project_id": client.project_id})
    assert audit.status_code == 200, audit.text
    assert {"items", "total", "limit", "offset"} <= set(audit.json())
    recent = client.get("/audit-trails/recent", params={"project_id": client.project_id})
    assert recent.status_code == 200, recent.text


def test_notifications_datasets_shared_steps_versioning_and_analytics_routes(client):
    notification = client.post("/notifications/", json={
        "user_id": client.get("/users/me").json()["id"],
        "title": "Build finished",
        "message": "Pipeline is green",
        "type": "info",
    })
    assert notification.status_code == 200, notification.text
    notification_id = notification.json()["id"]
    assert client.get(f"/notifications/{notification_id}").status_code == 200
    read_notification = client.put(f"/notifications/{notification_id}", json={"is_read": True})
    assert read_notification.status_code == 200, read_notification.text
    unread = client.put(f"/notifications/{notification_id}/mark-unread")
    assert unread.status_code == 200, unread.text
    count = client.get("/notifications/unread/count")
    assert count.status_code == 200 and "unread_count" in count.json()
    bulk = client.post("/notifications/bulk-update", json={"notification_ids": [notification_id], "is_read": True})
    assert bulk.status_code == 200, bulk.text

    invalid_dataset = client.post("/test-datasets", json={
        "project_id": client.project_id,
        "name": "Bad data",
        "parameters": ["username", "password"],
        "rows": [{"username": "me", "password": "demo", "ignored": "x"}],
    })
    assert invalid_dataset.status_code == 422, invalid_dataset.text
    dataset = client.post("/test-datasets", json={
        "project_id": client.project_id,
        "name": "Login data",
        "parameters": ["username", "password"],
        "rows": [{"username": "me", "password": "demo"}],
    })
    assert dataset.status_code == 201, dataset.text
    dataset_body = dataset.json()
    assert dataset_body["created_by"]
    assert set(dataset_body["rows"][0]) == {"username", "password"}
    duplicate_dataset = client.post("/test-datasets", json={
        "project_id": client.project_id,
        "name": " Login data ",
        "parameters": ["username"],
        "rows": [{"username": "other"}],
    })
    assert duplicate_dataset.status_code == 400, duplicate_dataset.text
    dataset_update = client.put(f"/test-datasets/{dataset_body['id']}", json={"name": "Login data v2"})
    assert dataset_update.status_code == 200, dataset_update.text

    shared_step = client.post("/shared-steps/", json={
        "project_id": client.project_id,
        "name": "Open login page",
        "action": "Navigate to /login",
        "expected_result": "Login form is visible",
    })
    assert shared_step.status_code == 200, shared_step.text
    step_id = shared_step.json()["id"]
    step_update = client.put(f"/shared-steps/{step_id}", json={"description": "Reusable auth step"})
    assert step_update.status_code == 200, step_update.text
    usage = client.post(f"/shared-steps/{step_id}/increment-usage")
    assert usage.status_code == 200, usage.text
    assert usage.json()["usage_count"] == 1

    suite = client.post("/test-suites", json={"name": "Version Suite", "project_id": client.project_id}).json()
    case = client.post("/test-cases", json={"title": "Versioned case", "test_suite_id": suite["id"]})
    assert case.status_code == 200, case.text
    case_id = case.json()["id"]
    created_version = client.post(f"/versioning/test-cases/{case_id}/versions", json={"change_reason": "baseline"})
    assert created_version.status_code == 200, created_version.text
    versions = client.get(f"/versioning/test-cases/{case_id}/versions")
    assert versions.status_code == 200, versions.text
    assert versions.json()[0]["creator"]["id"]
    stats = client.get(f"/versioning/test-cases/{case_id}/stats")
    assert stats.status_code == 200, stats.text
    assert stats.json()["test_case_id"] == case_id

    dashboard = client.get("/analytics/dashboard/analytics", params={"project_id": client.project_id, "time_range": "7d"})
    assert dashboard.status_code == 200, dashboard.text
    assert {"kpi_data", "recent_activity", "team_performance", "upcoming_items"} <= set(dashboard.json())
    time_series = client.get("/analytics/time-series", params={"project_id": client.project_id})
    assert time_series.status_code == 200, time_series.text
    assert {"points", "summary", "total_test_cases"} <= set(time_series.json())
    coverage = client.get("/analytics/coverage-reports", params={"project_id": client.project_id})
    assert coverage.status_code == 200, coverage.text
    assert {"coverage_percentage", "report_data"} <= set(coverage.json()[0])
