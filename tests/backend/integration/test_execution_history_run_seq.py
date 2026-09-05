"""The execution history must carry the run's per-project sequence.

The UI builds run URLs from `project_seq`, so a history row that only exposes
the global id sends the reader to a different run (or to nothing at all).
"""

from conftest import make_http_client


client = make_http_client()


def test_execution_history_exposes_run_project_seq(client):
    suite = client.post("/test-suites", json={"name": "S", "project_id": client.project_id}).json()
    case = client.post("/test-cases", json={
        "title": "Case", "test_suite_id": suite["id"], "test_type": "manual",
    }).json()
    run = client.post("/test-runs", json={"name": "R", "project_id": client.project_id}).json()
    seeded = client.post("/test-results", json={
        "test_run_id": run["id"], "test_case_id": case["id"], "status": "not_started",
    })
    assert seeded.status_code == 200, seeded.text

    history = client.get(f"/test-cases/{case['id']}/execution-history").json()
    assert history, "expected the seeded result in the case's history"

    entry = next(row for row in history if row["test_run_id"] == run["id"])
    assert entry["test_run_project_seq"] is not None
    assert entry["test_run_project_seq"] == run["project_seq"]
