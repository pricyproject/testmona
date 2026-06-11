"""Unit tests for the TQL compiler, field registry, and AST node evaluation.

No database or HTTP harness is required: all assertions compile AST nodes
directly to SQL strings using the SQLite dialect with literal binds.

DB-backed execute_search / export_search / value_suggestions tests live in
tests/backend/integration/test_tql_search.py.
"""

from datetime import datetime, timezone

import pytest
from sqlalchemy.dialects import sqlite

from app.services.tql import compile_tql, DEFECT_REGISTRY, EvalContext, TQLError
from app.services.tql import nodes
from app.services.tql.compiler import _compile_node, _compile_order


CTX = EvalContext(current_user_id=42, now=datetime(2026, 6, 3, tzinfo=timezone.utc))


def _sql(clause):
    return str(clause.compile(dialect=sqlite.dialect(), compile_kwargs={"literal_binds": True}))


def _compile(node):
    return _sql(_compile_node(node, DEFECT_REGISTRY, CTX))


def _have_lark():
    try:
        import lark  # noqa: F401
        return True
    except ImportError:
        return False


# ---------------------------------------------------------------------------
# Enum handling
# ---------------------------------------------------------------------------

def test_enum_eq_uses_member_name():
    node = nodes.Comparison("status", "eq", nodes.BarewordVal("open"))
    assert _compile(node) == "defects.status = 'OPEN'"


def test_enum_in_accepts_name_and_value_case_insensitively():
    node = nodes.InList("priority", [nodes.BarewordVal("HIGH"), nodes.BarewordVal("urgent")])
    assert _compile(node) == "defects.priority IN ('HIGH', 'URGENT')"


def test_invalid_enum_value_raises_with_allowed_list():
    node = nodes.Comparison("status", "eq", nodes.BarewordVal("nope"))
    with pytest.raises(TQLError) as exc:
        _compile(node)
    assert "open" in str(exc.value)


# ---------------------------------------------------------------------------
# Context-aware values: currentUser(), relative dates
# ---------------------------------------------------------------------------

def test_current_user_resolves_from_context():
    node = nodes.Comparison("assignee", "eq", nodes.FuncVal("currentUser"))
    assert _compile(node) == "defects.assigned_to = 42"


def test_current_user_requires_context_user_id():
    node = nodes.Comparison("assignee", "eq", nodes.FuncVal("currentUser"))
    with pytest.raises(TQLError) as exc:
        _sql(_compile_node(node, DEFECT_REGISTRY, EvalContext()))
    assert "currentUser" in str(exc.value)


def test_unknown_user_function_raises():
    node = nodes.Comparison("assignee", "eq", nodes.FuncVal("currentTeam"))
    with pytest.raises(TQLError) as exc:
        _compile(node)
    assert "currentTeam()" in str(exc.value)


def test_relative_date_offsets_from_now():
    node = nodes.Comparison("created", "gte", nodes.RelDateVal(-7, "d"))
    assert "2026-05-27" in _compile(node)


def test_now_function_resolves_from_context_clock():
    node = nodes.Comparison("created", "lte", nodes.FuncVal("now"))
    assert "2026-06-03" in _compile(node)


def test_unknown_date_function_raises():
    node = nodes.Comparison("created", "lte", nodes.FuncVal("today"))
    with pytest.raises(TQLError) as exc:
        _compile(node)
    assert "today()" in str(exc.value)


# ---------------------------------------------------------------------------
# Text / LIKE escaping
# ---------------------------------------------------------------------------

def test_contains_escapes_like_wildcards():
    node = nodes.Comparison("summary", "contains", nodes.StringVal("a%b_c"))
    out = _compile(node)
    assert "a\\%b\\_c" in out
    assert "ESCAPE" in out


def test_contains_escapes_backslashes_before_like_wildcards():
    node = nodes.Comparison("summary", "contains", nodes.StringVal(r"c:\temp\a_%"))
    out = _compile(node)
    assert r"c:\\temp\\a\_\%" in out
    assert "ESCAPE" in out


# ---------------------------------------------------------------------------
# Empty checks and negation
# ---------------------------------------------------------------------------

def test_is_not_empty():
    node = nodes.EmptyCheck("resolution", negate=True)
    assert _compile(node) == "defects.resolution IS NOT NULL"


