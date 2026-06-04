"""Add reader feedback for Doc Hub

Revision ID: add_doc_feedback
Revises: add_project_features
Create Date: 2026-06-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import table_exists


revision = "add_doc_feedback"
down_revision = "add_project_features"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if not table_exists(connection, "doc_feedback"):
        op.create_table(
            "doc_feedback",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("doc_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("feedback_type", sa.String(length=30), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("section_text", sa.Text(), nullable=True),
            sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["doc_id"], ["docs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("doc_id", "user_id", name="uq_doc_feedback_user"),
        )
        op.create_index("ix_doc_feedback_doc_id", "doc_feedback", ["doc_id"])
        op.create_index("ix_doc_feedback_user_id", "doc_feedback", ["user_id"])


def downgrade() -> None:
    connection = op.get_bind()
    if table_exists(connection, "doc_feedback"):
        op.drop_index("ix_doc_feedback_user_id", table_name="doc_feedback")
        op.drop_index("ix_doc_feedback_doc_id", table_name="doc_feedback")
        op.drop_table("doc_feedback")
