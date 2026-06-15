"""Add owner_id to milestones

Revision ID: add_milestone_owner_id
Revises: add_test_plan_assigned_to
Create Date: 2026-06-15 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import (
    add_column_if_missing,
    create_index_if_missing,
    drop_column_if_exists,
    drop_index_if_exists,
)


revision = "add_milestone_owner_id"
down_revision = "add_test_plan_assigned_to"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ``owner_id`` is a loose reference (no FK / cascade), matching
    # ``test_plans.assigned_to`` and ``notifications.actor_id``: an inline ForeignKey
    # in ALTER ... ADD COLUMN fails on MySQL/MariaDB, and the app only ever reads the
    # id, so the column is added plain and just indexed for lookups.
    add_column_if_missing(
        op,
        "milestones",
        sa.Column("owner_id", sa.Integer(), nullable=True),
    )
    create_index_if_missing(op, "ix_milestones_owner_id", "milestones", ["owner_id"])


def downgrade() -> None:
    drop_index_if_exists(op, "ix_milestones_owner_id", "milestones")
    drop_column_if_exists(op, "milestones", "owner_id")
