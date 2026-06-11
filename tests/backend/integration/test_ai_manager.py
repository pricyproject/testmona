"""Integration tests for the AI manager and project AI chat routes.

These tests require a real (in-memory SQLite) database because they exercise
DB-backed helpers: usage recording, retrieve_relevant_docs, fallback
orchestration, chat message management, and _produce_answer.

Pure logic tests (task mapping, routing resolution, prompt building) live in
tests/backend/unit/test_ai_service.py.
"""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services import ai_manager, requirement_retrieval
from app.services.ai_prompt_service import QA_PROMPT_CHAR_CEILING
from app.database import Base
from app import models, crud


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _mem_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _seed_project(db):
    db.add_all([
        models.User(id=1, username="u", email="u@x.com", hashed_password="x"),
        models.Project(id=1, name="P", owner_id=1),
    ])
    db.commit()


# ---------------------------------------------------------------------------
# retrieve_relevant_docs: mixed-type corpus retrieval
# ---------------------------------------------------------------------------

def test_retrieve_relevant_docs_mixed_types():
    db = _mem_db()
    _seed_project(db)
    db.add(models.Requirement(id=1, title="Login flow", requirement_id="REQ-1",
                              description="user can log in", project_id=1, created_by=1))
    db.add(models.Defect(id=1, title="Login button broken", defect_id="DEF-1",
                         description="login fails", project_id=1, reported_by=1,
                         steps_to_reproduce="click login"))
    db.add(models.TestPlan(id=1, title="Auth test plan", project_id=1, created_by=1,
                           test_objectives="verify login"))
    db.commit()

    result = requirement_retrieval.retrieve_relevant_docs(
        db, 1, "login", source_types=["requirements", "defects", "test_plans", "test_cases"]
    )
    types = {d.type for d in result.selected}
    assert result.considered == 3
    assert {"requirement", "defect", "test_plan"} <= types

    keys = {d.key for d in result.selected}
    assert "REQ-1" in keys and "DEF-1" in keys and "PLAN-1" in keys


def test_retrieve_relevant_docs_respects_max_docs_and_default_scope():
    db = _mem_db()
    _seed_project(db)
    for i in range(1, 6):
        db.add(models.Requirement(id=i, title=f"login item {i}", requirement_id=f"REQ-{i}",
                                  description="login", project_id=1, created_by=1))
    db.commit()

    result = requirement_retrieval.retrieve_relevant_docs(db, 1, "login", source_types=[], max_docs=2)
    assert len(result.selected) == 2 and result.truncated
    assert all(d.type == "requirement" for d in result.selected)


def test_retrieve_relevant_docs_empty_project_returns_nothing():
    db = _mem_db()
    _seed_project(db)
    result = requirement_retrieval.retrieve_relevant_docs(
        db, 1, "anything", source_types=["requirements", "defects"]
    )
    assert result.selected == [] and result.considered == 0


# ---------------------------------------------------------------------------
# Usage recording and aggregation
# ---------------------------------------------------------------------------

def test_per_operation_usage_aggregation():
    db = _mem_db()
    ai_manager._record_usage(db, "openai", "gpt", "requirement_project_qa", 10, 5, True, project_id=1, user_id=1)
    ai_manager._record_usage(db, "openai", "gpt", "requirement_project_qa", 4, 1, True, project_id=1, user_id=1)
    ai_manager._record_usage(db, "openai", "gpt", "requirement_test_case_generation", 7, 3, True, project_id=1, user_id=1)

    usage = ai_manager.get_ai_usage(db)
    by_op = {row["operation"]: row for row in usage["limits"]["by_operation"]}
    assert by_op["requirement_project_qa"]["requests"] == 2
    assert by_op["requirement_project_qa"]["total_tokens"] == 20
    assert by_op["requirement_test_case_generation"]["total_tokens"] == 10


def test_usage_tracking_records_provider_and_model():
    db = _mem_db()
    ai_manager._record_usage(db, "anthropic", "claude-3", "doc_change_impact", 50, 25, True, project_id=1, user_id=1)
    usage = ai_manager.get_ai_usage(db)
    by_op = {row["operation"]: row for row in usage["limits"]["by_operation"]}
    assert by_op["doc_change_impact"]["total_tokens"] == 75