def test_is_empty():
    node = nodes.EmptyCheck("resolution", negate=False)
    assert _compile(node) == "defects.resolution IS NULL"


def test_is_empty_and_not_empty_compile_for_nullable_fields():
    node_empty = nodes.EmptyCheck("assignee", negate=False)
    node_not = nodes.EmptyCheck("assignee", negate=True)
    assert _sql(_compile_node(node_empty, DEFECT_REGISTRY, CTX)) == "defects.assigned_to IS NULL"
    assert _sql(_compile_node(node_not, DEFECT_REGISTRY, CTX)) == "defects.assigned_to IS NOT NULL"


# ---------------------------------------------------------------------------
# Boolean nesting
# ---------------------------------------------------------------------------

def test_nested_and_or():
    node = nodes.And([
        nodes.Comparison("status", "eq", nodes.BarewordVal("open")),
        nodes.Or([
            nodes.Comparison("priority", "eq", nodes.BarewordVal("high")),
            nodes.Comparison("priority", "eq", nodes.BarewordVal("urgent")),
        ]),
    ])
    assert _compile(node) == (
        "defects.status = 'OPEN' AND "
        "(defects.priority = 'HIGH' OR defects.priority = 'URGENT')"
    )


# ---------------------------------------------------------------------------
# Three-valued-logic NULL safety for negation
# ---------------------------------------------------------------------------

def test_ncontains_matches_null_rows():
    node = nodes.Comparison("description", "ncontains", nodes.StringVal("foo"))
    out = _compile(node)
    assert "description IS NULL" in out
    assert "OR" in out


def test_not_in_matches_null_rows():
    node = nodes.InList("status", [nodes.BarewordVal("open")], negate=True)
    out = _compile(node)
    assert "status IS NULL" in out


def test_in_requires_at_least_one_value():
    node = nodes.InList("status", [], negate=False)
    with pytest.raises(TQLError) as exc:
        _compile(node)
    assert "at least one value" in str(exc.value)


def test_tag_ne_matches_null_rows():
    from app.services.tql import REQUIREMENT_REGISTRY
    node = nodes.Comparison("tags", "ne", nodes.StringVal("security"))
    out = _sql(_compile_node(node, REQUIREMENT_REGISTRY, CTX))
    assert "tags IS NULL" in out


# ---------------------------------------------------------------------------
# Registry guards
# ---------------------------------------------------------------------------

def test_unknown_field_raises():
    node = nodes.Comparison("bogus", "eq", nodes.BarewordVal("x"))
    with pytest.raises(TQLError):
        _compile(node)


def test_operator_not_allowed_on_enum_field():
    node = nodes.Comparison("status", "contains", nodes.StringVal("x"))
    with pytest.raises(TQLError):
        _compile(node)


def test_order_by_asc_and_desc():
    asc = _sql(_compile_order(nodes.OrderKey("created", descending=False), DEFECT_REGISTRY))
    desc = _sql(_compile_order(nodes.OrderKey("created", descending=True), DEFECT_REGISTRY))
    assert asc.endswith("ASC")
    assert desc.endswith("DESC")


# ---------------------------------------------------------------------------
# Multi-entity registries
# ---------------------------------------------------------------------------

def test_requirement_registry_enum_uses_name():
    from app.services.tql import REQUIREMENT_REGISTRY
    node = nodes.Comparison("status", "eq", nodes.BarewordVal("approved"))
    assert _sql(_compile_node(node, REQUIREMENT_REGISTRY, CTX)) == "requirements.status = 'APPROVED'"


def test_testcase_registry_keyword_field_stores_lowercase():
    from app.services.tql import TESTCASE_REGISTRY
    node = nodes.Comparison("status", "eq", nodes.BarewordVal("ACTIVE"))
    assert _sql(_compile_node(node, TESTCASE_REGISTRY, CTX)) == "test_cases.status = 'active'"


def test_testcase_invalid_keyword_raises():
    from app.services.tql import TESTCASE_REGISTRY
    node = nodes.Comparison("priority", "eq", nodes.BarewordVal("nonsense"))
    with pytest.raises(TQLError):
        _compile_node(node, TESTCASE_REGISTRY, CTX)


