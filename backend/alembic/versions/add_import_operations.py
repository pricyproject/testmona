"""add import operations

Revision ID: add_import_operations
Revises: add_milestone_id_to_test_runs
Create Date: 2026-05-16 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import can_inspect_database, index_exists, table_exists


revision = "add_import_operations"
down_revision = "add_milestone_id_to_test_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if not can_inspect_database(connection):
        return

    if not table_exists(connection, "import_operations"):
        op.create_table(
            "import_operations",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("idempotency_key", sa.String(length=255), nullable=False),
            sa.Column("operation", sa.String(length=100), nullable=False),
            sa.Column("lock_key", sa.String(length=255), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=True),
            sa.Column("test_suite_id", sa.Integer(), nullable=True),
            sa.Column("filename", sa.String(length=255), nullable=True),
            sa.Column("response_data", sa.JSON(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
            sa.ForeignKeyConstraint(["test_suite_id"], ["test_suites.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    for index_name, columns, unique in (
        (op.f("ix_import_operations_id"), ["id"], False),
        (op.f("ix_import_operations_idempotency_key"), ["idempotency_key"], True),
        (op.f("ix_import_operations_lock_key"), ["lock_key"], False),
    ):
        if not index_exists(connection, "import_operations", index_name):
            op.create_index(index_name, "import_operations", columns, unique=unique)


def downgrade() -> None:
    connection = op.get_bind()
    if not can_inspect_database(connection):
        return

    for index_name in (
        op.f("ix_import_operations_lock_key"),
        op.f("ix_import_operations_idempotency_key"),
        op.f("ix_import_operations_id"),
    ):
        if index_exists(connection, "import_operations", index_name):
            op.drop_index(index_name, table_name="import_operations")

    if table_exists(connection, "import_operations"):
        op.drop_table("import_operations")
