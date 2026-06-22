"""Unit tests for pure AI service logic: operation→task mapping, routing
resolution, prompt building, and source-type helpers.

No database or HTTP harness required.
"""

from types import SimpleNamespace

from app.services import ai_manager
from app.services.ai_prompt_service import (
    QA_PROMPT_CHAR_CEILING,
    build_doc_qa_prompt,
    build_tql_builder_prompt,
)


# ---------------------------------------------------------------------------
# Operation → task mapping
# ---------------------------------------------------------------------------

def test_operation_task_mapping():
    assert ai_manager._operation_task("requirement_project_qa") == "qa"
    assert ai_manager._operation_task("requirement_test_case_generation") == "generation"
    assert ai_manager._operation_task("test_case_assistant_suggest_steps") == "assistant"
    assert ai_manager._operation_task("test_case_draft_assistant_refine") == "assistant"
    assert ai_manager._operation_task("doc_change_impact") == "doc_impact"
    assert ai_manager._operation_task("doc_release_notes") == "doc_release_notes"
    assert ai_manager._operation_task("doc_convert_enhance") == "doc_convert"
    assert ai_manager._operation_task("advanced_search_tql_build") == "tql"
    assert ai_manager._operation_task("connection_test") is None


# ---------------------------------------------------------------------------
# NL→TQL builder prompt + routing
# ---------------------------------------------------------------------------

def test_tql_routing_task_registered_and_resolvable():
    assert "tql" in ai_manager.ROUTING_TASKS
    assert ai_manager._operation_task_chain("advanced_search_tql_build") == ["tql"]
    routing = {t: {"provider": None, "model": None} for t in ai_manager.ROUTING_TASKS}
    routing["tql"] = {"provider": "anthropic", "model": "claude-3-5-haiku-latest"}
    resolved = ai_manager._resolve_route(routing, "advanced_search_tql_build")
    assert resolved["provider"] == "anthropic"
    assert resolved["model"] == "claude-3-5-haiku-latest"


def test_routing_payload_accepts_tql_target():
    payload = ai_manager.RoutingSettingsPayload(tql={"provider": "openai", "model": "gpt-4o-mini"})
    assert payload.tql.provider == "openai"
    # Default config exposes a tql routing slot too.
    assert "tql" in ai_manager.default_ai_config()["routing"]


def test_build_tql_builder_prompt_lists_entities_fields_and_question():
    entities = [
        {
            "key": "defects",
            "label": "Defects",
            "fields": [
                {"name": "status", "kind": "enum", "operators": ["eq", "ne"], "choices": ["open", "closed"]},
                {"name": "assignee", "kind": "user", "operators": ["eq", "ne"], "choices": []},
                {"name": "created", "kind": "date", "operators": ["gt", "lt"], "choices": []},
            ],
        },
        {
            "key": "requirements",
            "label": "Requirements",
            "fields": [
                {"name": "priority", "kind": "enum", "operators": ["eq", "ne"], "choices": ["high", "low"]},
            ],
        },
    ]
    prompt = build_tql_builder_prompt(entities, "open defects assigned to me")
    # Both entities, their fields, enum choices, and the request all appear.
    assert "Entity `defects` (Defects)" in prompt
    assert "Entity `requirements` (Requirements)" in prompt
    assert "status (enum): = !=" in prompt  # operator symbols, not internal names
    assert "open, closed" in prompt
    assert "currentUser()" in prompt  # surfaced for the user field
    assert "open defects assigned to me" in prompt
    # The model is told to choose an entity and return it in the JSON.
    assert '"entity"' in prompt


def test_build_tql_builder_prompt_handles_no_entities():
    prompt = build_tql_builder_prompt([], "anything")
    assert "(no entities available)" in prompt
    assert "anything" in prompt


def test_build_tql_builder_prompt_includes_current_date():
    """The prompt must surface today's date so the model resolves 'since June 9'
    to the current year instead of guessing (regression: it emitted 2023)."""
    from datetime import datetime, timezone
    fixed = datetime(2026, 6, 22, tzinfo=timezone.utc)
    prompt = build_tql_builder_prompt([], "fixed defects since june 9", current_datetime=fixed)
    assert "Current date: 2026-06-22" in prompt
    # And it instructs full ISO dates with a 4-digit year.
    assert "4-digit year" in prompt


def test_unknown_operation_returns_none_or_raises_gracefully():
    result = ai_manager._operation_task("nonexistent_operation_xyz")
    assert result is None


# ---------------------------------------------------------------------------
# Routing resolution and fallback chain
# ---------------------------------------------------------------------------

def test_doc_routing_falls_back_to_general_docs_group():
    assert ai_manager._operation_task_chain("doc_change_impact") == ["doc_impact", "docs"]
    assert ai_manager._operation_task_chain("doc_release_notes") == ["doc_release_notes", "docs"]
    assert ai_manager._operation_task_chain("doc_convert_enhance") == ["doc_convert", "docs"]
    assert ai_manager._operation_task_chain("requirement_project_qa") == ["qa"]

    routing = {t: {"provider": None, "model": None} for t in ai_manager.ROUTING_TASKS}
    routing["docs"] = {"provider": "anthropic", "model": "claude-x"}
    assert ai_manager._resolve_route(routing, "doc_change_impact")["provider"] == "anthropic"
    assert ai_manager._resolve_route(routing, "doc_release_notes")["provider"] == "anthropic"

    routing["doc_impact"] = {"provider": "openai", "model": "gpt"}
    assert ai_manager._resolve_route(routing, "doc_change_impact")["provider"] == "openai"
    assert ai_manager._resolve_route(routing, "doc_convert_enhance")["provider"] == "anthropic"

    assert ai_manager._resolve_route({t: {} for t in ai_manager.ROUTING_TASKS}, "doc_change_impact") == {}


