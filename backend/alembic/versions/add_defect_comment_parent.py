"""Add parent_id to defect_comments for threaded replies

Revision ID: add_defect_comment_parent
Revises: add_notification_actor
Create Date: 2026-06-14 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import (
    add_column_if_missing,
    create_index_if_missing,
    drop_column_if_exists,
    drop_index_if_exists,
)


revision = "add_defect_comment_parent"
down_revision = "add_notification_actor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Self-referential, nullable: NULL is a top-level comment, a non-NULL value
    # points at the comment being replied to. Adding the inline ForeignKey on a
    # nullable column is permitted on SQLite (NULL default) as well as the server
    # backends, so the same DDL works across every supported database.
    add_column_if_missing(
        op,
        "defect_comments",
        sa.Column(
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("defect_comments.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    create_index_if_missing(op, "ix_defect_comments_parent_id", "defect_comments", ["parent_id"])


def downgrade() -> None:
    drop_index_if_exists(op, "ix_defect_comments_parent_id", "defect_comments")
    drop_column_if_exists(op, "defect_comments", "parent_id")
