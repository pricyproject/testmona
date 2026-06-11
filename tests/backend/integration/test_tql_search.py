"""Integration tests for TQL execute_search, export_search, and value_suggestions.

Every test here needs a real SQLite database session.  The seeded_db and
values_db fixtures come from tests/backend/conftest.py.

Pure compiler / AST tests (no DB) live in tests/backend/unit/test_tql_compiler.py.
"""

from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services.tql import (
    EvalContext,
    TQLError,
    DEFECT_REGISTRY,
    compile_tql,
    execute_search,
    export_search,
    value_suggestions,
)
from app.services.tql.compiler import _compile_node
from app.services.tql import nodes
from sqlalchemy.dialects import sqlite as sqlite_dialect


CTX = EvalContext(current_user_id=42, now=datetime(2026, 6, 3, tzinfo=timezone.utc))


def _have_lark():
    try:
        import lark  # noqa: F401
        return True
    except ImportError:
        return False


def _sql(clause):
    return str(clause.compile(dialect=sqlite_dialect.dialect(), compile_kwargs={"literal_binds": True}))


def _fresh_db():
    """In-memory SQLite session with all tables created."""
    from app.database import Base
    from app import models  # noqa: F401

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


# ---------------------------------------------------------------------------
# Project scoping (security-critical)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_execute_search_scopes_to_project(seeded_db):
    res = execute_search(seeded_db, "defects", project_id=1, tql="status = OPEN", context=CTX)
    keys = [r["key"] for r in res["results"]]
    assert keys == ["DEF-1"]


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_execute_search_current_user(seeded_db):
    ctx = EvalContext(current_user_id=1, now=CTX.now)
    res = execute_search(seeded_db, "defects", project_id=1, tql="assignee = currentUser()", context=ctx)
    assert [r["key"] for r in res["results"]] == ["DEF-1"]


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_execute_search_testcases_join_scope_and_soft_delete(seeded_db):
    res = execute_search(seeded_db, "test_cases", project_id=1,
                         tql="status = active AND priority = high", context=CTX)
    assert [r["key"] for r in res["results"]] == ["TC-1"]


def test_execute_search_unknown_entity_raises(seeded_db):
    with pytest.raises(TQLError):
        execute_search(seeded_db, "widgets", project_id=1, tql=None, context=CTX)


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_execute_search_pagination_total_and_offset(seeded_db):
    from app import models

    for i in range(3, 8):
        seeded_db.add(models.Defect(
            id=i, title=f"Bug {i}", defect_id=f"DEF-{i}",
            project_id=1, status=models.DefectStatus.OPEN, reported_by=1,
        ))
    seeded_db.commit()

    page0 = execute_search(seeded_db, "defects", 1, "status = OPEN", CTX, limit=3, offset=0)
    page1 = execute_search(seeded_db, "defects", 1, "status = OPEN", CTX, limit=3, offset=3)

    assert page0["total"] == 6 and page0["count"] == 3 and page0["offset"] == 0
    assert page1["offset"] == 3
    assert set(r["id"] for r in page0["results"]).isdisjoint(r["id"] for r in page1["results"])


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_export_search_returns_all_capped(seeded_db):
    entity, rows = export_search(seeded_db, "defects", 1, "status = OPEN", CTX)
    assert entity == "defects"
    assert [r["key"] for r in rows] == ["DEF-1"]
    assert "title" in rows[0] and "status" in rows[0]


# ---------------------------------------------------------------------------
# Value suggestions
# ---------------------------------------------------------------------------

def test_value_suggestions_splits_tags_and_scopes_to_project(values_db):
    assert value_suggestions(values_db, "defects", "tags", 1, "") == ["api", "auth", "login", "ui"]
    assert value_suggestions(values_db, "defects", "tags", 1, "au") == ["auth"]
    assert "leaked-tag" not in value_suggestions(values_db, "defects", "tags", 1, "")


def test_value_suggestions_distinct_text_field(values_db):
    assert value_suggestions(values_db, "defects", "environment", 1, "") == ["prod", "staging"]


def test_value_suggestions_ignores_non_suggest_fields(values_db):
    assert value_suggestions(values_db, "defects", "description", 1, "x") == []


# ---------------------------------------------------------------------------
# Tag membership (requires full query round-trip)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_tag_eq_finds_row_with_multiple_tags():
    from app import models

    db = _fresh_db()
    db.add(models.User(id=1, username="u", email="u@x.com", hashed_password="x", full_name="U"))
    db.add(models.Project(id=2, name="P2", owner_id=1))
    db.add(models.Requirement(id=3, title="Auth", requirement_id="REQ-3", project_id=2,
                              created_by=1, tags="security,login"))
    db.add(models.Requirement(id=4, title="Other", requirement_id="REQ-4", project_id=2,
                              created_by=1, tags="ui, security-audit"))
    db.commit()

    def keys(tql):
        return [r["key"] for r in execute_search(db, "requirements", 2, tql, CTX)["results"]]

    assert keys('tags = "security"') == ["REQ-3"]
    assert keys('tags = "login"') == ["REQ-3"]
    assert keys('tags = "security-audit"') == ["REQ-4"]


