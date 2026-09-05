"""Paging regressions for the test-result list.

The test-run detail and execution pages walk this list a page at a time, which
is only correct if the order is stable and the page size is bounded.
"""

from conftest import make_http_client


client = make_http_client()


def _seed_run_with_cases(client, case_count):
    suite = client.post("/test-suites", json={"name": "S", "project_id": client.project_id}).json()
    run = client.post("/test-runs", json={"name": "R", "project_id": client.project_id}).json()
    case_ids = []
    for i in range(case_count):
        case = client.post("/test-cases", json={
            "title": f"Case {i}", "test_suite_id": suite["id"], "test_type": "manual",
        }).json()
        case_ids.append(case["id"])
        created = client.post("/test-results", json={
            "test_run_id": run["id"], "test_case_id": case["id"], "status": "not_started",
        })
        assert created.status_code == 200, created.text
    return run, case_ids


def test_result_paging_is_stable_and_complete(client):
    """Walking pages must return every row exactly once."""
    run, case_ids = _seed_run_with_cases(client, 7)

    seen = []
    page_size = 2
    for skip in range(0, 20, page_size):
        page = client.get(f"/test-results?test_run_id={run['id']}&skip={skip}&limit={page_size}").json()
        if not page:
            break
        seen.extend(row["id"] for row in page)

    assert len(seen) == len(case_ids)
    assert len(set(seen)) == len(case_ids), "paging returned a duplicate row"
    assert seen == sorted(seen), "paging is not in a stable order"


def test_result_limit_is_bounded(client):
    """An out-of-range limit is rejected rather than silently unbounded."""
    run, _ = _seed_run_with_cases(client, 1)
    assert client.get(f"/test-results?test_run_id={run['id']}&limit=501").status_code == 422
    assert client.get(f"/test-results?test_run_id={run['id']}&limit=500").status_code == 200
    assert client.get(f"/test-results?test_run_id={run['id']}&limit=0").status_code == 422
