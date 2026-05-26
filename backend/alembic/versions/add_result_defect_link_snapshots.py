"""Add immutable snapshots to test result defect links

Revision ID: add_result_defect_link_snapshots
Revises: requirement_id_per_project_unique
Create Date: 2026-05-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import add_column_if_missing, drop_column_if_exists


revision = "add_result_defect_link_snapshots"
down_revision = "requirement_id_per_project_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    add_column_if_missing(
        op,
        "test_result_defect_links",
        sa.Column("result_snapshot", sa.JSON(), nullable=True),
    )
    add_column_if_missing(
        op,
        "test_result_defect_links",
        sa.Column("failing_step_snapshot", sa.JSON(), nullable=True),
    )
    add_column_if_missing(
        op,
        "test_result_defect_links",
        sa.Column("snapshot_created_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    for column_name in ("snapshot_created_at", "failing_step_snapshot", "result_snapshot"):
        drop_column_if_exists(op, "test_result_defect_links", column_name)
