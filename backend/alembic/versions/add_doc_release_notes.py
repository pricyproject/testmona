"""Add living release notes for Doc Hub

Revision ID: add_doc_release_notes
Revises: add_doc_feedback
Create Date: 2026-06-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import table_exists


revision = "add_doc_release_notes"
down_revision = "add_doc_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if not table_exists(connection, "doc_release_notes"):
        op.create_table(
            "doc_release_notes",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("uuid", sa.String(length=36), nullable=True),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("version", sa.String(length=50), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("content_markdown", sa.Text(), nullable=True),
            sa.Column("summary", sa.Text(), nullable=True),
            sa.Column("range_start", sa.DateTime(timezone=True), nullable=True),
            sa.Column("range_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("source_data", sa.JSON(), nullable=True),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=False),
            sa.Column("updated_by", sa.Integer(), nullable=True),
            sa.Column("published_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["published_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_doc_release_notes_uuid", "doc_release_notes", ["uuid"], unique=True)
        op.create_index("ix_doc_release_notes_project_id", "doc_release_notes", ["project_id"])


def downgrade() -> None:
    connection = op.get_bind()
    if table_exists(connection, "doc_release_notes"):
        op.drop_index("ix_doc_release_notes_project_id", table_name="doc_release_notes")
        op.drop_index("ix_doc_release_notes_uuid", table_name="doc_release_notes")
        op.drop_table("doc_release_notes")
