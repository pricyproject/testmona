"""Add test_datasets table and case-level parameterization columns

Revision ID: add_test_datasets
Revises: unify_custom_fields_engine
Create Date: 2026-05-28 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import column_exists, table_exists


revision = "add_test_datasets"
down_revision = "unify_custom_fields_engine"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    # Reusable, project-scoped named data sets a case can iterate over.
    if not table_exists(connection, "test_datasets"):
        op.create_table(
            "test_datasets",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("parameters", sa.JSON(), nullable=False),
            sa.Column("rows", sa.JSON(), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("project_id", "name", name="uq_test_dataset_project_name"),
        )
        op.create_index("ix_test_datasets_project_id", "test_datasets", ["project_id"])

    # The case → dataset attachment. Plain nullable FK column (no batch rebuild
    # needed just to add a column on SQLite).
    if not column_exists(connection, "test_cases", "dataset_id"):
        op.add_column("test_cases", sa.Column("dataset_id", sa.Integer(), nullable=True))

    # Per-iteration outcomes for data-driven results.
    if not column_exists(connection, "test_results", "iteration_results"):
        op.add_column("test_results", sa.Column("iteration_results", sa.JSON(), nullable=True))


def downgrade() -> None:
    connection = op.get_bind()

    if column_exists(connection, "test_results", "iteration_results"):
        op.drop_column("test_results", "iteration_results")

    if column_exists(connection, "test_cases", "dataset_id"):
        op.drop_column("test_cases", "dataset_id")

    if table_exists(connection, "test_datasets"):
        op.drop_index("ix_test_datasets_project_id", table_name="test_datasets")
        op.drop_table("test_datasets")
