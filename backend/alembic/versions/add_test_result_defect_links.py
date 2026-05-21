"""Add test result defect links and failure-context fields

Revision ID: add_test_result_defect_links
Revises: add_requirement_test_plan_links
Create Date: 2026-05-21 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import column_exists, table_exists


revision = "add_test_result_defect_links"
down_revision = "add_requirement_test_plan_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    if not table_exists(connection, "test_result_defect_links"):
        op.create_table(
            "test_result_defect_links",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("test_result_id", sa.Integer(), nullable=False),
            sa.Column("defect_id", sa.Integer(), nullable=False),
            sa.Column("link_type", sa.String(length=20), server_default="found", nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(["test_result_id"], ["test_results.id"]),
            sa.ForeignKeyConstraint(["defect_id"], ["defects.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "test_result_id", "defect_id",
                name="uq_test_result_defect_links_result_defect",
            ),
        )
        op.create_index(
            "ix_test_result_defect_links_test_result_id",
            "test_result_defect_links", ["test_result_id"],
        )
        op.create_index(
            "ix_test_result_defect_links_defect_id",
            "test_result_defect_links", ["defect_id"],
        )

    if not column_exists(connection, "test_results", "defect_link"):
        op.add_column("test_results", sa.Column("defect_link", sa.String(length=500), nullable=True))
    if not column_exists(connection, "test_results", "custom_link"):
        op.add_column("test_results", sa.Column("custom_link", sa.String(length=500), nullable=True))
    if not column_exists(connection, "test_results", "retest_needed"):
        op.add_column(
            "test_results",
            sa.Column("retest_needed", sa.Boolean(), server_default=sa.text("0"), nullable=True),
        )

    if not column_exists(connection, "test_execution_settings", "require_defect_on_failure"):
        op.add_column(
            "test_execution_settings",
            sa.Column("require_defect_on_failure", sa.Boolean(), server_default=sa.text("0"), nullable=True),
        )


def downgrade() -> None:
    connection = op.get_bind()

    if column_exists(connection, "test_execution_settings", "require_defect_on_failure"):
        op.drop_column("test_execution_settings", "require_defect_on_failure")

    for column_name in ("retest_needed", "custom_link", "defect_link"):
        if column_exists(connection, "test_results", column_name):
            op.drop_column("test_results", column_name)

    if table_exists(connection, "test_result_defect_links"):
        op.drop_table("test_result_defect_links")
