"""Add requirement_chat_conversations and requirement_chat_messages tables

Revision ID: add_requirement_chat
Revises: add_requirement_versions_and_comments
Create Date: 2026-06-02 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import table_exists


revision = "add_requirement_chat"
down_revision = "add_requirement_versions_and_comments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    # Saved, project-scoped AI chat threads over a project's requirements.
    if not table_exists(connection, "requirement_chat_conversations"):
        op.create_table(
            "requirement_chat_conversations",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False, server_default="New conversation"),
            sa.Column("created_by", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_requirement_chat_conversations_project_id",
            "requirement_chat_conversations",
            ["project_id"],
        )

    # Individual turns (user / assistant) within a conversation.
    if not table_exists(connection, "requirement_chat_messages"):
        op.create_table(
            "requirement_chat_messages",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("conversation_id", sa.Integer(), nullable=False),
            sa.Column("role", sa.String(length=16), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("sources", sa.JSON(), nullable=True),
            sa.Column("prompt_tokens", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["conversation_id"], ["requirement_chat_conversations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_requirement_chat_messages_conversation_id",
            "requirement_chat_messages",
            ["conversation_id"],
        )


def downgrade() -> None:
    connection = op.get_bind()

    if table_exists(connection, "requirement_chat_messages"):
        op.drop_index("ix_requirement_chat_messages_conversation_id", table_name="requirement_chat_messages")
        op.drop_table("requirement_chat_messages")

    if table_exists(connection, "requirement_chat_conversations"):
        op.drop_index("ix_requirement_chat_conversations_project_id", table_name="requirement_chat_conversations")
        op.drop_table("requirement_chat_conversations")
