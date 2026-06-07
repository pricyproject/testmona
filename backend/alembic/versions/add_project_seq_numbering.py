"""Add per-project project_seq numbering to project-scoped entities

Revision ID: add_project_seq_numbering
Revises: add_blocker_reason_to_test_results
Create Date: 2026-06-06 00:00:00.000000

Adds a nullable ``project_seq`` integer to every project-scoped, URL/badge-bearing
entity and backfills it with a stable per-project sequence (1..N ordered by id).

Requirements/Defects derive their seq from the numeric part of the existing
``requirement_id``/``defect_id`` so the URL matches the displayed REQ-/DEF- key;
everything else is numbered by row order within the project. ``test_cases`` has no
``project_id`` column (project is derived via its suite), so it is numbered via a
join and gets only a plain helper index.

A unique index on ``(project_id, project_seq)`` enforces per-project uniqueness for
allocated rows. ``project_seq`` is nullable and both SQLite and MariaDB allow
multiple NULLs under a UNIQUE index, so global/un-allocated rows are unaffected.
"""
import re

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

from app.services.migration_helpers import (
    add_column_if_missing,
    column_exists,
    drop_column_if_exists,
    index_exists,
    table_exists,
)

# revision identifiers, used by Alembic.
revision = "add_project_seq_numbering"
down_revision = "add_blocker_reason_to_test_results"
branch_labels = None
depends_on = None

# Tables with a real ``project_id`` column -> unique (project_id, project_seq) index.
_DIRECT_TABLES = [
    "custom_field_definitions",
    "shared_steps",
    "global_parameters",
    "test_datasets",
    "test_suites",
    "test_runs",
    "requirement_folders",
    "requirements",
    "defects",
    "test_plans",
    "milestones",
    "execution_environments",
    "doc_spaces",
    "docs",
]
# Numbered by row order within the project (ordered by id for stability).
_ROWNUM_TABLES = [
    "custom_field_definitions",
    "shared_steps",
    "global_parameters",
    "test_datasets",
    "test_suites",
    "test_runs",
    "requirement_folders",
    "test_plans",
    "milestones",
    "execution_environments",
    "doc_spaces",
    "docs",
]
# test_cases has no project_id column (project via suite) -> plain index only.
_ALL_TABLES = _DIRECT_TABLES + ["test_cases"]

_TRAILING_DIGITS = re.compile(r"(\d+)\s*$")


def _project_max(conn, table, project_id):
    row = conn.execute(
        text(f"SELECT MAX(project_seq) AS m FROM {table} WHERE project_id = :pid"),
        {"pid": project_id},
    ).fetchone()
    return (row.m or 0) if row else 0


def _backfill_rownum(conn, table, project_expr="project_id", from_clause=None, id_expr="id", seq_expr="project_seq"):
    """Assign 1..N per project, ordered by id."""
    from_clause = from_clause or table
    rows = conn.execute(
        text(
            f"SELECT {id_expr} AS id, {project_expr} AS pid FROM {from_clause} "
            f"WHERE {project_expr} IS NOT NULL AND {seq_expr} IS NULL "
            f"ORDER BY pid, {id_expr}"
        )
    ).fetchall()
    counters = {}
    for r in rows:
        counters[r.pid] = counters.get(r.pid, 0) + 1
        conn.execute(
            text(f"UPDATE {table} SET project_seq = :seq WHERE id = :id"),
            {"seq": counters[r.pid], "id": r.id},
        )


def _backfill_from_key(conn, table, key_col):
    """Derive seq from the trailing digits of an existing human key (REQ-007 -> 7)."""
    rows = conn.execute(
        text(f"SELECT id, project_id AS pid, {key_col} AS k FROM {table} WHERE project_id IS NOT NULL")
    ).fetchall()
    # Track used numbers per project so a missing/odd key falls back cleanly.
    used = {}
    leftovers = []
    for r in rows:
        m = _TRAILING_DIGITS.search(r.k or "")
        seq = int(m.group(1)) if m else None
        if seq is not None and seq not in used.setdefault(r.pid, set()):
            used[r.pid].add(seq)
            conn.execute(
                text(f"UPDATE {table} SET project_seq = :seq WHERE id = :id"),
                {"seq": seq, "id": r.id},
            )
        else:
            leftovers.append((r.pid, r.id))
    # Any row whose key was missing/non-numeric/duplicate gets the next free number.
    nxt = {}
    for pid, rid in leftovers:
        n = nxt.get(pid, _project_max(conn, table, pid)) + 1
        while n in used.get(pid, set()):
            n += 1
        used.setdefault(pid, set()).add(n)
        nxt[pid] = n
        conn.execute(
            text(f"UPDATE {table} SET project_seq = :seq WHERE id = :id"),
            {"seq": n, "id": rid},
        )


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Add the nullable column everywhere.
    for table in _ALL_TABLES:
        add_column_if_missing(op, table, sa.Column("project_seq", sa.Integer(), nullable=True))

    # 2a. Key-derived seq so the URL matches the displayed REQ-/DEF- badge.
    if column_exists(conn, "requirements", "project_seq"):
        _backfill_from_key(conn, "requirements", "requirement_id")
    if column_exists(conn, "defects", "project_seq"):
        _backfill_from_key(conn, "defects", "defect_id")

    # 2b. Row-number seq for the rest.
    for table in _ROWNUM_TABLES:
        if column_exists(conn, table, "project_seq"):
            _backfill_rownum(conn, table)

    # 2c. test_cases: project derived via the suite.
    if column_exists(conn, "test_cases", "project_seq") and table_exists(conn, "test_suites"):
        _backfill_rownum(
            conn,
            "test_cases",
            project_expr="ts.project_id",
            from_clause="test_cases tc JOIN test_suites ts ON tc.test_suite_id = ts.id",
            id_expr="tc.id",
            seq_expr="tc.project_seq",
        )

    # 3. Per-project uniqueness for allocated rows (NULLs allowed).
    for table in _DIRECT_TABLES:
        idx = f"uq_{table}_project_seq"
        if column_exists(conn, table, "project_seq") and not index_exists(conn, table, idx):
            op.create_index(idx, table, ["project_id", "project_seq"], unique=True)
    if column_exists(conn, "test_cases", "project_seq") and not index_exists(
        conn, "test_cases", "ix_test_cases_project_seq"
    ):
        op.create_index("ix_test_cases_project_seq", "test_cases", ["project_seq"])


def downgrade() -> None:
    conn = op.get_bind()
    for table in _DIRECT_TABLES:
        idx = f"uq_{table}_project_seq"
        if index_exists(conn, table, idx):
            op.drop_index(idx, table_name=table)
    if index_exists(conn, "test_cases", "ix_test_cases_project_seq"):
        op.drop_index("ix_test_cases_project_seq", table_name="test_cases")
    for table in _ALL_TABLES:
        drop_column_if_exists(op, table, "project_seq")
