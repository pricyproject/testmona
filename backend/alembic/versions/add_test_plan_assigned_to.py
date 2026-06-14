"""Add assigned_to to test_plans

Revision ID: add_test_plan_assigned_to
Revises: add_defect_comment_parent
Create Date: 2026-06-14 17:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import (
    add_column_if_missing,
    create_index_if_missing,
    drop_column_if_exists,
    drop_index_if_exists,
)


revision = "add_test_plan_assigned_to"
down_revision = "add_defect_comment_parent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable assignee mirroring requirements/defects/test-runs so a plan owner
    # can be notified the same way. Loose nullable FK works across every backend.
    add_column_if_missing(
        op,
        "test_plans",
        sa.Column(
            "assigned_to",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )
    create_index_if_missing(op, "ix_test_plans_assigned_to", "test_plans", ["assigned_to"])


def downgrade() -> None:
    drop_index_if_exists(op, "ix_test_plans_assigned_to", "test_plans")
    drop_column_if_exists(op, "test_plans", "assigned_to")
