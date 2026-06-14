"""Add notification actor (who triggered it) for the Work Inbox

Revision ID: add_notification_actor
Revises: add_notification_category
Create Date: 2026-06-14 14:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import (
    add_column_if_missing,
    create_index_if_missing,
    drop_column_if_exists,
    drop_index_if_exists,
)


revision = "add_notification_actor"
down_revision = "add_notification_category"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ``actor_id`` is a loose reference (no FK / cascade): a notification should
    # outlive the user who triggered it, and we only ever read the actor's name.
    add_column_if_missing(op, "notifications", sa.Column("actor_id", sa.Integer(), nullable=True))
    create_index_if_missing(op, "ix_notifications_actor_id", "notifications", ["actor_id"])


def downgrade() -> None:
    drop_index_if_exists(op, "ix_notifications_actor_id", "notifications")
    drop_column_if_exists(op, "notifications", "actor_id")
