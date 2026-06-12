"""repair matrix run schema drift

Revision ID: 20260612120000_repair_matrix_run_schema
Revises: add_matrix_runs
Create Date: 2026-06-12 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import (
    add_column_if_missing,
    create_index_if_missing,
    foreign_key_exists,
    table_exists,
)


revision = "20260612120000_repair_matrix_run_schema"
down_revision = "add_matrix_runs"
branch_labels = None
depends_on = None


def _ensure_matrix_runs_table() -> None:
    connection = op.get_bind()
    if table_exists(connection, "matrix_runs"):
        return

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


def _ensure_matrix_run_foreign_key() -> None:
    connection = op.get_bind()
    if not (
        table_exists(connection, "test_runs")
        and table_exists(connection, "matrix_runs")
        and not foreign_key_exists(connection, "test_runs", "matrix_run_id", "matrix_runs", "id")
    ):
        return

    op.execute(
        """
        UPDATE test_runs
        SET matrix_run_id = NULL
        WHERE matrix_run_id IS NOT NULL
        AND matrix_run_id NOT IN (SELECT id FROM matrix_runs)
        """
    )

    if connection.dialect.name == "sqlite":
        with op.batch_alter_table("test_runs") as batch_op:
            batch_op.create_foreign_key(
                "fk_test_runs_matrix_run_id_matrix_runs",
                "matrix_runs",
                ["matrix_run_id"],
                ["id"],
                ondelete="SET NULL",
            )
    else:
        op.create_foreign_key(
            "fk_test_runs_matrix_run_id_matrix_runs",
            "test_runs",
            "matrix_runs",
            ["matrix_run_id"],
            ["id"],
            ondelete="SET NULL",
        )


def upgrade() -> None:
    _ensure_matrix_runs_table()
    create_index_if_missing(op, "ix_matrix_runs_name", "matrix_runs", ["name"])
    create_index_if_missing(op, "ix_matrix_runs_project_id", "matrix_runs", ["project_id"])
    create_index_if_missing(op, "ix_matrix_runs_project_seq", "matrix_runs", ["project_seq"])
    create_index_if_missing(
        op,
        "uq_matrix_runs_project_seq",
        "matrix_runs",
        ["project_id", "project_seq"],
        unique=True,
    )

    add_column_if_missing(op, "test_runs", sa.Column("matrix_run_id", sa.Integer(), nullable=True))
    create_index_if_missing(op, "ix_test_runs_matrix_run_id", "test_runs", ["matrix_run_id"])
    _ensure_matrix_run_foreign_key()


def downgrade() -> None:
    """No-op: this revision only repairs objects owned by add_matrix_runs."""
    return None
