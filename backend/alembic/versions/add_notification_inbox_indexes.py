"""Add notification indexes for Work Inbox queries

Revision ID: add_notification_inbox_indexes
Revises: add_inbox_triage_fields
Create Date: 2026-06-16 00:00:00.000000

"""
from alembic import op

from app.services.migration_helpers import create_index_if_missing, drop_index_if_exists


revision = "add_notification_inbox_indexes"
down_revision = "add_inbox_triage_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_index_if_missing(
        op,
        "ix_notifications_user_category_archived_created",
        "notifications",
        ["user_id", "category", "archived", "created_at"],
    )
    create_index_if_missing(
        op,
        "ix_notifications_user_snoozed",
        "notifications",
        ["user_id", "snoozed_until"],
    )
    create_index_if_missing(
        op,
        "ix_notifications_user_done",
        "notifications",
        ["user_id", "done_at"],
    )


def downgrade() -> None:
    drop_index_if_exists(op, "ix_notifications_user_done", "notifications")
    drop_index_if_exists(op, "ix_notifications_user_snoozed", "notifications")
    drop_index_if_exists(op, "ix_notifications_user_category_archived_created", "notifications")
