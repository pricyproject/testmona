"""repair migration-managed schema drift

Revision ID: repair_schema_drift
Revises: drop_custom_field_entity_type
Create Date: 2026-05-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.database import Base
from app import models, models_versioning
from app.services.migration_helpers import (
    add_column_if_missing,
    can_inspect_database,
    column_exists,
    foreign_key_exists,
    index_exists,
    table_exists,
)


revision = "repair_schema_drift"
down_revision = "drop_custom_field_entity_type"
branch_labels = None
depends_on = None


def _ensure_test_run_milestone_fk() -> None:
    connection = op.get_bind()
    if not (
        table_exists(connection, "test_runs")
        and table_exists(connection, "milestones")
        and column_exists(connection, "test_runs", "milestone_id")
        and not foreign_key_exists(connection, "test_runs", "milestone_id", "milestones", "id")
    ):
        return

    op.execute(
        """
        UPDATE test_runs
        SET milestone_id = NULL
        WHERE milestone_id IS NOT NULL
        AND milestone_id NOT IN (SELECT id FROM milestones)
        """
    )

    if connection.dialect.name == "sqlite":
        with op.batch_alter_table("test_runs") as batch_op:
            batch_op.create_foreign_key(
                "fk_test_runs_milestone_id_milestones",
                "milestones",
                ["milestone_id"],
                ["id"],
            )
    else:
        op.create_foreign_key(
            "fk_test_runs_milestone_id_milestones",
            "test_runs",
            "milestones",
            ["milestone_id"],
            ["id"],
        )


def _ensure_import_operation_indexes() -> None:
    connection = op.get_bind()
    if not table_exists(connection, "import_operations"):
        return

    for index_name, columns, unique in (
        (op.f("ix_import_operations_id"), ["id"], False),
        (op.f("ix_import_operations_idempotency_key"), ["idempotency_key"], True),
        (op.f("ix_import_operations_lock_key"), ["lock_key"], False),
    ):
        if not index_exists(connection, "import_operations", index_name):
            op.create_index(index_name, "import_operations", columns, unique=unique)


def upgrade() -> None:
    connection = op.get_bind()
    if not can_inspect_database(connection):
        return

    Base.metadata.create_all(bind=connection)

    add_column_if_missing(op, "test_case_steps", sa.Column("step_type", sa.String(20), default="manual"))
    add_column_if_missing(op, "test_case_steps", sa.Column("data", sa.JSON, nullable=True))
    add_column_if_missing(op, "test_case_steps", sa.Column("order_index", sa.Integer, default=0))

    add_column_if_missing(op, "test_results", sa.Column("execution_state", sa.String(length=20), nullable=True, default="idle"))
    add_column_if_missing(op, "test_results", sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True))
    add_column_if_missing(op, "test_results", sa.Column("total_paused_time", sa.Float(), nullable=True, default=0.0))
    add_column_if_missing(op, "test_results", sa.Column("manual_time_adjustment", sa.Float(), nullable=True, default=0.0))

    if column_exists(connection, "test_results", "execution_state"):
        op.execute("UPDATE test_results SET execution_state = 'idle' WHERE execution_state IS NULL")
    if column_exists(connection, "test_results", "total_paused_time"):
        op.execute("UPDATE test_results SET total_paused_time = 0.0 WHERE total_paused_time IS NULL")
    if column_exists(connection, "test_results", "manual_time_adjustment"):
        op.execute("UPDATE test_results SET manual_time_adjustment = 0.0 WHERE manual_time_adjustment IS NULL")

    add_column_if_missing(op, "test_runs", sa.Column("milestone_id", sa.Integer(), nullable=True))
    _ensure_test_run_milestone_fk()
    _ensure_import_operation_indexes()


def downgrade() -> None:
    pass
