"""Add notification engine fields (category, archived) for the Work Inbox

Revision ID: add_notification_category
Revises: add_entity_watches
Create Date: 2026-06-14 13:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import (
    add_column_if_missing,
    column_exists,
    create_index_if_missing,
    drop_column_if_exists,
    drop_index_if_exists,
)


revision = "add_notification_category"
down_revision = "add_entity_watches"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    add_column_if_missing(op, "notifications", sa.Column("category", sa.String(length=50), nullable=True))
    # Add ``archived`` with a server default so the column is backfilled to False
    # for every existing row on engines that require a default for NOT NULL adds.
    if not column_exists(connection, "notifications", "archived"):
        op.add_column(
            "notifications",
            sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    create_index_if_missing(op, "ix_notifications_category", "notifications", ["category"])


def downgrade() -> None:
    drop_index_if_exists(op, "ix_notifications_category", "notifications")
    drop_column_if_exists(op, "notifications", "archived")
    drop_column_if_exists(op, "notifications", "category")
