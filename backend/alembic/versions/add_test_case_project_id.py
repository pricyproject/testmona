"""Add a real project_id column to test_cases

Revision ID: add_test_case_project_id
Revises: add_project_seq_numbering
Create Date: 2026-06-07 00:00:00.000000

``TestCase.project_id`` used to be a derived Python property (via the suite). This
denormalises it onto the row so test cases can be filtered/numbered per project
without a join, and promotes the per-project ``project_seq`` index to a real unique
``(project_id, project_seq)`` index.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

from app.services.migration_helpers import (
    add_column_if_missing,
    column_exists,
    drop_column_if_exists,
    index_exists,
)

revision = "add_test_case_project_id"
down_revision = "add_project_seq_numbering"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    add_column_if_missing(op, "test_cases", sa.Column("project_id", sa.Integer(), nullable=True))

    if column_exists(conn, "test_cases", "project_id"):
        # Correlated subquery on a different table — valid on both SQLite and MySQL.
        conn.execute(
            text(
                "UPDATE test_cases SET project_id = "
                "(SELECT ts.project_id FROM test_suites ts WHERE ts.id = test_cases.test_suite_id) "
                "WHERE project_id IS NULL"
            )
        )

    # Swap the plain project_seq index for a per-project unique one.
    if index_exists(conn, "test_cases", "ix_test_cases_project_seq"):
        op.drop_index("ix_test_cases_project_seq", table_name="test_cases")
    if column_exists(conn, "test_cases", "project_id") and not index_exists(
        conn, "test_cases", "ix_test_cases_project_id"
    ):
        op.create_index("ix_test_cases_project_id", "test_cases", ["project_id"])
    if not index_exists(conn, "test_cases", "uq_test_cases_project_seq"):
        op.create_index(
            "uq_test_cases_project_seq", "test_cases", ["project_id", "project_seq"], unique=True
        )


def downgrade() -> None:
    conn = op.get_bind()
    if index_exists(conn, "test_cases", "uq_test_cases_project_seq"):
        op.drop_index("uq_test_cases_project_seq", table_name="test_cases")
    if index_exists(conn, "test_cases", "ix_test_cases_project_id"):
        op.drop_index("ix_test_cases_project_id", table_name="test_cases")
    drop_column_if_exists(op, "test_cases", "project_id")
