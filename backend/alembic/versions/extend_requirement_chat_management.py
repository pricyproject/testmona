"""Extend requirement chat management fields

Revision ID: extend_requirement_chat_management
Revises: add_requirement_chat_sharing
Create Date: 2026-06-02 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import column_exists


revision = "extend_requirement_chat_management"
down_revision = "add_requirement_chat_sharing"
branch_labels = None
depends_on = None

TABLE = "requirement_chat_conversations"


def upgrade() -> None:
    connection = op.get_bind()
    if not column_exists(connection, TABLE, "pinned"):
        op.add_column(TABLE, sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()))
    if not column_exists(connection, TABLE, "share_expires_at"):
        op.add_column(TABLE, sa.Column("share_expires_at", sa.DateTime(timezone=True), nullable=True))
    if not column_exists(connection, TABLE, "share_allowed_user_ids"):
        op.add_column(TABLE, sa.Column("share_allowed_user_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    connection = op.get_bind()
    if column_exists(connection, TABLE, "share_allowed_user_ids"):
        op.drop_column(TABLE, "share_allowed_user_ids")
    if column_exists(connection, TABLE, "share_expires_at"):
        op.drop_column(TABLE, "share_expires_at")
    if column_exists(connection, TABLE, "pinned"):
        op.drop_column(TABLE, "pinned")
