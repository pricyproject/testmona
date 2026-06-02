"""Add archived flag to requirement_chat_conversations

Revision ID: add_requirement_chat_archived
Revises: add_requirement_chat
Create Date: 2026-06-02 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import column_exists


revision = "add_requirement_chat_archived"
down_revision = "add_requirement_chat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if not column_exists(connection, "requirement_chat_conversations", "archived"):
        op.add_column(
            "requirement_chat_conversations",
            sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    connection = op.get_bind()
    if column_exists(connection, "requirement_chat_conversations", "archived"):
        op.drop_column("requirement_chat_conversations", "archived")