# ---------------------------------------------------------------------------
# TestResult / execution synonym search (requires full round-trip)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_execution_status_search_matches_synonyms_end_to_end():
    from app import models

    db = _fresh_db()
    db.add(models.User(id=1, username="u", email="u@x.com", hashed_password="x", full_name="U"))
    db.add(models.Project(id=1, name="P1", owner_id=1))
    db.add(models.TestSuite(id=1, name="S1", project_id=1))
    db.add(models.TestCase(id=1, title="TC", test_suite_id=1, status="active"))
    db.add(models.TestRun(id=1, name="R1", project_id=1))
    db.add(models.TestResult(id=1, test_case_id=1, test_run_id=1, status="skip"))
    db.add(models.TestResult(id=2, test_case_id=1, test_run_id=1, status="skipped"))
    db.add(models.TestResult(id=3, test_case_id=1, test_run_id=1, status="pending"))
    db.add(models.TestResult(id=4, test_case_id=1, test_run_id=1, status="pass"))
    db.commit()

    def keys(tql):
        return sorted(r["key"] for r in execute_search(db, "test_executions", 1, tql, CTX)["results"])

    assert keys('status = "skipped"') == ["EX-1", "EX-2"]
    assert keys('status = skip') == ["EX-1", "EX-2"]
    assert keys('status = not_started') == ["EX-3"]
    assert keys('status = "not started"') == ["EX-3"]
    assert keys('status = pending') == ["EX-3"]
    assert keys('status = passed') == ["EX-4"]


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_test_executions_map_to_test_results_and_scope_via_run():
    from app import models

    db = _fresh_db()
    db.add(models.User(id=1, username="me", email="me@x.com", hashed_password="x", full_name="Me"))
    db.add(models.User(id=2, username="other", email="o@x.com", hashed_password="x", full_name="Other"))
    db.add(models.Project(id=1, name="P1", owner_id=1))
    db.add(models.Project(id=2, name="P2", owner_id=1))
    db.add(models.TestSuite(id=1, name="S1", project_id=1))
    db.add(models.TestCase(id=1, title="Login TC", test_suite_id=1, status="active"))
    db.add(models.TestRun(id=1, name="R1", project_id=1))
    db.add(models.TestRun(id=2, name="R2", project_id=2))
    db.add(models.TestResult(id=1, test_case_id=1, test_run_id=1, executed_by=1, status="pass"))
    db.add(models.TestResult(id=2, test_case_id=1, test_run_id=1, executed_by=2, status="fail"))
    db.add(models.TestResult(id=3, test_case_id=1, test_run_id=2, executed_by=1, status="pass"))
    db.commit()

    ctx = EvalContext(current_user_id=1, now=CTX.now)
    res = execute_search(db, "test_executions", 1, "", ctx)
    assert sorted(r["key"] for r in res["results"]) == ["EX-1", "EX-2"]
    assert res["results"][0]["title"] == "Login TC"

    mine = execute_search(db, "test_executions", 1, "executor = currentUser()", ctx)
    assert [r["key"] for r in mine["results"]] == ["EX-1"]

    by_title = execute_search(db, "test_executions", 1, 'title ~ "login"', ctx)
    assert sorted(r["key"] for r in by_title["results"]) == ["EX-1", "EX-2"]


# ---------------------------------------------------------------------------
# Enhanced: empty-TQL returns all project rows
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_empty_tql_returns_all_project_defects(seeded_db):
    """An empty TQL string should return all defects for the given project."""
    res = execute_search(seeded_db, "defects", project_id=1, tql="", context=CTX)
    assert res["total"] >= 1
    for row in res["results"]:
        assert row["key"].startswith("DEF-")


@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_cross_project_isolation_requirements(seeded_db):
    """Requirements from project 2 must never appear in project 1 results."""
    from app import models

    seeded_db.add(models.Requirement(id=10, title="P2 req", requirement_id="REQ-10",
                                     project_id=2, created_by=1))
    seeded_db.add(models.Requirement(id=11, title="P1 req", requirement_id="REQ-11",
                                     project_id=1, created_by=1))
    seeded_db.commit()

    res = execute_search(seeded_db, "requirements", project_id=1, tql="", context=CTX)
    keys = [r["key"] for r in res["results"]]
    assert "REQ-11" in keys
    assert "REQ-10" not in keys


# ---------------------------------------------------------------------------
# NULL / empty-string semantics (requires full round-trip)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _have_lark(), reason="lark not installed")
def test_is_empty_counts_empty_string_and_ne_keeps_null_rows():
    """Forms submit unset text inputs as "" — IS EMPTY must treat '' like NULL,
    and != must agree with NOT IN about rows whose field is unset."""
    from app import models

    db = _fresh_db()
    db.add(models.User(id=1, username="u", email="u@x.com", hashed_password="x", full_name="U"))
    db.add(models.Project(id=1, name="P1", owner_id=1))
    db.add(models.Defect(id=1, title="tagged", defect_id="DEF-1", project_id=1,
                         reported_by=1, tags="security", environment="staging"))
    db.add(models.Defect(id=2, title="blank tags", defect_id="DEF-2", project_id=1,
                         reported_by=1, tags="", environment=None))
    db.add(models.Defect(id=3, title="null tags", defect_id="DEF-3", project_id=1,
                         reported_by=1, tags=None, environment="prod"))
    db.commit()

    def keys(tql):
        return sorted(r["key"] for r in execute_search(db, "defects", 1, tql, CTX)["results"])

    assert keys("tags IS EMPTY") == ["DEF-2", "DEF-3"]
    assert keys("tags IS NOT EMPTY") == ["DEF-1"]
    # != and NOT IN must agree: the unset-environment row "is not staging".
    assert keys("environment != staging") == ["DEF-2", "DEF-3"]
    assert keys("environment NOT IN (staging)") == ["DEF-2", "DEF-3"]
