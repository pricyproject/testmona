"""Make test type / priority / step-template definitions per-project

Revision ID: add_project_scoped_definitions
Revises: add_test_case_project_id
Create Date: 2026-06-07 00:00:00.000000

Adds ``project_id`` + ``project_seq`` to the definition catalogs and swaps the
global unique-name index for a per-project ``(project_id, name)`` unique index, so
each project owns its own test types / priorities / step templates. Rows are
populated lazily per project by the list endpoints (seeded from defaults), so no
data backfill is needed here.
"""
import sqlalchemy as sa
from alembic import op

from app.services.migration_helpers import (
    add_column_if_missing,
    column_exists,
    drop_column_if_exists,
    index_exists,
)

revision = "add_project_scoped_definitions"
down_revision = "add_test_case_project_id"
branch_labels = None
depends_on = None

_TABLES = ["test_type_definitions", "priority_definitions", "shared_step_templates"]
# Type/priority names were globally unique; make them unique per project instead.
_UNIQUE_NAME_TABLES = ["test_type_definitions", "priority_definitions"]


def upgrade() -> None:
    conn = op.get_bind()
    for table in _TABLES:
        add_column_if_missing(op, table, sa.Column("project_id", sa.Integer(), nullable=True))
        add_column_if_missing(op, table, sa.Column("project_seq", sa.Integer(), nullable=True))
        if column_exists(conn, table, "project_id") and not index_exists(conn, table, f"ix_{table}_project_id"):
            op.create_index(f"ix_{table}_project_id", table, ["project_id"])

    for table in _UNIQUE_NAME_TABLES:
        # Replace the global UNIQUE(name) index with a non-unique one...
        if index_exists(conn, table, f"ix_{table}_name"):
            op.drop_index(f"ix_{table}_name", table_name=table)
        if not index_exists(conn, table, f"ix_{table}_name"):
            op.create_index(f"ix_{table}_name", table, ["name"])
        # ...and enforce uniqueness per project.
        idx = f"uq_{table}_project_name"
        if not index_exists(conn, table, idx):
            op.create_index(idx, table, ["project_id", "name"], unique=True)


def downgrade() -> None:
    conn = op.get_bind()
    for table in _UNIQUE_NAME_TABLES:
        idx = f"uq_{table}_project_name"
        if index_exists(conn, table, idx):
            op.drop_index(idx, table_name=table)
        if index_exists(conn, table, f"ix_{table}_name"):
            op.drop_index(f"ix_{table}_name", table_name=table)
        op.create_index(f"ix_{table}_name", table, ["name"], unique=True)
    for table in _TABLES:
        if index_exists(conn, table, f"ix_{table}_project_id"):
            op.drop_index(f"ix_{table}_project_id", table_name=table)
        drop_column_if_exists(op, table, "project_seq")
        drop_column_if_exists(op, table, "project_id")
