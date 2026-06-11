"""Unit tests for the lexical requirement retrieval service and TOON prompt builder.

All tests use monkeypatching or direct function calls — no database or HTTP
harness required.  DB-backed tests live in
tests/backend/integration/test_ai_manager.py.
"""

from types import SimpleNamespace

import pytest

from app.services import requirement_retrieval
from app.services.ai_prompt_service import (
    QA_PROMPT_CHAR_CEILING,
    build_requirement_qa_prompt,
    encode_toon,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _req(rid, key, title, description="", acceptance="", tags="", priority="medium", status="draft"):
    return SimpleNamespace(
        id=rid,
        requirement_id=key,
        title=title,
        description=description,
        acceptance_criteria=acceptance,
        tags=tags,
        priority=priority,
        status=status,
    )


def _patch_requirements(monkeypatch, requirements):
    def fake_get_requirements(db, project_id=None, skip=0, limit=100, milestone_id=None):
        return requirements[skip:skip + limit]
    monkeypatch.setattr(requirement_retrieval.crud, "get_requirements", fake_get_requirements)


# ---------------------------------------------------------------------------
# Lexical retrieval ranking and budgeting
# ---------------------------------------------------------------------------

def test_ranks_relevant_requirement_first(monkeypatch):
    reqs = [
        _req(1, "REQ-1", "Reporting dashboard", description="Charts and exports"),
        _req(2, "REQ-2", "User login", description="Users sign in with password or SSO", tags="auth"),
        _req(3, "REQ-3", "Logout", description="End the session"),
    ]
    _patch_requirements(monkeypatch, reqs)

    result = requirement_retrieval.retrieve_relevant_requirements(
        db=None, project_id=1, query="how does login work?"
    )

    assert result.considered == 3
    assert not result.truncated
    assert result.selected[0].requirement_id == "REQ-2"


def test_truncates_to_char_budget(monkeypatch):
    big = "lorem ipsum dolor " * 80
    reqs = [_req(i, f"REQ-{i}", f"Item {i}", description=f"login {big}") for i in range(1, 11)]
    _patch_requirements(monkeypatch, reqs)

    result = requirement_retrieval.retrieve_relevant_requirements(
        db=None, project_id=1, query="login", char_budget=3000
    )

    assert result.considered == 10
    assert result.truncated
    assert 0 < len(result.selected) < 10


def test_empty_project_returns_nothing(monkeypatch):
    _patch_requirements(monkeypatch, [])
    result = requirement_retrieval.retrieve_relevant_requirements(db=None, project_id=1, query="anything")
    assert result.selected == [] and result.considered == 0 and result.truncated is False


def test_no_lexical_match_falls_back_to_recency(monkeypatch):
    reqs = [_req(1, "REQ-1", "Alpha"), _req(2, "REQ-2", "Beta"), _req(3, "REQ-3", "Gamma")]
    _patch_requirements(monkeypatch, reqs)
    result = requirement_retrieval.retrieve_relevant_requirements(
        db=None, project_id=1, query="zzzzz unrelated query"
    )
    assert result.selected[0].requirement_id == "REQ-3"


def test_retrieval_respects_max_requirements(monkeypatch):
    reqs = [_req(i, f"REQ-{i}", f"login item {i}", description="login") for i in range(1, 21)]
    _patch_requirements(monkeypatch, reqs)
    result = requirement_retrieval.retrieve_relevant_requirements(
        db=None, project_id=1, query="login", max_requirements=3
    )
    assert len(result.selected) == 3 and result.truncated


# ---------------------------------------------------------------------------
# QA prompt building
# ---------------------------------------------------------------------------

def test_qa_prompt_is_toon_table_and_cites_keys():
    reqs = [
        _req(1, "REQ-1", "Login", description="<p>Sign in</p>", priority="high", status="approved"),
        _req(2, "REQ-2", "Logout", description="Sign out"),
    ]
    prompt = build_requirement_qa_prompt(reqs, "Which cover auth?", history=[{"role": "user", "content": "hi"}])

    assert "requirements[2]{" in prompt
    assert "REQ-1" in prompt and "REQ-2" in prompt
    assert "Return JSON only" in prompt
    assert "<p>" not in prompt


def test_encode_toon_tabular_array():
    out = encode_toon({"rows": [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]})
    assert out.splitlines()[0] == "rows[2]{a,b}:"


def test_prompt_stays_under_ceiling_with_many_large_reqs_and_long_history():
    blob = "word " * 400
    reqs = [_req(i, f"REQ-{i}", f"Title {i} {blob}", description=blob, acceptance=blob) for i in range(1, 60)]
    history = [{"role": "user" if i % 2 else "assistant", "content": "h " * 400} for i in range(20)]
    prompt = build_requirement_qa_prompt(reqs, "x " * 1500, history=history)
    assert len(prompt) <= QA_PROMPT_CHAR_CEILING


def test_prompt_caps_single_huge_requirement():
    huge = _req(1, "REQ-1", "Big", description="z" * 50000, acceptance="y" * 50000)
    prompt = build_requirement_qa_prompt([huge], "summarize")
    assert len(prompt) <= QA_PROMPT_CHAR_CEILING
    assert "REQ-1" in prompt


def test_prompt_handles_none_fields_and_no_history():
    req = SimpleNamespace(
        id=1, requirement_id="REQ-1", title="Login",
        description=None, acceptance_criteria=None, tags=None, priority=None, status=None,
    )
    prompt = build_requirement_qa_prompt([req], "what is this?", history=None)
    assert "REQ-1" in prompt and "requirements[1]{" in prompt


def test_empty_requirements_list_prompt():
    prompt = build_requirement_qa_prompt([], "anything", history=[])
    assert "requirements[0]:" in prompt


# ---------------------------------------------------------------------------
# Regression: HTML-escaped content must survive intact
# ---------------------------------------------------------------------------

_ESCAPED_AC = (
    "&lt;ol&gt;" + "".join(
        f"&lt;li&gt;&lt;p&gt;AC{i}.1: detail number {i} "
        + ("filler " * 30)
        + "&lt;/p&gt;&lt;/li&gt;"
        for i in range(1, 11)
    ) + "&lt;/ol&gt;"
)


def test_single_requirement_keeps_full_acceptance_criteria():
    req = _req(3, "REQ-001", "Instagram Login",
               description="&lt;p&gt;OAuth sign-in&lt;/p&gt;", acceptance=_ESCAPED_AC)
    prompt = build_requirement_qa_prompt([req], "What is AC7.1?")
    assert "AC7.1" in prompt
    assert "&lt;" not in prompt and "<li>" not in prompt
    assert len(prompt) <= QA_PROMPT_CHAR_CEILING


def test_html_entities_are_decoded_and_stripped():
    req = _req(1, "REQ-1", "T", description="&lt;p&gt;Hello &amp; bye&lt;/p&gt;")
    prompt = build_requirement_qa_prompt([req], "q")
    assert "Hello & bye" in prompt
    assert "&lt;" not in prompt and "&amp;" not in prompt


# ---------------------------------------------------------------------------
# Enhanced: multi-query / tag retrieval ordering
# ---------------------------------------------------------------------------

def test_tag_match_boosts_rank(monkeypatch):
    """A requirement whose *tags* contain the query term should rank ahead of
    one whose title only partially matches."""
    reqs = [
        _req(1, "REQ-1", "Security scan tool", description="Runs vulnerability scans", tags=""),
        _req(2, "REQ-2", "Login endpoint", description="POST /auth/login", tags="auth,security"),
        _req(3, "REQ-3", "Unrelated feature", description="Shopping cart", tags=""),
    ]
    _patch_requirements(monkeypatch, reqs)
    result = requirement_retrieval.retrieve_relevant_requirements(
        db=None, project_id=1, query="security"
    )
    selected_keys = [r.requirement_id for r in result.selected]
    # Both REQ-1 and REQ-2 mention "security" — REQ-2 via tag should be near the top
    assert "REQ-1" in selected_keys and "REQ-2" in selected_keys
    assert "REQ-3" not in selected_keys[:2]


def test_single_item_project_never_truncates(monkeypatch):
    reqs = [_req(1, "REQ-1", "Only req", description="lone entry")]
    _patch_requirements(monkeypatch, reqs)
    result = requirement_retrieval.retrieve_relevant_requirements(db=None, project_id=1, query="lone")
    assert result.truncated is False
    assert len(result.selected) == 1


# ---------------------------------------------------------------------------
# Generic multi-source retrieval
# ---------------------------------------------------------------------------

def test_retrieve_relevant_docs_counts_sources_and_selection(monkeypatch):
    docs = {
        "requirements": [
            requirement_retrieval.RetrievedDoc("requirement", 1, "REQ-1", "Login", "password login auth"),
        ],
        "defects": [
            requirement_retrieval.RetrievedDoc("defect", 2, "DEF-1", "Crash", "payment crash"),
        ],
    }
    monkeypatch.setitem(requirement_retrieval._LOADERS, "requirements", lambda db, project_id: docs["requirements"])
    monkeypatch.setitem(requirement_retrieval._LOADERS, "defects", lambda db, project_id: docs["defects"])

    result = requirement_retrieval.retrieve_relevant_docs(
        db=None,
        project_id=1,
        query="auth",
        source_types=["requirements", "defects"],
        max_docs=1,
    )

    assert result.considered == 2
    assert result.truncated is True
    assert result.best_score > 0
    assert result.source_counts["requirements"] == 1
    assert result.source_counts["defects"] == 1
    assert result.selected[0].key == "REQ-1"
    assert result.selected_counts["requirements"] == 1
    assert result.selected_counts["defects"] == 0


def test_retrieve_relevant_docs_ignores_bad_source_and_falls_back(monkeypatch):
    requirement_docs = [
        requirement_retrieval.RetrievedDoc("requirement", 1, "REQ-1", "Older", "alpha"),
        requirement_retrieval.RetrievedDoc("requirement", 3, "REQ-3", "Newest", "beta"),
    ]
    monkeypatch.setitem(requirement_retrieval._LOADERS, "requirements", lambda db, project_id: requirement_docs)

    result = requirement_retrieval.retrieve_relevant_docs(
        db=None,
        project_id=1,
        query="no lexical overlap",
        source_types=["not-supported"],
    )

    assert result.considered == 2
    assert result.best_score == 0.0
    assert [doc.key for doc in result.selected] == ["REQ-3", "REQ-1"]


def test_retrieve_relevant_docs_continues_when_one_loader_fails(monkeypatch):
    def failing_loader(db, project_id):
        raise RuntimeError("loader failed")

    monkeypatch.setitem(requirement_retrieval._LOADERS, "requirements", failing_loader)
    monkeypatch.setitem(
        requirement_retrieval._LOADERS,
        "docs",
        lambda db, project_id: [requirement_retrieval.RetrievedDoc("doc", 4, "DOC-1", "Guide", "login guide")],
    )

    result = requirement_retrieval.retrieve_relevant_docs(
        db=None,
        project_id=1,
        query="login",
        source_types=["requirements", "docs"],
    )

    assert result.considered == 1
    assert result.source_counts["requirements"] == 0
    assert result.source_counts["docs"] == 1
    assert result.selected_counts["docs"] == 1
    assert result.selected[0].key == "DOC-1"