def test_get_entity_unknown_raises():
    from app.services.tql import get_entity
    with pytest.raises(TQLError):
        get_entity("widgets")


def test_entity_catalog_shape():
    from app.services.tql import entity_catalog
    catalog = entity_catalog()
    keys = {e["key"] for e in catalog}
    assert {"defects", "requirements", "test_cases"} <= keys
    defects = next(e for e in catalog if e["key"] == "defects")
    status = next(f for f in defects["fields"] if f["name"] == "status")
    assert status["kind"] == "enum"
    assert "open" in status["choices"]
    assert "eq" in status["operators"]


def test_new_entities_in_catalog():
    from app.services.tql import entity_catalog
    keys = {e["key"] for e in entity_catalog()}
    assert {"test_plans", "test_executions", "docs"} <= keys


def test_testplan_and_doc_registries_compile():
    from app.services.tql import TESTPLAN_REGISTRY, DOC_REGISTRY
    tp = _sql(_compile_node(nodes.Comparison("status", "eq", nodes.BarewordVal("running")), TESTPLAN_REGISTRY, CTX))
    assert tp == "test_plans.status = 'RUNNING'"
    doc = _sql(_compile_node(nodes.Comparison("status", "eq", nodes.BarewordVal("published")), DOC_REGISTRY, CTX))
    assert doc == "docs.status = 'PUBLISHED'"


def test_id_field_searchable_on_all_entities():
    from app.services.tql import (
        DEFECT_REGISTRY, REQUIREMENT_REGISTRY, TESTCASE_REGISTRY,
        TESTPLAN_REGISTRY, TESTEXECUTION_REGISTRY, DOC_REGISTRY,
    )
    for reg in (DEFECT_REGISTRY, REQUIREMENT_REGISTRY, TESTCASE_REGISTRY,
                TESTPLAN_REGISTRY, TESTEXECUTION_REGISTRY, DOC_REGISTRY):
        node = nodes.Comparison("id", "eq", nodes.NumberVal(5))
        # "id" maps to the per-project sequence column (project_seq), not the
        # raw database primary key.
        sql = _sql(_compile_node(node, reg, CTX))
        assert "= 5" in sql


# ---------------------------------------------------------------------------
# Execution / synonym normalization (pure compile, no DB)
# ---------------------------------------------------------------------------

def test_execution_status_synonym_normalized():
    from app.services.tql import entity_catalog, TESTEXECUTION_REGISTRY
    cat = next(e for e in entity_catalog() if e["key"] == "test_executions")
    status = next(f for f in cat["fields"] if f["name"] == "status")
    assert set(status["choices"]) == {"pass", "fail", "skip", "block", "not_started"}
    assert status["suggest"] is True

    sql = _sql(_compile_node(nodes.Comparison("status", "eq", nodes.BarewordVal("skipped")), TESTEXECUTION_REGISTRY, CTX))
    assert sql.rstrip().endswith("= 'skip'") and "'skipped'" in sql

    sql2 = _sql(_compile_node(nodes.Comparison("status", "eq", nodes.BarewordVal("passed")), TESTEXECUTION_REGISTRY, CTX))
    assert sql2.rstrip().endswith("= 'pass'")

    for token in ("pending", "not_started"):
        s = _sql(_compile_node(nodes.Comparison("status", "eq", nodes.BarewordVal(token)), TESTEXECUTION_REGISTRY, CTX))
        assert s.rstrip().endswith("= 'not_started'")


# ---------------------------------------------------------------------------
# Tag membership matching (pure compile, no DB)
# ---------------------------------------------------------------------------

def test_tag_eq_matches_list_membership():
    from app.services.tql import REQUIREMENT_REGISTRY
    node = nodes.Comparison("tags", "eq", nodes.StringVal("security"))
    sql = _sql(_compile_node(node, REQUIREMENT_REGISTRY, CTX))
    assert "LIKE" in sql and "%,security,%" in sql
    assert "tags = " not in sql


# ---------------------------------------------------------------------------
# CSV formula injection guard
# ---------------------------------------------------------------------------