# ---------------------------------------------------------------------------
# Fallback logic
# ---------------------------------------------------------------------------

class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, **kwargs):
        return _FakeResp({
            "choices": [{"message": {"content": "ok from fallback"}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 2},
        })


def test_fallback_triggers_on_token_limit(monkeypatch):
    db = _mem_db()

    monkeypatch.setattr(ai_manager, "_load_ai_config", lambda _db: {
        "active_provider": "openai",
        "system_prompt": "",
        "routing": {t: {"provider": None, "model": None} for t in ai_manager.ROUTING_TASKS},
        "fallback": {"enabled": True, "order": ["openrouter"]},
        "providers": {},
    })

    calls = {"n": 0}

    def fake_private_config(_db, provider=None, project_id=None):
        calls["n"] += 1
        if provider == "openai":
            raise HTTPException(status_code=429, detail="AI provider monthly token limit reached")
        return {
            "provider": "openrouter", "model": "m", "base_url": "http://x/v1",
            "request_timeout_seconds": 30, "api_key_plain": "k",
        }

    monkeypatch.setattr(ai_manager, "_get_private_config", fake_private_config)
    monkeypatch.setattr(ai_manager.httpx, "AsyncClient", _FakeClient)

    req = ai_manager.AICompletionRequest(prompt="hi", max_tokens=50)
    result = asyncio.run(
        ai_manager.generate_ai_completion(db, req, operation="requirement_project_qa", project_id=1, user_id=1)
    )
    assert result.provider == "openrouter" and result.content == "ok from fallback"
    assert calls["n"] == 2


def test_no_fallback_when_disabled(monkeypatch):
    db = _mem_db()
    monkeypatch.setattr(ai_manager, "_load_ai_config", lambda _db: {
        "active_provider": "openai",
        "system_prompt": "",
        "routing": {t: {"provider": None, "model": None} for t in ai_manager.ROUTING_TASKS},
        "fallback": {"enabled": False, "order": ["openrouter"]},
        "providers": {},
    })

    def fake_private_config(_db, provider=None, project_id=None):
        raise HTTPException(status_code=429, detail="limit")

    monkeypatch.setattr(ai_manager, "_get_private_config", fake_private_config)
    req = ai_manager.AICompletionRequest(prompt="hi", max_tokens=50)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ai_manager.generate_ai_completion(db, req, operation="requirement_project_qa"))
    assert exc.value.status_code == 429


def test_explicit_provider_disables_fallback(monkeypatch):
    db = _mem_db()
    monkeypatch.setattr(ai_manager, "_load_ai_config", lambda _db: {
        "active_provider": "openai",
        "system_prompt": "",
        "routing": {t: {"provider": None, "model": None} for t in ai_manager.ROUTING_TASKS},
        "fallback": {"enabled": True, "order": ["openrouter"]},
        "providers": {},
    })
    calls = {"n": 0}

    def fake_private_config(_db, provider=None, project_id=None):
        calls["n"] += 1
        raise HTTPException(status_code=502, detail="provider down")

    monkeypatch.setattr(ai_manager, "_get_private_config", fake_private_config)
    req = ai_manager.AICompletionRequest(prompt="hi", max_tokens=50, provider="openai")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ai_manager.generate_ai_completion(db, req, operation="connection_test"))
    assert exc.value.status_code == 502
    assert calls["n"] == 1


# ---------------------------------------------------------------------------
# Chat message management
# ---------------------------------------------------------------------------

def test_delete_chat_messages_trims_conversation():
    db = _mem_db()
    _seed_project(db)
    conv = crud.create_chat_conversation(db, 1, 1, title="t")
    crud.add_chat_message(db, conv.id, "user", "q1")
    assistant = crud.add_chat_message(db, conv.id, "assistant", "a1")
    crud.delete_chat_messages(db, [assistant.id])
    db.expire_all()
    roles = [m.role for m in crud.get_chat_conversation(db, conv.id).messages]
    assert roles == ["user"]
    assert crud.delete_chat_messages(db, []) == 0


