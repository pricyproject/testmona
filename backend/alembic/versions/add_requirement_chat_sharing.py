"""Add public_id + share_scope to requirement_chat_conversations

Revision ID: add_requirement_chat_sharing
Revises: add_requirement_chat_archived
Create Date: 2026-06-02 14:00:00.000000

"""
import uuid

import sqlalchemy as sa
from alembic import op

from app.services.migration_helpers import column_exists, index_exists


revision = "add_requirement_chat_sharing"
down_revision = "add_requirement_chat_archived"
branch_labels = None
depends_on = None

TABLE = "requirement_chat_conversations"


def upgrade() -> None:
    connection = op.get_bind()

    if not column_exists(connection, TABLE, "share_scope"):
        op.add_column(TABLE, sa.Column("share_scope", sa.String(length=16), nullable=False, server_default="private"))

    if not column_exists(connection, TABLE, "public_id"):
        # Add nullable first, backfill unique tokens, then enforce NOT NULL + unique.
        op.add_column(TABLE, sa.Column("public_id", sa.String(length=32), nullable=True))
    if column_exists(connection, TABLE, "public_id"):
        rows = connection.execute(sa.text(f"SELECT id FROM {TABLE} WHERE public_id IS NULL")).fetchall()
        for (row_id,) in rows:
            connection.execute(
                sa.text(f"UPDATE {TABLE} SET public_id = :pid WHERE id = :id"),
                {"pid": uuid.uuid4().hex, "id": row_id},
            )

        if connection.dialect.name == "sqlite":
            with op.batch_alter_table(TABLE) as batch_op:
                batch_op.alter_column("public_id", existing_type=sa.String(length=32), nullable=False)
        else:
            op.alter_column(TABLE, "public_id", existing_type=sa.String(length=32), nullable=False)

        if not index_exists(connection, TABLE, "ix_requirement_chat_conversations_public_id"):
            op.create_index("ix_requirement_chat_conversations_public_id", TABLE, ["public_id"], unique=True)


def downgrade() -> None:
    connection = op.get_bind()
    if column_exists(connection, TABLE, "public_id"):
        op.drop_index("ix_requirement_chat_conversations_public_id", table_name=TABLE)
        op.drop_column(TABLE, "public_id")
    if column_exists(connection, TABLE, "share_scope"):
        op.drop_column(TABLE, "share_scope")
