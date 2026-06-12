"""Deleting a test run that has seeded results must remove its dependents.

Regression: the ORM's default cascade tried to NULL test_results.test_run_id
(a NOT NULL column), so DELETE /test-runs/{id} 500'd for any run with results.
"""

from conftest import make_http_client


client = make_http_client()


def test_delete_run_with_results(client):
    suite = client.post("/test-suites", json={"name": "S", "project_id": client.project_id}).json()
    case = client.post("/test-cases", json={
        "title": "T", "test_suite_id": suite["id"], "test_type": "manual",
    }).json()
    run = client.post("/test-runs", json={"name": "R", "project_id": client.project_id}).json()
    result = client.post("/test-results", json={
        "test_run_id": run["id"], "test_case_id": case["id"], "status": "not_started",
    })
    assert result.status_code == 200, result.text

    deleted = client.delete(f"/test-runs/{run['id']}")
    assert deleted.status_code == 200, deleted.text
    assert client.get(f"/test-runs/{run['id']}").status_code == 404
    # The results endpoint 404s for the now-deleted run rather than listing orphans.
    assert client.get(f"/test-results?test_run_id={run['id']}").status_code == 404
