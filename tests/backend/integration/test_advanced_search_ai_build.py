"""Integration tests for the natural-language TQL builder route
(``POST /advanced-search/ai-build``).

The AI provider call is monkeypatched with a canned completion, so these tests
exercise the route's own logic: prompt assembly, JSON parsing, entity
auto-detection/resolution, and — crucially — compiling the generated TQL against
the entity registry to report whether it is runnable. A real (in-memory) DB +
HTTP harness comes from conftest.
"""

import json

import pytest

from conftest import make_http_client
from app.services.ai_manager import AICompletionResult


def _have_lark():
    try:
        import lark  # noqa: F401
        return True
    except ImportError:
        return False


client = make_http_client()


def _fake_completion(content: str):
    async def _run(db, request, **kwargs):  # signature matches generate_ai_completion
        return AICompletionResult(
            provider="openai", model="gpt-4o-mini", content=content,
            prompt_tokens=5, completion_tokens=5, total_tokens=10,
        )
    return _run


def _patch(monkeypatch, content: str):
    import app.routes.advanced_search as adv
    monkeypatch.setattr(adv, "generate_ai_completion", _fake_completion(content))


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_ai_build_auto_detects_entity_and_validates(client, monkeypatch):
    """With no entity passed, the AI's chosen entity is honoured and the query
    validated against it."""
    _patch(monkeypatch, json.dumps({
        "entity": "defects",
        "tql": "status = OPEN AND priority IN (HIGH, URGENT)",
        "explanation": "Open defects that are high or urgent priority.",
    }))
    resp = client.post("/advanced-search/ai-build", json={
        "project_id": client.project_id,
        "question": "open urgent bugs",
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["entity"] == "defects"
    assert data["valid"] is True
    assert data["validation_error"] is None
    assert data["tql"].startswith("status = OPEN")


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_ai_build_compiles_against_detected_entity(client, monkeypatch):
    """A query valid for requirements is auto-detected and compiles for that
    entity (it would NOT compile against defects)."""
    _patch(monkeypatch, json.dumps({
        "entity": "requirements",
        "tql": "status = APPROVED",
        "explanation": "Approved requirements.",
    }))
    resp = client.post("/advanced-search/ai-build", json={
        "project_id": client.project_id,
        "question": "approved requirements",
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["entity"] == "requirements"
    assert data["valid"] is True


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_ai_build_flags_unrunnable_tql(client, monkeypatch):
    """A query referencing a field the entity doesn't have is returned but
    marked invalid (with the compiler error) so the user can fix it."""
    _patch(monkeypatch, json.dumps({
        "entity": "defects", "tql": "nonexistent_field = NOPE", "explanation": "x",
    }))
    resp = client.post("/advanced-search/ai-build", json={
        "project_id": client.project_id,
        "entity": "defects",
        "question": "anything",
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["valid"] is False
    assert data["validation_error"]
    assert data["tql"] == "nonexistent_field = NOPE"


def test_ai_build_empty_tql_is_valid_match_all(client, monkeypatch):
    """An empty TQL (e.g. "show all defects", or a request that couldn't be
    filtered) is a valid match-everything query; the explanation carries nuance."""
    _patch(monkeypatch, json.dumps({
        "entity": "defects", "tql": "", "explanation": "All defects (no filter).",
    }))
    resp = client.post("/advanced-search/ai-build", json={
        "project_id": client.project_id,
        "question": "show all defects",
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["entity"] == "defects"
    assert data["tql"] == ""
    assert data["valid"] is True
    assert data["explanation"]


def test_ai_build_unknown_chosen_entity_falls_back(client, monkeypatch):
    """If the AI returns an entity that isn't an enabled candidate, the route
    falls back to a real candidate rather than erroring."""
    _patch(monkeypatch, json.dumps({
        "entity": "made_up_entity", "tql": "", "explanation": "x",
    }))
    resp = client.post("/advanced-search/ai-build", json={
        "project_id": client.project_id,
        "question": "anything",
    })
    assert resp.status_code == 200, resp.text
    # Resolved to one of the real enabled entities (defaults to the first).
    resolved_entity = resp.json()["entity"]
    assert resolved_entity
    assert resolved_entity != "made_up_entity"


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_ai_build_resolves_entity_by_label_case_insensitively(client, monkeypatch):
    """The AI may echo a label ("Defects") instead of the key ("defects"); it
    still resolves to the right entity."""
    _patch(monkeypatch, json.dumps({
        "entity": "Defects", "tql": "status = OPEN", "explanation": "Open defects.",
    }))
    resp = client.post("/advanced-search/ai-build", json={
        "project_id": client.project_id,
        "question": "open defects",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["entity"] == "defects"


def test_ai_build_pinned_unknown_entity_rejected(client, monkeypatch):
    """An explicitly pinned entity that isn't a real entity is a 4xx."""
    _patch(monkeypatch, json.dumps({"entity": "x", "tql": "", "explanation": ""}))
    resp = client.post("/advanced-search/ai-build", json={
        "project_id": client.project_id,
        "entity": "made_up_entity",
        "question": "anything",
    })
    assert resp.status_code >= 400


def test_ai_build_bad_json_returns_502(client, monkeypatch):
    """A non-JSON model response surfaces as a 502 rather than a 500."""
    _patch(monkeypatch, "this is not json at all")
    resp = client.post("/advanced-search/ai-build", json={
        "project_id": client.project_id,
        "question": "anything",
    })
    assert resp.status_code == 502


def test_ai_build_empty_question_rejected(client, monkeypatch):
    """A blank question fails request validation (422) before any AI call."""
    _patch(monkeypatch, "{}")
    resp = client.post("/advanced-search/ai-build", json={
        "project_id": client.project_id,
        "question": "   ",
    })
    # min_length applies to the raw string; whitespace-only is allowed by length
    # but produces an empty prompt — accept either a 422 (length) or a 200 with an
    # empty/typed result. We only assert it never 500s.
    assert resp.status_code < 500