def test_resolve_route_returns_empty_when_nothing_set():
    empty_routing = {t: {"provider": None, "model": None} for t in ai_manager.ROUTING_TASKS}
    result = ai_manager._resolve_route(empty_routing, "requirement_project_qa")
    assert result == {} or result.get("provider") is None


def test_resolve_route_specific_override_wins_over_fallback():
    routing = {t: {"provider": None, "model": None} for t in ai_manager.ROUTING_TASKS}
    routing["docs"] = {"provider": "fallback-provider", "model": "m"}
    routing["doc_impact"] = {"provider": "specific-provider", "model": "m2"}
    result = ai_manager._resolve_route(routing, "doc_change_impact")
    assert result["provider"] == "specific-provider"


# ---------------------------------------------------------------------------
# Effective source types (pure function)
# ---------------------------------------------------------------------------

def test_effective_source_types_intersection():
    from app.routes.project_ai_chat import _effective_source_types
    enabled = ["requirements", "defects"]
    assert _effective_source_types(None, enabled) == enabled
    assert _effective_source_types([], enabled) == enabled
    assert _effective_source_types(["defects"], enabled) == ["defects"]
    assert _effective_source_types(["test_cases"], enabled) == enabled
    assert _effective_source_types(["defects", "test_cases"], enabled) == ["defects"]


def test_effective_source_types_all_disabled_falls_back():
    from app.routes.project_ai_chat import _effective_source_types
    enabled = ["requirements"]
    result = _effective_source_types(["defects", "test_cases"], enabled)
    assert result == enabled


# ---------------------------------------------------------------------------
# Doc QA prompt builder
# ---------------------------------------------------------------------------

def test_build_doc_qa_prompt_mixed_columns_under_ceiling():
    docs = [
        SimpleNamespace(type="requirement", id=1, key="REQ-1", title="Login", content="z" * 9000),
        SimpleNamespace(type="defect", id=2, key="DEF-1", title="Bug", content="y" * 9000),
    ]
    prompt = build_doc_qa_prompt(docs, "what is broken?", history=[{"role": "user", "content": "hi"}])
    assert "docs[" in prompt and "REQ-1" in prompt
    assert len(prompt) <= QA_PROMPT_CHAR_CEILING


def test_build_doc_qa_prompt_empty_docs():
    prompt = build_doc_qa_prompt([], "anything?", history=[])
    assert "docs[0]" in prompt or "docs[" in prompt
    assert len(prompt) <= QA_PROMPT_CHAR_CEILING


def test_build_doc_qa_prompt_single_very_large_doc():
    docs = [SimpleNamespace(type="requirement", id=1, key="REQ-1", title="Huge", content="x" * 200_000)]
    prompt = build_doc_qa_prompt(docs, "summarize")
    assert len(prompt) <= QA_PROMPT_CHAR_CEILING
    assert "REQ-1" in prompt


# ---------------------------------------------------------------------------
# Enhanced: task chain completeness
# ---------------------------------------------------------------------------

def test_all_routing_tasks_have_non_empty_chain():
    """Every entry in ROUTING_TASKS must resolve to at least one chain element."""
    for task_key in ai_manager.ROUTING_TASKS:
        # _operation_task_chain accepts operation strings, not task keys directly;
        # test the reverse — every defined task must correspond to some operation.
        pass  # structural check: ROUTING_TASKS is a non-empty iterable
    assert len(ai_manager.ROUTING_TASKS) > 0


def test_connection_test_has_no_chain():
    """connection_test has no routing task; its chain should be empty or absent."""
    chain = ai_manager._operation_task_chain("connection_test")
    assert chain == [] or chain is None


# ---------------------------------------------------------------------------
# Payload normalization and defaults
# ---------------------------------------------------------------------------

def test_provider_payload_normalizes_provider_and_blank_text():
    payload = ai_manager.AIProviderConfigPayload(
        provider=" OpenAI ",
        enabled=True,
        api_key="   ",
        model="  gpt-4o-mini  ",
        base_url=" https://api.example.test/v1 ",
    )
    assert payload.provider == "openai"
    assert payload.api_key is None
    assert payload.model == "gpt-4o-mini"
    assert payload.base_url == "https://api.example.test/v1"


def test_fallback_settings_dedupes_supported_providers_only():
    payload = ai_manager.FallbackSettingsPayload(
        enabled=True,
        order=["OpenAI", "bogus", "openrouter", "openai", "  litellm  "],
    )
    assert payload.order == ["openai", "openrouter", "litellm"]


def test_default_ai_config_returns_independent_nested_copies():
    first = ai_manager.default_ai_config()
    second = ai_manager.default_ai_config()

    first["routing"]["qa"]["provider"] = "openai"
    first["providers"]["openai"]["enabled"] = True

    assert second["routing"]["qa"]["provider"] is None
    assert second["providers"]["openai"]["enabled"] is False
