"""Integration tests for the normalized test-case tag system.

Covers: create/list with normalized tags, get-or-create dedupe (case/space
collapse), the project tag catalog with usage counts, rename re-syncing the
denormalized ``tags_cache``, merge repointing cases, delete cascading, bulk
add/remove, and TQL ``tag:`` search hitting the cache.
"""

from conftest import make_http_client

client = make_http_client()


def _make_suite(client, project_id, name="S1"):
    resp = client.post("/test-suites", json={"name": name, "project_id": project_id})
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def _make_case(client, suite_id, title, tags):
    resp = client.post("/test-cases", json={
        "title": title, "test_suite_id": suite_id, "tags": tags,
    })
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def test_create_returns_normalized_tag_objects_and_dedupes(client):
    suite_id = _make_suite(client, client.project_id)
    # "Smoke" / "smoke" / " smoke " collapse to one tag; order preserved.
    case = _make_case(client, suite_id, "Login", ["Smoke", "regression", "smoke", " smoke "])
    names = [t["name"] for t in case["tags"]]
    assert names == ["Smoke", "regression"]
    for t in case["tags"]:
        assert t["id"] and t["color"].startswith("#") and t["slug"]


def test_catalog_lists_usage_counts_and_reuses_tags_across_cases(client):
    suite_id = _make_suite(client, client.project_id)
    _make_case(client, suite_id, "A", ["smoke", "ui"])
    _make_case(client, suite_id, "B", ["smoke"])

    catalog = client.get(f"/tags?project_id={client.project_id}").json()
    by_name = {t["name"]: t for t in catalog}
    assert by_name["smoke"]["usage_count"] == 2
    assert by_name["ui"]["usage_count"] == 1
    # "smoke" is one shared row, not duplicated per case.
    assert sum(1 for t in catalog if t["name"] == "smoke") == 1


def test_rename_tag_resyncs_cache_and_search(client):
    suite_id = _make_suite(client, client.project_id)
    case = _make_case(client, suite_id, "A", ["smoke"])
    tag_id = case["tags"][0]["id"]

    resp = client.put(f"/tags/{tag_id}", json={"name": "smoke-test"})
    assert resp.status_code == 200, resp.text

    refreshed = client.get(f"/test-cases/{case['id']}").json()
    assert [t["name"] for t in refreshed["tags"]] == ["smoke-test"]
    # The denormalized cache (and thus TQL search) followed the rename.
    hits = client.get(f'/advanced-search?entity=test_cases&q=tag:smoke-test&project_id={client.project_id}')
    assert hits.status_code == 200, hits.text
    assert any(r["id"] == case["id"] for r in hits.json()["results"])


def test_merge_repoints_cases_and_removes_source(client):
    suite_id = _make_suite(client, client.project_id)
    case = _make_case(client, suite_id, "A", ["old", "keep"])
    tags = {t["name"]: t["id"] for t in case["tags"]}

    resp = client.post(f"/tags/{tags['old']}/merge", json={"target_id": tags["keep"]})
    assert resp.status_code == 200, resp.text

    refreshed = client.get(f"/test-cases/{case['id']}").json()
    assert [t["name"] for t in refreshed["tags"]] == ["keep"]
    catalog_names = [t["name"] for t in client.get(f"/tags?project_id={client.project_id}").json()]
    assert "old" not in catalog_names


def test_delete_tag_detaches_from_cases(client):
    suite_id = _make_suite(client, client.project_id)
    case = _make_case(client, suite_id, "A", ["doomed", "kept"])
    doomed = next(t["id"] for t in case["tags"] if t["name"] == "doomed")

    assert client.delete(f"/tags/{doomed}").status_code == 200
    refreshed = client.get(f"/test-cases/{case['id']}").json()
    assert [t["name"] for t in refreshed["tags"]] == ["kept"]


def test_duplicate_tag_name_returns_409(client):
    project_id = client.project_id
    first = client.post("/tags", json={"project_id": project_id, "name": "Flaky"})
    assert first.status_code == 200, first.text
    dup = client.post("/tags", json={"project_id": project_id, "name": "flaky"})
    assert dup.status_code == 409, dup.text


def test_bulk_add_and_remove_tags(client):
    suite_id = _make_suite(client, client.project_id)
    a = _make_case(client, suite_id, "A", ["keep"])
    b = _make_case(client, suite_id, "B", ["keep", "drop"])

    resp = client.patch("/test-cases/bulk", json={
        "ids": [a["id"], b["id"]], "add_tags": ["added"], "remove_tags": ["drop"],
    })
    assert resp.status_code == 200, resp.text

    a2 = client.get(f"/test-cases/{a['id']}").json()
    b2 = client.get(f"/test-cases/{b['id']}").json()
    assert set(t["name"] for t in a2["tags"]) == {"keep", "added"}
    assert set(t["name"] for t in b2["tags"]) == {"keep", "added"}


def test_update_clears_tags_with_empty_list(client):
    suite_id = _make_suite(client, client.project_id)
    case = _make_case(client, suite_id, "A", ["a", "b"])
    resp = client.put(f"/test-cases/{case['id']}", json={"tags": []})
    assert resp.status_code == 200, resp.text
    assert resp.json()["tags"] == []
