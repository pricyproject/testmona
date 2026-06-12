"""Environment matrix runs: create N runs from one selection, pivot, delete."""

from conftest import make_http_client


client = make_http_client()


def _seed_suite_cases_envs(client):
    suite = client.post("/test-suites", json={"name": "Matrix Suite", "project_id": client.project_id})
    assert suite.status_code == 200, suite.text
    suite_id = suite.json()["id"]

    case_ids = []
    for title in ("Login", "Logout", "Checkout"):
        case = client.post("/test-cases", json={
            "title": title,
            "test_suite_id": suite_id,
            "priority": "high",
            "test_type": "manual",
        })
        assert case.status_code == 200, case.text
        case_ids.append(case.json()["id"])

    env_ids = []
    for name, env_type in (("Staging", "staging"), ("Production", "production")):
        env = client.post("/environments", json={
            "name": name,
            "environment_type": env_type,
            "project_id": client.project_id,
        })
        assert env.status_code == 200, env.text
        env_ids.append(env.json()["id"])

    return case_ids, env_ids


def test_matrix_run_lifecycle(client):
    case_ids, env_ids = _seed_suite_cases_envs(client)

    created = client.post("/matrix-runs", json={
        "project_id": client.project_id,
        "name": "Release 1.0 cross-env",
        "description": "Same suite on staging + production",
        "environment_ids": env_ids,
        "test_case_ids": case_ids,
    })
    assert created.status_code == 200, created.text
    matrix = created.json()
    matrix_id = matrix["id"]
    assert matrix["project_seq"] == 1
    assert matrix["status"] == "pending"
    assert matrix["case_count"] == len(case_ids)
    assert len(matrix["environments"]) == len(env_ids)
    assert [col["environment_id"] for col in matrix["environments"]] == env_ids
    # every cell starts not_started
    assert len(matrix["rows"]) == len(case_ids)
    run_ids = [col["test_run_id"] for col in matrix["environments"]]
    for row in matrix["rows"]:
        assert set(row["results"].keys()) == {str(run_id) for run_id in run_ids}
        assert all(cell["status"] == "not_started" for cell in row["results"].values())

    # Child runs exist, are linked back, and carry their environment + snapshot.
    for run_id, env_id in zip(run_ids, env_ids):
        run = client.get(f"/test-runs/{run_id}")
        assert run.status_code == 200, run.text
        assert run.json()["matrix_run_id"] == matrix_id
        assert run.json()["environment_id"] == env_id
        snapshot = client.get(f"/test-runs/{run_id}/environment")
        assert snapshot.status_code == 200, snapshot.text

    # Execute one case on the first environment; the pivot reflects it.
    first_run_results = client.get(f"/test-results?test_run_id={run_ids[0]}").json()
    target = next(r for r in first_run_results if r["test_case_id"] == case_ids[0])
    updated = client.put(f"/test-results/{target['id']}", json={"status": "pass"})
    assert updated.status_code == 200, updated.text

    detail = client.get(f"/matrix-runs/{matrix_id}")
    assert detail.status_code == 200, detail.text
    detail = detail.json()
    assert detail["status"] == "in_progress"
    row = next(r for r in detail["rows"] if r["test_case_id"] == case_ids[0])
    assert row["results"][str(run_ids[0])]["status"] == "pass"
    assert row["results"][str(run_ids[1])]["status"] == "not_started"
    col = next(c for c in detail["environments"] if c["test_run_id"] == run_ids[0])
    assert col["passed_tests"] == 1 and col["progress_percent"] == 33

    # List endpoint aggregates without rows.
    listed = client.get(f"/matrix-runs?project_id={client.project_id}")
    assert listed.status_code == 200, listed.text
    assert [m["id"] for m in listed.json()] == [matrix_id]

    # seq resolver works for matrix-runs
    resolved = client.get(f"/projects/{client.project_id}/lookup/matrix-runs/1")
    assert resolved.status_code == 200 and resolved.json()["id"] == matrix_id

    # Delete removes the matrix and its child runs.
    deleted = client.delete(f"/matrix-runs/{matrix_id}")
    assert deleted.status_code == 200, deleted.text
    assert client.get(f"/matrix-runs/{matrix_id}").status_code == 404
    for run_id in run_ids:
        assert client.get(f"/test-runs/{run_id}").status_code == 404


def test_matrix_run_validation(client):
    case_ids, env_ids = _seed_suite_cases_envs(client)

    # Unknown environment
    bad_env = client.post("/matrix-runs", json={
        "project_id": client.project_id,
        "name": "Bad env",
        "environment_ids": [999999],
        "test_case_ids": case_ids,
    })
    assert bad_env.status_code == 404

    # Unknown test case
    bad_case = client.post("/matrix-runs", json={
        "project_id": client.project_id,
        "name": "Bad case",
        "environment_ids": env_ids,
        "test_case_ids": [999999],
    })
    assert bad_case.status_code == 404

    # Empty lists rejected by schema validation
    empty = client.post("/matrix-runs", json={
        "project_id": client.project_id,
        "name": "Empty",
        "environment_ids": [],
        "test_case_ids": case_ids,
    })
    assert empty.status_code == 422

    # Duplicated environment ids collapse to one column
    duplicated = client.post("/matrix-runs", json={
        "project_id": client.project_id,
        "name": "Deduped",
        "environment_ids": [env_ids[0], env_ids[0]],
        "test_case_ids": case_ids,
    })
    assert duplicated.status_code == 200, duplicated.text
    assert len(duplicated.json()["environments"]) == 1
