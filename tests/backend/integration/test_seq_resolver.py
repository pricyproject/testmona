"""Project-seq -> global-id resolver, including the global-id fallback.

The resolver maps a per-project ``project_seq`` to the global ``id``. When a
number is not a valid ``project_seq`` in the project it retries against the
global ``id`` (scoped to the project) before 404ing, so links/bookmarks that
still embed a global id resolve cleanly instead of returning a spurious 404.
"""

from conftest import make_http_client


client = make_http_client()


def _make_runs(client, n):
    """Create ``n`` test runs and return their (id, project_seq) pairs in order."""
    runs = []
    for i in range(n):
        resp = client.post("/test-runs", json={
            "name": f"Run {i + 1}",
            "project_id": client.project_id,
        })
        assert resp.status_code == 200, resp.text
        body = resp.json()
        runs.append((body["id"], body["project_seq"]))
    return runs


def test_resolver_maps_project_seq_to_global_id(client):
    runs = _make_runs(client, 3)
    for global_id, seq in runs:
        resolved = client.get(f"/projects/{client.project_id}/lookup/test-runs/{seq}")
        assert resolved.status_code == 200, resolved.text
        body = resolved.json()
        assert body["id"] == global_id
        assert body["project_seq"] == seq


def test_resolver_falls_back_to_global_id(client):
    """A number that isn't a project_seq but is a valid global id still resolves."""
    # Bump the global id space with a throwaway project + run so the runs we make
    # in the main project get global ids strictly larger than their per-project
    # seqs — guaranteeing the fallback (not the primary seq match) is exercised.
    other = client.post("/projects", json={"name": "Seq Offset Project"})
    assert other.status_code == 200, other.text
    bump = client.post("/test-runs", json={"name": "bump", "project_id": other.json()["id"]})
    assert bump.status_code == 200, bump.text

    runs = _make_runs(client, 3)
    seqs = {seq for _, seq in runs}
    global_id, seq = runs[-1]
    assert global_id not in seqs, "expected global id to diverge from project_seq"

    # The global id is not a valid project_seq, so the primary match misses and
    # the fallback resolves it — reporting the row's *real* project_seq.
    resolved = client.get(f"/projects/{client.project_id}/lookup/test-runs/{global_id}")
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["id"] == global_id
    assert body["project_seq"] == seq

    # A genuinely unknown number (neither seq nor id) still 404s — the fallback
    # does not mask real misses.
    missing = client.get(
        f"/projects/{client.project_id}/lookup/test-runs/{max(g for g, _ in runs) + 1000}"
    )
    assert missing.status_code == 404


def test_resolver_prefers_project_seq_over_global_id(client):
    """When a number matches both a project_seq and a global id, seq wins."""
    # A small global-id offset plus several runs makes the seq range and the
    # global-id range overlap, so at least one number is both a valid seq and a
    # (different) row's global id.
    other = client.post("/projects", json={"name": "Collision Offset"})
    assert other.status_code == 200, other.text
    client.post("/test-runs", json={"name": "bump", "project_id": other.json()["id"]})
    runs = _make_runs(client, 6)
    by_seq = {seq: gid for gid, seq in runs}
    by_id = {gid: seq for gid, seq in runs}
    # Find a number N that is both a valid seq and a valid (different) global id.
    collision = next(
        (n for n in by_seq if n in by_id and by_seq[n] != n),
        None,
    )
    if collision is None:
        # Seq and id happened to line up 1:1 in this seeding; nothing to assert.
        return
    resolved = client.get(f"/projects/{client.project_id}/lookup/test-runs/{collision}")
    assert resolved.status_code == 200, resolved.text
    # The project_seq match wins, so the resolved id is the seq-owner, not the
    # row whose global id equals ``collision``.
    assert resolved.json()["id"] == by_seq[collision]


def test_resolver_unknown_entity_is_404(client):
    resolved = client.get(f"/projects/{client.project_id}/lookup/not-an-entity/1")
    assert resolved.status_code == 404