def test_csv_export_neutralizes_formula_injection():
    from app.routes.advanced_search import _csv_safe
    assert _csv_safe("=cmd|' /C calc'!A1") == "'=cmd|' /C calc'!A1"
    assert _csv_safe("+danger") == "'+danger"
    assert _csv_safe("-1+1") == "'-1+1"
    assert _csv_safe("@SUM(A1)") == "'@SUM(A1)"
    assert _csv_safe("Login broken") == "Login broken"
    assert _csv_safe(42) == 42
    assert _csv_safe(None) is None


# ---------------------------------------------------------------------------
# Full pipeline (requires lark)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_end_to_end_parse_and_compile():
    compiled = compile_tql(
        'status = OPEN AND priority IN (HIGH, URGENT) AND assignee = currentUser() '
        'AND created >= -7d AND summary ~ "login" ORDER BY priority DESC',
        DEFECT_REGISTRY,
        CTX,
    )
    where = _sql(compiled.where)
    assert "defects.status = 'OPEN'" in where
    assert "defects.priority IN ('HIGH', 'URGENT')" in where
    assert "defects.assigned_to = 42" in where
    assert len(compiled.order_by) == 1
    assert _sql(compiled.order_by[0]).endswith("DESC")


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_unquoted_hyphenated_key_parses():
    compiled = compile_tql("key = DEF-2", DEFECT_REGISTRY, CTX)
    assert _sql(compiled.where) == "defects.defect_id = 'DEF-2'"


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_is_empty_parses_end_to_end_across_entities():
    from app.services.tql import REQUIREMENT_REGISTRY, TESTCASE_REGISTRY
    for reg in (DEFECT_REGISTRY, REQUIREMENT_REGISTRY):
        compiled = compile_tql("assignee IS EMPTY", reg, CTX)
        assert "IS NULL" in _sql(compiled.where)
    compiled = compile_tql("tags IS NOT EMPTY", TESTCASE_REGISTRY, CTX)
    assert "IS NOT NULL" in _sql(compiled.where)


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_is_is_not_are_equality_synonyms():
    from app.services.tql import REQUIREMENT_REGISTRY
    assert _sql(compile_tql("status IS approved", REQUIREMENT_REGISTRY, CTX).where) == "requirements.status = 'APPROVED'"
    assert _sql(compile_tql("status IS NOT approved", REQUIREMENT_REGISTRY, CTX).where) == "requirements.status != 'APPROVED'"
    assert _sql(compile_tql("creator IS currentUser()", REQUIREMENT_REGISTRY, EvalContext(current_user_id=7)).where) == "requirements.created_by = 7"
    assert _sql(compile_tql("creator IS EMPTY", REQUIREMENT_REGISTRY, CTX).where) == "requirements.created_by IS NULL"
    assert _sql(compile_tql("creator IS NOT EMPTY", REQUIREMENT_REGISTRY, CTX).where) == "requirements.created_by IS NOT NULL"


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_ast_to_json_round_trips_shape():
    from app.services.tql import ast_to_json, parse
    ast = ast_to_json(parse('status IS approved AND priority IN (high, low) ORDER BY created DESC'))
    assert ast["where"]["type"] == "and"
    parts = ast["where"]["parts"]
    assert parts[0] == {"type": "comparison", "field": "status", "op": "eq",
                        "value": {"kind": "bareword", "value": "approved"}}
    assert parts[1]["type"] == "in" and parts[1]["field"] == "priority"
    assert ast["order_by"] == [{"field": "created", "descending": True}]


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_friendly_parse_errors_are_actionable():
    for q in ("priority IN (HIGH,", "status = OPEN AND"):
        with pytest.raises(TQLError) as exc:
            compile_tql(q, DEFECT_REGISTRY, CTX)
        assert "unfinished" in str(exc.value).lower()
        assert "Expected one of" not in str(exc.value)
        assert "Token(" not in str(exc.value)

    with pytest.raises(TQLError) as exc:
        compile_tql("status = OPEN priority = HIGH", DEFECT_REGISTRY, CTX)
    msg = str(exc.value)
    assert "priority" in msg and "AND/OR" in msg


def test_missing_lark_raises_tqlerror_not_importerror():
    if _have_lark():
        pytest.skip("lark installed; cannot exercise the missing-dependency path")
    with pytest.raises(TQLError):
        compile_tql("status = OPEN", DEFECT_REGISTRY, CTX)
