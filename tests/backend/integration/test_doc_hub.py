"""End-to-end tests for the Doc Hub: spaces, docs, versioning, the
doc→requirement converter (single + split), and Markdown import/export.

Self-contained: builds a fresh in-file SQLite DB and overrides the ``get_db``
and auth dependencies, so it does not depend on import order or the dev DB.
"""

import io
import os
import tempfile
import zipfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture()
def client():
    from app.database import Base, get_db
    from app.auth import get_current_active_user, get_current_user
    from app import models
    import app.main as main

    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    engine = create_engine(
        f"sqlite:///{path}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    db = TestingSession()
    user = models.User(username="admin", email="a@b.c", hashed_password="x",
                       role="admin", is_active=True, full_name="Admin")
    db.add(user)
    db.commit()
    db.refresh(user)
    project = models.Project(name="Proj", description="d", owner_id=user.id)
    db.add(project)
    db.commit()
    db.refresh(project)
    # A second, non-admin project member used to test @mentions (the actor is
    # never notified) and the admin-only statistics gate.
    member = models.User(username="bob", email="bob@b.c", hashed_password="x",
                         role="user", is_active=True, full_name="Bob")
    db.add(member)
    db.commit()
    db.refresh(member)
    db.add(models.ProjectAssignment(project_id=project.id, user_id=member.id))
    db.commit()
    uid, pid, mid = user.id, project.id, member.id
    db.close()

    def override_db():
        d = TestingSession()
        try:
            yield d
        finally:
            d.close()

    def override_user():
        d = TestingSession()
        try:
            return d.query(models.User).filter(models.User.id == uid).first()
        finally:
            d.close()

    main.app.dependency_overrides[get_db] = override_db
    main.app.dependency_overrides[get_current_active_user] = override_user
    main.app.dependency_overrides[get_current_user] = override_user
    c = TestClient(main.app)
    c.project_id = pid  # type: ignore[attr-defined]
    c.member_id = mid  # type: ignore[attr-defined]
    c.member_username = "bob"  # type: ignore[attr-defined]
    c.SessionLocal = TestingSession  # type: ignore[attr-defined]
    c.set_current_user = (  # type: ignore[attr-defined]
        lambda user_id: [
            main.app.dependency_overrides.__setitem__(
                dependency,
                lambda user_id=user_id: TestingSession().query(models.User).filter(models.User.id == user_id).first(),
            )
            for dependency in (get_current_active_user, get_current_user)
        ]
    )
    try:
        yield c
    finally:
        main.app.dependency_overrides.clear()
        engine.dispose()
        os.unlink(path)


def test_space_and_doc_crud_with_versioning(client):
    # Global space
    space = client.post("/docs/spaces", json={"name": "KB", "classification": "internal"}).json()
    assert space["project_id"] is None
    assert space["slug"] == "kb"

    # Project space
    psp = client.post("/docs/spaces", json={"name": "Proj Docs", "project_id": client.project_id}).json()

    doc = client.post("/docs", json={
        "title": "Login Spec", "content_markdown": "# Login\n\nbody", "space_id": psp["id"], "tags": "auth",
    }).json()
    assert doc["current_version"] == 1
    assert doc["project_id"] == client.project_id

    # Update creates a new version
    updated = client.put(f"/docs/{doc['id']}", json={"content_markdown": "# Login\n\nbody v2"}).json()
    assert updated["current_version"] == 2

    versions = client.get(f"/docs/{doc['id']}/versions").json()
    assert [v["version_number"] for v in versions] == [2, 1]

    # Restore v1
    restored = client.post(f"/docs/{doc['id']}/versions/{versions[-1]['id']}/restore", json={}).json()
    assert restored["current_version"] == 3  # restore writes a fresh version


def _set_project_features(client, features):
    from app import models
    db = client.SessionLocal()
    try:
        project = db.query(models.Project).filter(models.Project.id == client.project_id).first()
        project.features = features
        db.commit()
    finally:
        db.close()


def test_create_named_milestone_revision(client):
    psp = client.post("/docs/spaces", json={"name": "S", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Spec", "content_markdown": "# A\n\nbody", "space_id": psp["id"]}).json()
    assert doc["current_version"] == 1

    # A named revision is forced — it records even with no content change.
    resp = client.post(f"/docs/{doc['id']}/versions", json={"name": "Approved draft", "change_note": "Sign-off"})
    assert resp.status_code == 201
    rev = resp.json()
    assert rev["action"] == "snapshot"
    assert rev["name"] == "Approved draft"
    assert rev["change_note"] == "Sign-off"
    assert rev["version_number"] == 2

    versions = client.get(f"/docs/{doc['id']}/versions").json()
    assert versions[0]["name"] == "Approved draft"
    assert versions[0]["action"] == "snapshot"


def test_doc_revisions_feature_toggle(client):
    psp = client.post("/docs/spaces", json={"name": "S", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Spec", "content_markdown": "v1", "space_id": psp["id"]}).json()

    _set_project_features(client, {"doc_revisions": False})

    # Detail reports the toggle so the UI can hide the history.
    detail = client.get(f"/docs/{doc['id']}").json()
    assert detail["revisions_enabled"] is False

    # Edits no longer snapshot while revisions are disabled.
    updated = client.put(f"/docs/{doc['id']}", json={"content_markdown": "v2"}).json()
    assert updated["content_markdown"] == "v2"
    versions = client.get(f"/docs/{doc['id']}/versions").json()
    assert [v["version_number"] for v in versions] == [1]

    # Revision-mutating endpoints are gated.
    assert client.post(f"/docs/{doc['id']}/versions", json={"name": "x"}).status_code == 403
    assert client.delete(f"/docs/{doc['id']}/versions").status_code == 403

    # Re-enabling resumes snapshots from the existing baseline.
    _set_project_features(client, {"doc_revisions": True})
    client.put(f"/docs/{doc['id']}", json={"content_markdown": "v3"})
    versions = client.get(f"/docs/{doc['id']}/versions").json()
    assert [v["version_number"] for v in versions] == [2, 1]


def test_space_update_regenerates_slug_and_validates_color(client):
    a = client.post("/docs/spaces", json={"name": "Guides", "project_id": client.project_id}).json()
    b = client.post("/docs/spaces", json={"name": "Runbooks", "project_id": client.project_id}).json()
    assert a["slug"] == "guides"

    # Renaming regenerates the slug; colliding with a sibling gets a suffix.
    renamed = client.put(f"/docs/spaces/{a['id']}", json={"name": "Handbook"}).json()
    assert renamed["slug"] == "handbook"
    collided = client.put(f"/docs/spaces/{b['id']}", json={"name": "Handbook"}).json()
    assert collided["slug"] == "handbook-2"

    # Updating without a name change keeps the slug stable.
    same = client.put(f"/docs/spaces/{a['id']}", json={"description": "All the docs"}).json()
    assert same["slug"] == "handbook"
    assert same["description"] == "All the docs"

    # Color must be a hex value; valid input is normalised to lowercase.
    assert client.put(f"/docs/spaces/{a['id']}", json={"color": "tomato"}).status_code == 422
    colored = client.put(f"/docs/spaces/{a['id']}", json={"color": "#0EA5E9", "icon": "📘"}).json()
    assert colored["color"] == "#0ea5e9"
    assert colored["icon"] == "📘"


def test_space_listing_includes_stats(client):
    space = client.post("/docs/spaces", json={"name": "Stats", "project_id": client.project_id}).json()
    client.post("/docs/folders", json={"space_id": space["id"], "name": "F1"})
    client.post("/docs", json={"title": "D1", "space_id": space["id"], "status": "published"})
    client.post("/docs", json={"title": "D2", "space_id": space["id"], "status": "published"})
    client.post("/docs", json={"title": "D3", "space_id": space["id"]})  # draft

    listed = {s["id"]: s for s in client.get("/docs/spaces", params={"project_id": client.project_id}).json()}
    s = listed[space["id"]]
    assert s["doc_count"] == 3
    assert s["published_count"] == 2
    assert s["draft_count"] == 1
    assert s["archived_count"] == 0
    assert s["folder_count"] == 1
    assert s["last_doc_updated_at"] is not None

    fetched = client.get(f"/docs/spaces/{space['id']}").json()
    assert fetched["doc_count"] == 3 and fetched["folder_count"] == 1


def test_space_reorder(client):
    ids = [
        client.post("/docs/spaces", json={"name": n, "project_id": client.project_id}).json()["id"]
        for n in ("One", "Two", "Three")
    ]

    new_order = [ids[2], ids[0], ids[1]]
    resp = client.post("/docs/spaces/reorder", json={"space_ids": new_order})
    assert resp.status_code == 200
    assert [s["id"] for s in resp.json()] == new_order
    assert [s["order_index"] for s in resp.json()] == [0, 1, 2]

    listed = client.get("/docs/spaces", params={"project_id": client.project_id, "include_global": False}).json()
    assert [s["id"] for s in listed] == new_order

    # Duplicates and unknown spaces are rejected.
    assert client.post("/docs/spaces/reorder", json={"space_ids": [ids[0], ids[0]]}).status_code == 422
    assert client.post("/docs/spaces/reorder", json={"space_ids": [999999]}).status_code == 404


def test_convert_single_and_split(client):
    psp = client.post("/docs/spaces", json={"name": "S", "project_id": client.project_id}).json()
    md = "# Title\n\nIntro.\n\n## Feature A\n\nA body\n\n## Acceptance Criteria\n\n- ok"
    doc = client.post("/docs", json={"title": "Spec", "content_markdown": md, "space_id": psp["id"]}).json()

    # Single: main requirement + acceptance criteria routed
    preview = client.post(f"/docs/{doc['id']}/convert-to-requirements/preview",
                          json={"mode": "single", "heading_level": 2}).json()
    assert any(i["is_acceptance_criteria"] for i in preview["items"])

    res = client.post(f"/docs/{doc['id']}/convert-to-requirements",
                     json={"mode": "single", "heading_level": 2}).json()
    assert len(res["created"]) == 1
    assert res["created"][0]["requirement_id"].startswith("REQ-")

    # Split: one requirement per H2 section
    res2 = client.post(f"/docs/{doc['id']}/convert-to-requirements",
                      json={"mode": "split", "heading_level": 2}).json()
    titles = {r["title"] for r in res2["created"]}
    assert "Feature A" in titles

    links = client.get(f"/docs/{doc['id']}/requirement-links").json()
    assert len(links) == len(res["created"]) + len(res2["created"])


def test_convert_auto_level_and_split_acceptance(client):
    """heading_level=0 auto-detects the split level, split sections carry their
    own extracted acceptance criteria, and titles are cleaned of numbering."""
    psp = client.post("/docs/spaces", json={"name": "S", "project_id": client.project_id}).json()
    md = (
        "# 1. Login\n\nUser logs in.\n\n## Acceptance Criteria\n- valid creds work\n\n"
        "# 2. Checkout\n\nUser pays.\n"
    )
    doc = client.post("/docs", json={"title": "Spec", "content_markdown": md, "space_id": psp["id"]}).json()

    # Auto level picks H1 → two sections; numbering stripped from titles.
    preview = client.post(f"/docs/{doc['id']}/convert-to-requirements/preview",
                          json={"mode": "split", "heading_level": 0}).json()
    titles = {i["title"] for i in preview["items"]}
    assert "Login" in titles and "Checkout" in titles
    login = next(i for i in preview["items"] if i["title"] == "Login")
    assert "valid creds work" in login["acceptance_html"]

    res = client.post(f"/docs/{doc['id']}/convert-to-requirements",
                      json={"mode": "split", "heading_level": 0}).json()
    created = {r["title"]: r for r in res["created"]}
    assert "valid creds work" in (created["Login"]["acceptance_criteria"] or "")


def test_convert_split_folds_same_level_acceptance(client):
    """A sibling '## Acceptance Criteria' folds into the preceding requirement
    rather than becoming its own, and an empty doc never crashes."""
    psp = client.post("/docs/spaces", json={"name": "S", "project_id": client.project_id}).json()
    md = "## Feature A\nBody A.\n\n## Acceptance Criteria\n- A works\n\n## Feature B\nBody B.\n"
    doc = client.post("/docs", json={"title": "Spec", "content_markdown": md, "space_id": psp["id"]}).json()
    preview = client.post(f"/docs/{doc['id']}/convert-to-requirements/preview",
                          json={"mode": "split", "heading_level": 2}).json()
    titles = [i["title"] for i in preview["items"]]
    assert titles == ["Feature A", "Feature B"]  # AC folded, not a 3rd requirement
    feat_a = preview["items"][0]
    assert "A works" in feat_a["acceptance_html"]

    res = client.post(f"/docs/{doc['id']}/convert-to-requirements",
                      json={"mode": "split", "heading_level": 2}).json()
    created = {r["title"]: r for r in res["created"]}
    assert "A works" in (created["Feature A"]["acceptance_criteria"] or "")

    # Blank document: still yields exactly one (title-only) requirement, no error.
    blank = client.post("/docs", json={"title": "Blank", "content_markdown": "   ",
                                       "space_id": psp["id"]}).json()
    blank_res = client.post(f"/docs/{blank['id']}/convert-to-requirements", json={"mode": "split"}).json()
    assert len(blank_res["created"]) == 1


def test_convert_overrides_and_extra_items(client):
    """Per-item HTML overrides and extra (AI-suggested) requirements are persisted."""
    psp = client.post("/docs/spaces", json={"name": "S", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Spec", "content_markdown": "# A\n\nbody",
                                     "space_id": psp["id"]}).json()
    res = client.post(f"/docs/{doc['id']}/convert-to-requirements", json={
        "mode": "single",
        "items": [{"index": 0, "title": "Refined", "include": True,
                   "description_html": "<p>refined body</p>",
                   "acceptance_html": "<ul><li>crit</li></ul>"}],
        "extra_items": [{"title": "Rate limiting", "description_html": "<p>limit</p>",
                         "acceptance_html": "<p>block after 5</p>"}],
    }).json()
    by_title = {r["title"]: r for r in res["created"]}
    assert "Refined" in by_title and "Rate limiting" in by_title
    assert "refined body" in by_title["Refined"]["description"]
    assert "crit" in (by_title["Refined"]["acceptance_criteria"] or "")
    assert "limit" in by_title["Rate limiting"]["description"]


def test_convert_enhance_skips_without_ai(client):
    """The AI enhancement endpoint degrades gracefully when no provider is set."""
    psp = client.post("/docs/spaces", json={"name": "S", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Spec", "content_markdown": "# A\n\nbody",
                                     "space_id": psp["id"]}).json()
    out = client.post(f"/docs/{doc['id']}/convert-to-requirements/enhance",
                      json={"mode": "single"}).json()
    assert out["ai_available"] is False
    assert out["ai_skipped_reason"] in {"ai_unavailable", "ask_ai_disabled"}
    assert out["items"] == [] and out["suggested_requirements"] == []


def test_extract_json_object_repairs_malformed_model_output():
    """Weaker models (e.g. huggingface ``gpt-oss-20b``) intermittently emit
    not-quite-valid JSON. ``extract_json_object`` must salvage it rather than
    fail the whole call, while leaving valid JSON untouched and still rejecting
    genuine garbage."""
    from app.services.ai_prompt_service import extract_json_object

    # Valid JSON (incl. code fences) parses unchanged.
    assert extract_json_object('{"a": 1, "b": [2, 3]}') == {"a": 1, "b": [2, 3]}
    assert extract_json_object('```json\n{"a": 1}\n```') == {"a": 1}

    # Dropped array-closing bracket — the observed failure mode: the model
    # writes `"items":[{...},"suggested_requirements":...` (no `]`).
    dropped = '{"items": [{"index": 0, "quality": 80}, "suggested_requirements": [{"title": "X"}]}'
    parsed = extract_json_object(dropped)
    assert isinstance(parsed, dict) and parsed.get("items")

    # Truncated mid-output (finish_reason="length") after a completed inner
    # object — the outer array/object never closes, but the inner `}` bounds a
    # candidate the repairer can salvage.
    truncated = ('{"summary": "ok", "items": [{"index": 0, "quality": 70}], '
                 '"suggested_requirements": [{"title": "Partial spec')
    assert isinstance(extract_json_object(truncated), dict)

    # Genuine non-JSON still raises so the caller degrades gracefully.
    with pytest.raises(ValueError):
        extract_json_object("there is no json here")


def test_provider_is_usable_predicate():
    from app.services.ai_manager import _provider_is_usable

    assert _provider_is_usable("huggingface", {"enabled": True, "api_key": "k"}) is True
    assert _provider_is_usable("huggingface", {"enabled": True, "api_key": None}) is False  # needs key
    assert _provider_is_usable("huggingface", {"enabled": False, "api_key": "k"}) is False  # disabled
    assert _provider_is_usable("litellm", {"enabled": True, "api_key": None}) is True        # no key required
    assert _provider_is_usable("openai", {}) is False


def test_saving_only_provider_makes_it_active(client):
    """Fresh-install convenience: configuring and saving a single provider while
    the active provider still points at the default (openai) auto-activates the
    saved one, so AI isn't reported unavailable right after setup."""
    res = client.put("/ai-manager/settings", json={
        "active_provider": "openai",  # the unconfigured default
        "providers": [{"provider": "huggingface", "enabled": True, "api_key": "hf-secret"}],
    })
    assert res.status_code == 200, res.text
    assert res.json()["active_provider"] == "huggingface"

    # An explicitly-chosen, usable active provider is respected (not overridden).
    res2 = client.put("/ai-manager/settings", json={
        "active_provider": "litellm",  # enabled below, needs no key
        "providers": [
            {"provider": "huggingface", "enabled": True, "api_key": "hf-secret"},
            {"provider": "litellm", "enabled": True},
        ],
    })
    assert res2.status_code == 200, res2.text
    assert res2.json()["active_provider"] == "litellm"


def test_release_notes_generate_edit_publish_lifecycle(client):
    pid = client.project_id
    psp = client.post("/docs/spaces", json={"name": "RN", "project_id": pid}).json()
    doc = client.post("/docs", json={
        "title": "Checkout flow", "content_markdown": "# Checkout\n\nv1", "space_id": psp["id"],
    }).json()
    # A second version so the doc shows as "changed" in the window.
    client.put(f"/docs/{doc['id']}", json={"content_markdown": "# Checkout\n\nv2\n\n## New rule\n\nx"})

    # Generate a preview (AI is unavailable in tests → ai_skipped_reason set, draft still produced).
    gen = client.post("/docs/release-notes/generate", json={"project_id": pid, "include_ai": True})
    assert gen.status_code == 200, gen.text
    preview = gen.json()
    assert preview["title"]
    assert "Checkout flow" in preview["content_markdown"]
    titles = {d["title"] for d in preview["source"]["changed_docs"]}
    assert "Checkout flow" in titles
    assert preview["ai_available"] is False
    assert preview["ai_skipped_reason"] is not None

    # Save an edited draft.
    created = client.post("/docs/release-notes", json={
        "project_id": pid,
        "title": "Release 1.0",
        "version": "v1.0.0",
        "content_markdown": preview["content_markdown"] + "\n\nEdited.",
        "source_data": preview["source"],
        "range_start": preview["source"]["range_start"],
        "range_end": preview["source"]["range_end"],
    })
    assert created.status_code == 201, created.text
    note = created.json()
    assert note["status"] == "draft"
    note_id = note["id"]

    # List shows the draft.
    listed = client.get("/docs/release-notes", params={"project_id": pid}).json()
    assert any(n["id"] == note_id for n in listed)

    # Edit it.
    upd = client.put(f"/docs/release-notes/{note_id}", json={"title": "Release 1.0 final"}).json()
    assert upd["title"] == "Release 1.0 final"

    # Publish, then it shows under the published filter with a timestamp.
    pub = client.post(f"/docs/release-notes/{note_id}/publish").json()
    assert pub["status"] == "published"
    assert pub["published_at"] is not None
    published = client.get("/docs/release-notes", params={"project_id": pid, "status": "published"}).json()
    assert any(n["id"] == note_id for n in published)

    # Unpublish back to draft.
    un = client.post(f"/docs/release-notes/{note_id}/unpublish").json()
    assert un["status"] == "draft"
    assert un["published_at"] is None

    # Delete.
    assert client.delete(f"/docs/release-notes/{note_id}").status_code == 204
    assert client.get(f"/docs/release-notes/{note_id}").status_code == 404


def test_release_notes_route_not_shadowed_by_doc_id(client):
    # "/docs/release-notes" must not be parsed as "/docs/{doc_id}".
    pid = client.project_id
    assert client.get("/docs/release-notes", params={"project_id": pid}).status_code == 200


def test_release_notes_generate_with_no_changes(client):
    # A project with no doc activity still produces an (empty) draft.
    pid = client.project_id
    gen = client.post("/docs/release-notes/generate", json={"project_id": pid, "include_ai": True})
    assert gen.status_code == 200, gen.text
    body = gen.json()
    assert body["source"]["changed_docs"] == []
    assert body["ai_skipped_reason"] == "no_changes"
    assert "No documented changes" in body["content_markdown"]


def test_release_notes_generate_window_swap_and_custom_range(client):
    # since > until is tolerated (the service swaps them) and the echoed range is ordered.
    pid = client.project_id
    gen = client.post("/docs/release-notes/generate", json={
        "project_id": pid,
        "since": "2030-01-01T00:00:00Z",
        "until": "2020-01-01T00:00:00Z",
    })
    assert gen.status_code == 200, gen.text
    src = gen.json()["source"]
    assert src["range_start"] <= src["range_end"]


def test_release_notes_blank_title_rejected(client):
    pid = client.project_id
    bad = client.post("/docs/release-notes", json={"project_id": pid, "title": "   "})
    assert bad.status_code == 422
    # version of only-whitespace is normalised to null, not stored as "".
    ok = client.post("/docs/release-notes", json={"project_id": pid, "title": "Rel", "version": "   "})
    assert ok.status_code == 201
    assert ok.json()["version"] is None


def test_release_notes_publish_is_idempotent(client):
    pid = client.project_id
    note = client.post("/docs/release-notes", json={"project_id": pid, "title": "Rel"}).json()
    first = client.post(f"/docs/release-notes/{note['id']}/publish").json()
    assert first["status"] == "published" and first["published_at"]
    # Editing then re-publishing must not rewrite the original publish timestamp.
    client.put(f"/docs/release-notes/{note['id']}", json={"title": "Rel v2"})
    second = client.post(f"/docs/release-notes/{note['id']}/publish").json()
    assert second["published_at"] == first["published_at"]


def test_release_notes_feature_toggle_enforced(client):
    pid = client.project_id
    # Disable doc_hub for the project.
    db = client.SessionLocal()
    from app import models
    proj = db.query(models.Project).filter(models.Project.id == pid).first()
    proj.features = {"doc_hub": False}
    db.commit()
    db.close()
    assert client.post("/docs/release-notes/generate", json={"project_id": pid}).status_code == 403
    assert client.post("/docs/release-notes", json={"project_id": pid, "title": "X"}).status_code == 403


def test_release_notes_missing_and_cross_project(client):
    pid = client.project_id
    # 404s for every by-id route on a non-existent note.
    assert client.get("/docs/release-notes/999999").status_code == 404
    assert client.put("/docs/release-notes/999999", json={"title": "x"}).status_code == 404
    assert client.post("/docs/release-notes/999999/publish").status_code == 404
    assert client.post("/docs/release-notes/999999/unpublish").status_code == 404
    assert client.delete("/docs/release-notes/999999").status_code == 404
    # Unknown project for generate/create → 404.
    assert client.post("/docs/release-notes/generate", json={"project_id": 999999}).status_code == 404
    assert client.post("/docs/release-notes", json={"project_id": 999999, "title": "x"}).status_code == 404
    # A note in this project is not listed under a different project_id.
    note = client.post("/docs/release-notes", json={"project_id": pid, "title": "Mine"}).json()
    other = client.get("/docs/release-notes", params={"project_id": 999999})
    assert all(n["id"] != note["id"] for n in (other.json() if other.status_code == 200 else []))


def test_release_notes_invalid_status_filter(client):
    pid = client.project_id
    assert client.get("/docs/release-notes", params={"project_id": pid, "status": "bogus"}).status_code == 400


def test_release_notes_full_graph(client):
    """A linked requirement pulls in its resolved defect, an open known issue,
    and coverage stats — and known issues are ordered riskiest-first."""
    pid = client.project_id
    psp = client.post("/docs/spaces", json={"name": "G", "project_id": pid}).json()
    doc = client.post("/docs", json={
        "title": "Payments", "content_markdown": "# Payments\n\nRules.", "space_id": psp["id"],
    }).json()
    req = client.post(f"/docs/{doc['id']}/convert-to-requirements", json={"mode": "single"}).json()["created"][0]
    req_id = req["id"]

    from app import models
    db = client.SessionLocal()
    db.add_all([
        models.Defect(title="Crash on pay", defect_id="DEF-100", project_id=pid,
                      requirement_id=req_id, reported_by=client.member_id,
                      status=models.DefectStatus.FIXED, severity=models.DefectSeverity.HIGH),
        models.Defect(title="Slow checkout", defect_id="DEF-101", project_id=pid,
                      requirement_id=req_id, reported_by=client.member_id,
                      status=models.DefectStatus.OPEN, severity=models.DefectSeverity.LOW),
        models.Defect(title="Data loss", defect_id="DEF-102", project_id=pid,
                      requirement_id=req_id, reported_by=client.member_id,
                      status=models.DefectStatus.IN_PROGRESS, severity=models.DefectSeverity.CRITICAL),
    ])
    db.commit()
    db.close()

    src = client.post("/docs/release-notes/generate", json={"project_id": pid}).json()["source"]
    assert any(r["key"] == req["requirement_id"] for r in src["requirements"])
    assert {d["key"] for d in src["resolved_defects"]} == {"DEF-100"}
    open_keys = [d["key"] for d in src["open_defects"]]
    assert set(open_keys) == {"DEF-101", "DEF-102"}
    # Critical before low.
    assert open_keys[0] == "DEF-102"
    # The requirement has no test cases → counted as uncovered.
    cov = src["coverage"]
    assert cov["requirements_total"] >= 1
    assert cov["requirements_uncovered"] == cov["requirements_total"]


def test_impact_similarity_precision(client):
    """TF-IDF cosine should match topically-distinctive requirements and reject
    generic ones that only share common words (the old overlap-coefficient bug)."""
    pid = client.project_id
    psp = client.post("/docs/spaces", json={"name": "S", "project_id": pid}).json()
    doc = client.post("/docs", json={
        "title": "TikTok Login",
        "content_markdown": "# TikTok Login\n\nTikTok app login oauth signin credentials flow",
        "space_id": psp["id"],
    }).json()

    from app import models
    db = client.SessionLocal()
    db.add_all([
        models.Requirement(title="TikTok OAuth login support", requirement_id="REQ-TT",
                           project_id=pid, created_by=client.member_id,
                           status=models.RequirementStatus.DRAFT),
        models.Requirement(title="Summarize this project", requirement_id="REQ-GEN",
                           project_id=pid, created_by=client.member_id,
                           status=models.RequirementStatus.DRAFT),
    ])
    db.commit()
    db.close()

    resp = client.post(f"/docs/{doc['id']}/impact-analysis", json={"include_ai": False})
    assert resp.status_code == 200, resp.text
    by_key = {r["key"]: r for r in resp.json()["requirements"]}
    # Distinctive shared vocabulary ("tiktok", "oauth", "login") → matched.
    assert "REQ-TT" in by_key and by_key["REQ-TT"]["reason"] == "similar"
    # Only shares generic words ("this", "project") → no longer a false positive.
    assert "REQ-GEN" not in by_key


def test_impact_test_case_key_and_provenance(client):
    """Impacted test cases use their own TC-id (not the requirement-reference
    field) and inherit confidence from their parent requirement: tests reached
    only through a *similar* requirement are 'similar', not 'linked'."""
    pid = client.project_id
    psp = client.post("/docs/spaces", json={"name": "S", "project_id": pid}).json()
    doc = client.post("/docs", json={
        "title": "Zeta Login Flow",
        "content_markdown": "# Zeta Login Flow\n\nZeta login oauth signin flow steps",
        "space_id": psp["id"],
    }).json()
    # The converter links a requirement directly to the doc.
    conv = client.post(f"/docs/{doc['id']}/convert-to-requirements", json={"mode": "single"}).json()
    linked_req = conv["created"][0]
    linked_req_id, linked_req_key = linked_req["id"], linked_req["requirement_id"]

    from app import models
    db = client.SessionLocal()
    # A second requirement that merely shares vocabulary ("login", "flow") with the
    # doc — admitted by lexical similarity, not a direct link.
    similar = models.Requirement(
        title="Login flow audit", requirement_id="REQ-SIM", project_id=pid,
        created_by=client.member_id, status=models.RequirementStatus.DRAFT,
    )
    suite = models.TestSuite(name="Suite", project_id=pid)
    db.add_all([similar, suite])
    db.flush()
    tc_linked = models.TestCase(title="Linked TC", test_suite_id=suite.id, reference=linked_req_key)
    tc_similar = models.TestCase(title="Similar TC", test_suite_id=suite.id)
    db.add_all([tc_linked, tc_similar])
    db.flush()
    db.execute(models.requirement_test_case_links.insert().values(
        requirement_id=linked_req_id, test_case_id=tc_linked.id))
    db.execute(models.requirement_test_case_links.insert().values(
        requirement_id=similar.id, test_case_id=tc_similar.id))
    linked_tc_id, similar_tc_id = tc_linked.id, tc_similar.id
    db.commit()
    db.close()

    resp = client.post(f"/docs/{doc['id']}/impact-analysis", json={"include_ai": False})
    assert resp.status_code == 200, resp.text
    tcs = {t["id"]: t for t in resp.json()["test_cases"]}

    # Key is the test case's own identifier, never the requirement reference.
    assert tcs[linked_tc_id]["key"] == f"TC-{linked_tc_id}"
    assert tcs[linked_tc_id]["key"] != linked_req_key
    # Provenance flows from the parent requirement.
    assert tcs[linked_tc_id]["reason"] == "linked"
    assert linked_req_key in tcs[linked_tc_id]["via"]
    assert tcs[similar_tc_id]["reason"] == "similar"
    assert tcs[similar_tc_id]["via"] == ["REQ-SIM"]


def test_doc_requirement_link_add_remove(client):
    pid = client.project_id
    psp = client.post("/docs/spaces", json={"name": "S", "project_id": pid}).json()
    doc = client.post("/docs", json={"title": "Doc", "content_markdown": "# Doc", "space_id": psp["id"]}).json()

    from app import models
    db = client.SessionLocal()
    req = models.Requirement(title="Req A", requirement_id="REQ-A", project_id=pid,
                             created_by=client.member_id, status=models.RequirementStatus.DRAFT)
    db.add(req)
    db.commit()
    rid = req.id
    db.close()

    # Link an existing requirement.
    r = client.post(f"/docs/{doc['id']}/requirement-links", json={"requirement_id": rid})
    assert r.status_code == 201, r.text
    assert r.json()["requirement_key"] == "REQ-A"
    # Idempotent re-link.
    assert client.post(f"/docs/{doc['id']}/requirement-links", json={"requirement_id": rid}).status_code == 201
    assert len(client.get(f"/docs/{doc['id']}/requirement-links").json()) == 1
    # Missing requirement → 404.
    assert client.post(f"/docs/{doc['id']}/requirement-links", json={"requirement_id": 999999}).status_code == 404
    # Unlink.
    assert client.delete(f"/docs/{doc['id']}/requirement-links/{rid}").status_code == 204
    assert client.get(f"/docs/{doc['id']}/requirement-links").json() == []
    # Unlinking again → 404.
    assert client.delete(f"/docs/{doc['id']}/requirement-links/{rid}").status_code == 404


def test_global_doc_convert_requires_target_project(client):
    gsp = client.post("/docs/spaces", json={"name": "Global"}).json()
    doc = client.post("/docs", json={"title": "G", "content_markdown": "# G\n\nx", "space_id": gsp["id"]}).json()

    missing = client.post(f"/docs/{doc['id']}/convert-to-requirements", json={"mode": "single"})
    assert missing.status_code == 400

    ok = client.post(f"/docs/{doc['id']}/convert-to-requirements",
                    json={"mode": "single", "target_project_id": client.project_id})
    assert ok.status_code == 200
    assert ok.json()["created"][0]["project_id"] == client.project_id


def test_share_and_public_viewer(client):
    psp = client.post("/docs/spaces", json={"name": "Sh", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Shared", "content_markdown": "# Hi\n\nbody", "space_id": psp["id"]}).json()

    # Not shared yet -> public lookup 404 even with a guessed id
    assert client.get("/docs/public/deadbeefdeadbeef").status_code == 404

    # Enable public sharing
    info = client.put(f"/docs/{doc['id']}/share", json={"share_scope": "public"}).json()
    assert info["share_scope"] == "public" and info["public_id"]
    pid = info["public_id"]

    pub = client.get(f"/docs/public/{pid}")
    assert pub.status_code == 200
    assert pub.json()["title"] == "Shared"
    assert "content_markdown" in pub.json()

    # Disable -> public link no longer resolves
    client.put(f"/docs/{doc['id']}/share", json={"share_scope": "private"})
    assert client.get(f"/docs/public/{pid}").status_code == 404

    # Expiry in the past is rejected
    bad = client.put(f"/docs/{doc['id']}/share",
                    json={"share_scope": "public", "share_expires_at": "2000-01-01T00:00:00Z"})
    assert bad.status_code == 400


def test_suggestions(client):
    psp = client.post("/docs/spaces", json={"name": "Sug", "project_id": client.project_id}).json()
    src = client.post("/docs", json={"title": "User login flow", "space_id": psp["id"], "tags": "auth, login",
                                     "content_markdown": "How users authenticate and sign in"}).json()
    similar = client.post("/docs", json={"title": "Login authentication", "space_id": psp["id"], "tags": "auth",
                                        "content_markdown": "authentication and sign in details"}).json()
    client.post("/docs", json={"title": "Quarterly budget report", "space_id": psp["id"], "tags": "finance",
                               "content_markdown": "numbers and spreadsheets"})

    sug = client.get(f"/docs/{src['id']}/suggestions").json()
    ids = [s["id"] for s in sug]
    assert similar["id"] in ids
    assert src["id"] not in ids  # never suggest itself
    # The auth-related doc should rank first and carry the matched tag.
    assert sug[0]["id"] == similar["id"]
    assert "auth" in sug[0]["matched_tags"]

    # Once linked as related, it drops out of suggestions.
    client.post(f"/docs/{src['id']}/related", json={"related_doc_id": similar["id"]})
    assert similar["id"] not in [s["id"] for s in client.get(f"/docs/{src['id']}/suggestions").json()]


def test_pagination_and_total_header(client):
    psp = client.post("/docs/spaces", json={"name": "Page", "project_id": client.project_id}).json()
    for i in range(5):
        client.post("/docs", json={"title": f"Doc {i}", "space_id": psp["id"]})

    first = client.get(f"/docs?space_id={psp['id']}&limit=2&skip=0")
    assert first.status_code == 200
    assert first.headers.get("X-Total-Count") == "5"
    assert len(first.json()) == 2

    second = client.get(f"/docs?space_id={psp['id']}&limit=2&skip=4")
    assert len(second.json()) == 1  # last page


def test_list_excerpt_is_truncated(client):
    psp = client.post("/docs/spaces", json={"name": "Big", "project_id": client.project_id}).json()
    big = "word " * 2000  # ~10k chars
    client.post("/docs", json={"title": "Large", "content_markdown": big, "space_id": psp["id"]})
    item = client.get(f"/docs?space_id={psp['id']}").json()[0]
    assert "content_markdown" not in item  # list rows never carry the full body
    assert len(item["excerpt"] or "") <= 200


def test_facets(client):
    psp = client.post("/docs/spaces", json={"name": "Facet", "project_id": client.project_id}).json()
    client.post("/docs", json={"title": "A", "space_id": psp["id"], "tags": "auth, login", "classification": "Internal"})
    client.post("/docs", json={"title": "B", "space_id": psp["id"], "tags": "auth", "classification": "Public"})
    facets = client.get(f"/docs/facets?space_id={psp['id']}").json()
    tag_map = {t["value"]: t["count"] for t in facets["tags"]}
    assert tag_map.get("auth") == 2 and tag_map.get("login") == 1
    class_map = {c["value"]: c["count"] for c in facets["classifications"]}
    assert class_map.get("Internal") == 1 and class_map.get("Public") == 1


def test_clear_revisions(client):
    psp = client.post("/docs/spaces", json={"name": "R", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "D", "content_markdown": "v1", "space_id": psp["id"]}).json()
    client.put(f"/docs/{doc['id']}", json={"content_markdown": "v2"})
    client.put(f"/docs/{doc['id']}", json={"content_markdown": "v3"})
    assert len(client.get(f"/docs/{doc['id']}/versions").json()) == 3

    cleared = client.delete(f"/docs/{doc['id']}/versions")
    assert cleared.status_code == 200
    versions = client.get(f"/docs/{doc['id']}/versions").json()
    assert len(versions) == 1  # single fresh baseline
    # Current content is preserved as the baseline
    assert client.get(f"/docs/{doc['id']}").json()["content_markdown"] == "v3"


def test_permission_flags_present(client):
    psp = client.post("/docs/spaces", json={"name": "P", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "D", "space_id": psp["id"]}).json()
    assert doc["can_edit"] is True and doc["can_delete"] is True and doc["can_share"] is True
    fetched = client.get(f"/docs/{doc['id']}").json()
    assert fetched["can_edit"] is True


def test_folder_must_belong_to_space(client):
    sp_a = client.post("/docs/spaces", json={"name": "A", "project_id": client.project_id}).json()
    sp_b = client.post("/docs/spaces", json={"name": "B", "project_id": client.project_id}).json()
    folder_a = client.post("/docs/folders", json={"space_id": sp_a["id"], "name": "F"}).json()

    # Creating a doc in space B with a folder from space A is rejected
    bad = client.post("/docs", json={"title": "X", "space_id": sp_b["id"], "folder_id": folder_a["id"]})
    assert bad.status_code == 400

    # A parent folder from another space is rejected
    bad2 = client.post("/docs/folders", json={"space_id": sp_b["id"], "name": "G", "parent_folder_id": folder_a["id"]})
    assert bad2.status_code == 400


def test_doc_inherits_space_classification(client):
    psp = client.post("/docs/spaces", json={"name": "C", "project_id": client.project_id, "classification": "Confidential"}).json()
    doc = client.post("/docs", json={"title": "D", "space_id": psp["id"]}).json()
    assert doc["classification"] == "Confidential"
    # Explicit classification wins over inheritance
    doc2 = client.post("/docs", json={"title": "D2", "space_id": psp["id"], "classification": "Public"}).json()
    assert doc2["classification"] == "Public"


def test_import_export_roundtrip(client):
    psp = client.post("/docs/spaces", json={"name": "IO", "project_id": client.project_id}).json()

    # Import a single markdown file with front-matter
    md_file = ("doc.md", "---\ntitle: Imported\ntags: a,b\n---\n\n# Body\n\nhello", "text/markdown")
    imported = client.post("/docs/import", data={"space_id": psp["id"]},
                          files={"file": md_file}).json()
    assert imported[0]["title"] == "Imported"
    assert imported[0]["tags"] == "a,b"

    # Import a zip bundle (recreates folder tree)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("guide/intro.md", "# Intro\n\nwelcome")
        zf.writestr("guide/api/auth.md", "---\ntitle: Auth\n---\n\nauth")
    z = client.post("/docs/import", data={"space_id": psp["id"]},
                   files={"file": ("bundle.zip", buf.getvalue(), "application/zip")}).json()
    assert {d["title"] for d in z} == {"Intro", "Auth"}

    # Export the space as a zip of markdown + manifest
    exp = client.get(f"/docs/spaces/{psp['id']}/export")
    assert exp.status_code == 200 and exp.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(exp.content)) as zf:
        names = zf.namelist()
    assert "manifest.json" in names
    assert any(n.endswith(".md") for n in names)


def _doc_notifications(client, user_id):
    from app import models
    db = client.SessionLocal()
    try:
        return (
            db.query(models.Notification)
            .filter(
                models.Notification.user_id == user_id,
                models.Notification.related_entity_type == "doc",
            )
            .all()
        )
    finally:
        db.close()


def test_doc_body_mentions_notify_members_once(client):
    psp = client.post("/docs/spaces", json={"name": "M", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Spec", "space_id": psp["id"], "content_markdown": "draft"}).json()

    # Mentioning a project member notifies them, tied to the doc.
    client.put(f"/docs/{doc['id']}", json={"content_markdown": "hello @bob please review"})
    notes = _doc_notifications(client, client.member_id)
    assert len(notes) == 1
    assert notes[0].related_entity_id == doc["id"]

    # Re-saving with the same mention does not re-notify (diffed against prior).
    client.put(f"/docs/{doc['id']}", json={"content_markdown": "hello @bob please review now"})
    assert len(_doc_notifications(client, client.member_id)) == 1


def test_doc_mentions_skip_self_and_global(client):
    # Self-mention by the actor (admin) never notifies the actor.
    psp = client.post("/docs/spaces", json={"name": "Self", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "S", "space_id": psp["id"]}).json()
    client.put(f"/docs/{doc['id']}", json={"content_markdown": "note to @admin"})
    from app import models
    db = client.SessionLocal()
    try:
        assert db.query(models.Notification).count() == 0
    finally:
        db.close()

    # Global docs (no project) never notify, even for a real username.
    gsp = client.post("/docs/spaces", json={"name": "G"}).json()
    gdoc = client.post("/docs", json={"title": "G", "space_id": gsp["id"]}).json()
    client.put(f"/docs/{gdoc['id']}", json={"content_markdown": "ping @bob"})
    assert len(_doc_notifications(client, client.member_id)) == 0


def test_doc_stats_overview_admin_only(client):
    psp = client.post("/docs/spaces", json={"name": "St", "project_id": client.project_id}).json()
    d1 = client.post("/docs", json={"title": "One", "space_id": psp["id"]}).json()
    client.post("/docs", json={"title": "Two", "space_id": psp["id"]})
    client.get(f"/docs/{d1['id']}")  # record a view

    ov = client.get(f"/docs/stats/overview?project_id={client.project_id}")
    assert ov.status_code == 200
    data = ov.json()
    assert data["total_docs"] >= 2
    assert data["total_views"] >= 1
    assert any(m["id"] == d1["id"] for m in data["most_viewed"])

    # A non-admin member is forbidden from the statistics overview. (The fixture
    # is function-scoped, so swapping the current user here is fine — overrides
    # are reset for the next test.)
    client.set_current_user(client.member_id)
    assert client.get(f"/docs/stats/overview?project_id={client.project_id}").status_code == 403


def test_change_impact_analysis(client):
    """The deterministic impact graph links a doc change to its requirements
    (via DocRequirementLink), their test cases (association links), and defects
    (Defect.requirement_id). AI is disabled here for determinism."""
    from app import models

    psp = client.post("/docs/spaces", json={"name": "Impact", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={
        "title": "Checkout Spec",
        "content_markdown": "# Checkout\n\nThe checkout flow validates the cart total.",
        "space_id": psp["id"],
    }).json()

    db = client.SessionLocal()
    try:
        admin = db.query(models.User).filter(models.User.username == "admin").first()
        requirement = models.Requirement(
            title="Checkout total validation",
            description="Validate the cart total at checkout.",
            requirement_id="REQ-001",
            project_id=client.project_id,
            created_by=admin.id,
        )
        db.add(requirement)
        db.flush()

        suite = models.TestSuite(name="Checkout Suite", project_id=client.project_id)
        db.add(suite)
        db.flush()
        test_case = models.TestCase(
            title="Cart total is correct", reference="TC-1", test_suite_id=suite.id,
        )
        db.add(test_case)
        db.flush()

        # Requirement → test case association link.
        db.execute(models.requirement_test_case_links.insert().values(
            requirement_id=requirement.id, test_case_id=test_case.id,
        ))
        # Converter provenance: doc → requirement.
        db.add(models.DocRequirementLink(doc_id=doc["id"], requirement_id=requirement.id, created_by=admin.id))
        # An open defect tied to the requirement.
        db.add(models.Defect(
            title="Total off by one", defect_id="DEF-001", project_id=client.project_id,
            status=models.DefectStatus.OPEN, severity=models.DefectSeverity.HIGH,
            reported_by=admin.id, requirement_id=requirement.id,
        ))
        db.commit()
    finally:
        db.close()

    resp = client.post(f"/docs/{doc['id']}/impact-analysis", json={"include_ai": False})
    assert resp.status_code == 200, resp.text
    data = resp.json()

    req_keys = {r["key"]: r for r in data["requirements"]}
    assert "REQ-001" in req_keys
    assert req_keys["REQ-001"]["reason"] == "linked"
    assert any(tc["key"] == "TC-1" for tc in data["test_cases"])
    defect = next((d for d in data["defects"] if d["key"] == "DEF-001"), None)
    assert defect is not None
    assert defect["is_open"] is True
    assert defect["severity"] == "high"

    signals = data["risk_signals"]
    assert signals["impacted_requirements"] >= 1
    assert signals["impacted_test_cases"] >= 1
    assert signals["open_defects"] >= 1
    assert signals["high_severity_defects"] >= 1

    # AI was explicitly disabled by the request.
    assert data["ai_available"] is False
    assert data["ai_skipped_reason"] == "disabled_by_request"


def test_change_impact_analysis_global_doc_is_empty(client):
    """A global (project-less) doc has no project artifacts to impact."""
    gsp = client.post("/docs/spaces", json={"name": "GlobalKB"}).json()
    assert gsp["project_id"] is None
    doc = client.post("/docs", json={"title": "Global", "content_markdown": "# x", "space_id": gsp["id"]}).json()

    resp = client.post(f"/docs/{doc['id']}/impact-analysis", json={})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["requirements"] == []
    assert data["test_cases"] == []
    assert data["defects"] == []
    assert data["ai_skipped_reason"] == "global_doc"


def test_change_impact_skips_ai_when_unchanged(client):
    """When the editor re-analyzes a draft identical to the saved content, the
    deterministic graph still returns but no (paid) AI request is attempted."""
    psp = client.post("/docs/spaces", json={"name": "NoChange", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={
        "title": "Stable", "content_markdown": "# Stable\n\nUnchanged body.", "space_id": psp["id"],
    }).json()

    # Same content as stored, include_ai defaults to True → AI must be skipped.
    resp = client.post(f"/docs/{doc['id']}/impact-analysis", json={
        "candidate_markdown": "# Stable\n\nUnchanged body.",
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["change_summary"]["changed"] is False
    assert data["ai_available"] is False
    assert data["ai_skipped_reason"] == "no_changes"

    # A real change is detected (changed=True). AI still won't run here because no
    # provider is configured in the test, but the skip reason is no longer "no_changes".
    changed = client.post(f"/docs/{doc['id']}/impact-analysis", json={
        "candidate_markdown": "# Stable\n\nA materially different body with new content.",
    })
    assert changed.status_code == 200, changed.text
    changed_data = changed.json()
    assert changed_data["change_summary"]["changed"] is True
    assert changed_data["ai_skipped_reason"] != "no_changes"


def test_change_impact_requires_doc_hub_feature(client):
    """Impact analysis is gated by the project's doc_hub toggle (the route's
    feature dependency can't see project_id, so the handler enforces it)."""
    from app import models

    psp = client.post("/docs/spaces", json={"name": "Gated", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Gated doc", "space_id": psp["id"]}).json()

    db = client.SessionLocal()
    try:
        project = db.query(models.Project).filter(models.Project.id == client.project_id).first()
        project.features = {"doc_hub": False}
        db.commit()
    finally:
        db.close()

    resp = client.post(f"/docs/{doc['id']}/impact-analysis", json={"include_ai": False})
    assert resp.status_code == 403, resp.text


def _make_outsider(client, username="carol", role="user"):
    """Create a user who is NOT a member of the test project."""
    from app import models

    db = client.SessionLocal()
    try:
        user = models.User(username=username, email=f"{username}@b.c", hashed_password="x",
                           role=role, is_active=True, full_name=username.title())
        db.add(user)
        db.commit()
        db.refresh(user)
        return user.id
    finally:
        db.close()


def test_granular_sharing_user_grant_and_audit(client):
    """A user grant lets a non-member read a restricted doc, auto-promotes the
    scope, and writes an audit trail; revoking the grant locks them out again."""
    psp = client.post("/docs/spaces", json={"name": "Sec", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Secret", "content_markdown": "# Secret",
                                     "space_id": psp["id"]}).json()
    outsider = _make_outsider(client)

    # Outsider cannot read the (private) doc.
    client.set_current_user(outsider)
    assert client.get(f"/docs/{doc['id']}").status_code == 403

    # Admin grants the outsider access; the doc auto-promotes to restricted.
    client.set_current_user(1)
    info = client.post(f"/docs/{doc['id']}/share/grants",
                       json={"grant_type": "user", "subject_user_id": outsider})
    assert info.status_code == 200, info.text
    info = info.json()
    assert info["share_scope"] == "restricted"
    assert len(info["grants"]) == 1
    grant = info["grants"][0]
    assert grant["grant_type"] == "user" and grant["subject_user_id"] == outsider
    assert grant["subject_label"]  # resolved display label

    # Now the outsider can read it.
    client.set_current_user(outsider)
    assert client.get(f"/docs/{doc['id']}").status_code == 200

    # Audit trail captured the scope change, the grant, and the access.
    client.set_current_user(1)
    audit = client.get(f"/docs/{doc['id']}/share/audit").json()
    actions = {row["action"] for row in audit}
    assert {"scope_changed", "grant_added", "accessed"} <= actions

    # Revoke and confirm the outsider is locked out again.
    after = client.delete(f"/docs/{doc['id']}/share/grants/{grant['id']}").json()
    assert after["grants"] == []
    client.set_current_user(outsider)
    assert client.get(f"/docs/{doc['id']}").status_code == 403


def test_granular_sharing_project_group_grant(client):
    """A 'project' grant shares with an entire other project's team."""
    from app import models

    psp = client.post("/docs/spaces", json={"name": "Grp", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Shared", "space_id": psp["id"]}).json()
    outsider = _make_outsider(client, username="dave")

    # Build a second project and make the outsider a member of it.
    db = client.SessionLocal()
    try:
        owner_id = db.query(models.Project).filter(
            models.Project.id == client.project_id).first().owner_id
        p2 = models.Project(name="Team2", description="d", owner_id=owner_id)
        db.add(p2)
        db.commit()
        db.refresh(p2)
        db.add(models.ProjectAssignment(project_id=p2.id, user_id=outsider))
        db.commit()
        p2_id = p2.id
    finally:
        db.close()

    client.set_current_user(1)
    info = client.post(f"/docs/{doc['id']}/share/grants",
                       json={"grant_type": "project", "subject_project_id": p2_id}).json()
    assert info["share_scope"] == "restricted"
    assert info["grants"][0]["grant_type"] == "project"

    # The outsider, as a Team2 member, can now read the doc.
    client.set_current_user(outsider)
    assert client.get(f"/docs/{doc['id']}").status_code == 200


def test_granular_sharing_expired_grant_denies_access(client):
    """An expired grant does not authorize access."""
    from datetime import datetime, timedelta, timezone
    from app import models

    psp = client.post("/docs/spaces", json={"name": "Exp", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Expiring", "space_id": psp["id"]}).json()
    outsider = _make_outsider(client, username="erin")

    client.set_current_user(1)
    info = client.post(f"/docs/{doc['id']}/share/grants",
                       json={"grant_type": "user", "subject_user_id": outsider}).json()
    grant_id = info["grants"][0]["id"]

    # Force the grant into the past directly in the DB.
    db = client.SessionLocal()
    try:
        grant = db.query(models.DocShareGrant).filter(models.DocShareGrant.id == grant_id).first()
        grant.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
    finally:
        db.close()

    client.set_current_user(outsider)
    assert client.get(f"/docs/{doc['id']}").status_code == 403


def test_granular_sharing_rejects_bad_grant_payloads(client):
    """Grant validation: wrong/missing subject and past expiry are rejected."""
    psp = client.post("/docs/spaces", json={"name": "Val", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Val doc", "space_id": psp["id"]}).json()

    # 'user' grant without subject_user_id.
    assert client.post(f"/docs/{doc['id']}/share/grants",
                       json={"grant_type": "user"}).status_code == 422
    # invalid grant_type.
    assert client.post(f"/docs/{doc['id']}/share/grants",
                       json={"grant_type": "team", "subject_user_id": 1}).status_code == 422
    # role grant with an unknown role.
    assert client.post(f"/docs/{doc['id']}/share/grants",
                       json={"grant_type": "role", "subject_role": "wizard"}).status_code == 422


def test_granular_sharing_blocked_on_global_docs(client):
    """Global docs are readable by all authenticated users, so restricted scope
    and grants are rejected for them."""
    gsp = client.post("/docs/spaces", json={"name": "Global KB"}).json()  # no project_id
    doc = client.post("/docs", json={"title": "Global doc", "space_id": gsp["id"]}).json()
    assert doc["project_id"] is None

    assert client.put(f"/docs/{doc['id']}/share", json={"share_scope": "restricted"}).status_code == 400
    assert client.post(f"/docs/{doc['id']}/share/grants",
                       json={"grant_type": "user", "subject_user_id": 1}).status_code == 400


def test_granular_sharing_normalizes_stray_subject_fields(client):
    """A 'user' grant carrying a stray subject_role is stored without it, so it
    can't pollute the uniqueness key or access matching."""
    psp = client.post("/docs/spaces", json={"name": "Norm", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Norm doc", "space_id": psp["id"]}).json()
    info = client.post(f"/docs/{doc['id']}/share/grants",
                       json={"grant_type": "user", "subject_user_id": client.member_id,
                             "subject_role": "admin", "subject_project_id": 999}).json()
    grant = info["grants"][0]
    assert grant["grant_type"] == "user"
    assert grant["subject_role"] is None
    assert grant["subject_project_id"] is None


def test_granular_sharing_role_grants_pruned_on_project_move(client):
    """Moving a doc to another project drops role grants (scoped to the old
    project's roles) but keeps explicit user grants."""
    from app import models

    psp = client.post("/docs/spaces", json={"name": "Src", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Movable", "space_id": psp["id"]}).json()
    outsider = _make_outsider(client, username="frank")

    # Build a second project + a space inside it to move the doc into.
    db = client.SessionLocal()
    try:
        owner_id = db.query(models.Project).filter(
            models.Project.id == client.project_id).first().owner_id
        p2 = models.Project(name="Dest", description="d", owner_id=owner_id)
        db.add(p2)
        db.commit()
        db.refresh(p2)
        p2_id = p2.id
    finally:
        db.close()
    dst_space = client.post("/docs/spaces", json={"name": "Dst", "project_id": p2_id}).json()

    client.post(f"/docs/{doc['id']}/share/grants", json={"grant_type": "role", "subject_role": "tester"})
    client.post(f"/docs/{doc['id']}/share/grants", json={"grant_type": "user", "subject_user_id": outsider})
    before = client.get(f"/docs/{doc['id']}/share").json()
    assert {g["grant_type"] for g in before["grants"]} == {"role", "user"}

    # Move the doc to the other project.
    moved = client.put(f"/docs/{doc['id']}", json={"space_id": dst_space["id"]})
    assert moved.status_code == 200, moved.text

    after = client.get(f"/docs/{doc['id']}/share").json()
    kinds = {g["grant_type"] for g in after["grants"]}
    assert kinds == {"user"}  # role grant pruned, user grant kept
    assert after["share_scope"] == "restricted"


def test_granular_sharing_move_to_global_clears_grants(client):
    """Re-homing a restricted doc to the global scope clears all grants and
    reverts the scope to private."""
    psp = client.post("/docs/spaces", json={"name": "Proj2", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "ToGlobal", "space_id": psp["id"]}).json()
    client.post(f"/docs/{doc['id']}/share/grants",
                json={"grant_type": "user", "subject_user_id": client.member_id})

    gsp = client.post("/docs/spaces", json={"name": "GlobalDst"}).json()  # no project_id
    moved = client.put(f"/docs/{doc['id']}", json={"space_id": gsp["id"]})
    assert moved.status_code == 200, moved.text

    info = client.get(f"/docs/{doc['id']}/share").json()
    assert info["grants"] == []
    assert info["share_scope"] == "private"


def test_granular_sharing_public_audit_is_throttled(client):
    """Repeated anonymous public-link views collapse to a single audit row per
    window (the endpoint is unauthenticated and must not flood the trail)."""
    psp = client.post("/docs/spaces", json={"name": "Pub", "project_id": client.project_id}).json()
    doc = client.post("/docs", json={"title": "Public doc", "content_markdown": "# Hi",
                                     "space_id": psp["id"]}).json()
    share = client.put(f"/docs/{doc['id']}/share", json={"share_scope": "public"}).json()
    public_id = share["public_id"]

    for _ in range(3):
        assert client.get(f"/docs/public/{public_id}").status_code == 200

    audit = client.get(f"/docs/{doc['id']}/share/audit").json()
    public_rows = [r for r in audit if r["action"] == "public_accessed"]
    assert len(public_rows) == 1
    assert public_rows[0]["actor_name"] is None  # anonymous

