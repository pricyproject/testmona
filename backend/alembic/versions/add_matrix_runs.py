"""Add environment matrix runs

A matrix run groups N test runs that execute the same test-case selection
across N execution environments, so results can be pivoted case x environment.

Revision ID: add_matrix_runs
Revises: add_test_asset_health
Create Date: 2026-06-12 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import (
    add_column_if_missing,
    create_index_if_missing,
    drop_column_if_exists,
    drop_index_if_exists,
    table_exists,
)


revision = "add_matrix_runs"
down_revision = "add_test_asset_health"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    if not table_exists(connection, "matrix_runs"):
        op.create_table(
            "matrix_runs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("project_seq", sa.Integer(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_matrix_runs_name", "matrix_runs", ["name"])
        op.create_index("ix_matrix_runs_project_id", "matrix_runs", ["project_id"])
        op.create_index("ix_matrix_runs_project_seq", "matrix_runs", ["project_seq"])
        op.create_index(
            "uq_matrix_runs_project_seq",
            "matrix_runs",
            ["project_id", "project_seq"],
            unique=True,
        )

    add_column_if_missing(
        op,
        "test_runs",
        sa.Column("matrix_run_id", sa.Integer(), nullable=True),
    )
    create_index_if_missing(op, "ix_test_runs_matrix_run_id", "test_runs", ["matrix_run_id"])


def downgrade() -> None:
    connection = op.get_bind()

    drop_index_if_exists(op, "ix_test_runs_matrix_run_id", "test_runs")
    drop_column_if_exists(op, "test_runs", "matrix_run_id")

    if table_exists(connection, "matrix_runs"):
        op.drop_index("uq_matrix_runs_project_seq", table_name="matrix_runs")
        op.drop_index("ix_matrix_runs_project_seq", table_name="matrix_runs")
        op.drop_index("ix_matrix_runs_project_id", table_name="matrix_runs")
        op.drop_index("ix_matrix_runs_name", table_name="matrix_runs")
        op.drop_table("matrix_runs")