def test_chat_conversation_stores_and_retrieves_messages():
    db = _mem_db()
    _seed_project(db)
    conv = crud.create_chat_conversation(db, 1, 1, title="QA session")
    msg1 = crud.add_chat_message(db, conv.id, "user", "How does login work?")
    msg2 = crud.add_chat_message(db, conv.id, "assistant", "It uses OAuth.")
    db.expire_all()

    retrieved = crud.get_chat_conversation(db, conv.id)
    assert retrieved.title == "QA session"
    assert len(retrieved.messages) == 2
    assert retrieved.messages[0].content == "How does login work?"
    assert retrieved.messages[1].content == "It uses OAuth."


# ---------------------------------------------------------------------------
# _produce_answer: source mapping and empty-scope guard
# ---------------------------------------------------------------------------

def test_produce_answer_maps_typed_sources(monkeypatch):
    from app.routes import project_ai_chat as rc

    db = _mem_db()
    _seed_project(db)
    db.add(models.Requirement(id=1, title="Login", requirement_id="REQ-1",
                              description="user can log in", project_id=1, created_by=1))
    db.commit()

    async def fake_complete(*args, **kwargs):
        return SimpleNamespace(
            content='{"answer":"Use REQ-1 for login","sources":[{"key":"REQ-1"},{"key":"NOPE"}]}',
            prompt_tokens=12, model="m", provider="openai",
        )

    monkeypatch.setattr(rc, "generate_ai_completion", fake_complete)
    settings = {"enabled": True, "source_types": ["requirements"], "max_context_requirements": 40, "history_turns": 6}
    produced = asyncio.run(rc._produce_answer(db, 1, SimpleNamespace(id=1), "how to login?", [], settings))

    assert produced["answer"] == "Use REQ-1 for login"
    assert len(produced["sources"]) == 1
    source = produced["sources"][0]
    assert {k: source[k] for k in ("type", "id", "key", "title")} == {
        "type": "requirement", "id": 1, "key": "REQ-1", "title": "Login",
    }
    assert source["excerpt"]
    assert produced["prompt_tokens"] == 12


def test_produce_answer_empty_scope_no_model_call(monkeypatch):
    from app.routes import project_ai_chat as rc

    db = _mem_db()
    _seed_project(db)

    async def boom(*a, **k):
        raise AssertionError("model should not be called for empty scope")

    monkeypatch.setattr(rc, "generate_ai_completion", boom)
    settings = {"enabled": True, "source_types": ["requirements"], "max_context_requirements": 40, "history_turns": 6}
    produced = asyncio.run(rc._produce_answer(db, 1, SimpleNamespace(id=1), "anything?", [], settings))
    assert produced["sources"] == [] and produced["prompt_tokens"] == 0
    assert "nothing" in produced["answer"].lower()


# ---------------------------------------------------------------------------
# Enhanced: multiple fallback providers tried in order
# ---------------------------------------------------------------------------

def test_fallback_tries_providers_in_order(monkeypatch):
    """When the primary fails, the first usable fallback in ``order`` wins."""
    db = _mem_db()

    monkeypatch.setattr(ai_manager, "_load_ai_config", lambda _db: {
        "active_provider": "openai",
        "system_prompt": "",
        "routing": {t: {"provider": None, "model": None} for t in ai_manager.ROUTING_TASKS},
        "fallback": {"enabled": True, "order": ["bad_provider", "openrouter"]},
        "providers": {},
    })

    call_order = []

    def fake_private_config(_db, provider=None, project_id=None):
        call_order.append(provider)
        if provider in ("openai", "bad_provider"):
            raise HTTPException(status_code=429, detail="limit")
        return {
            "provider": "openrouter", "model": "m", "base_url": "http://x/v1",
            "request_timeout_seconds": 30, "api_key_plain": "k",
        }

    monkeypatch.setattr(ai_manager, "_get_private_config", fake_private_config)
    monkeypatch.setattr(ai_manager.httpx, "AsyncClient", _FakeClient)

    req = ai_manager.AICompletionRequest(prompt="hi", max_tokens=50)
    result = asyncio.run(
        ai_manager.generate_ai_completion(db, req, operation="requirement_project_qa")
    )
    assert result.provider == "openrouter"
    assert "openai" in call_order
    assert "openrouter" in call_order
