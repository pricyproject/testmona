"""Add test asset health debt items

Revision ID: add_test_asset_health
Revises: extend_user_two_factor_recovery
Create Date: 2026-06-10 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import table_exists


revision = "add_test_asset_health"
down_revision = "extend_user_two_factor_recovery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if table_exists(connection, "test_debt_items"):
        return

    op.create_table(
        "test_debt_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("test_case_id", sa.Integer(), nullable=False),
        sa.Column("debt_type", sa.String(length=40), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False, server_default="medium"),
        sa.Column("suggested_action", sa.String(length=40), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("auto_detected", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["test_case_id"], ["test_cases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("test_case_id", "debt_type", name="uq_test_debt_items_case_type"),
    )
    op.create_index("ix_test_debt_items_project_id", "test_debt_items", ["project_id"])
    op.create_index("ix_test_debt_items_test_case_id", "test_debt_items", ["test_case_id"])
    op.create_index("ix_test_debt_items_project_status", "test_debt_items", ["project_id", "resolved_at"])
    op.create_index("ix_test_debt_items_project_type", "test_debt_items", ["project_id", "debt_type"])


def downgrade() -> None:
    connection = op.get_bind()
    if not table_exists(connection, "test_debt_items"):
        return
    op.drop_index("ix_test_debt_items_project_type", table_name="test_debt_items")
    op.drop_index("ix_test_debt_items_project_status", table_name="test_debt_items")
    op.drop_index("ix_test_debt_items_test_case_id", table_name="test_debt_items")
    op.drop_index("ix_test_debt_items_project_id", table_name="test_debt_items")
    op.drop_table("test_debt_items")
