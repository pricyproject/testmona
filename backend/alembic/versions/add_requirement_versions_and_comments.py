"""Add requirement_versions and requirement_comments tables

Revision ID: add_requirement_versions_and_comments
Revises: scope_global_parameter_name
Create Date: 2026-05-29 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import table_exists


revision = "add_requirement_versions_and_comments"
down_revision = "scope_global_parameter_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    # Immutable per-version snapshots of a requirement's editable content.
    if not table_exists(connection, "requirement_versions"):
        op.create_table(
            "requirement_versions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("requirement_id", sa.Integer(), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(length=20), nullable=False, server_default="updated"),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("acceptance_criteria", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=True),
            sa.Column("priority", sa.String(length=50), nullable=True),
            sa.Column("tags", sa.String(length=500), nullable=True),
            sa.Column("estimated_effort", sa.Float(), nullable=True),
            sa.Column("change_note", sa.String(length=500), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["requirement_id"], ["requirements.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("requirement_id", "version_number", name="uq_requirement_version_number"),
        )
        op.create_index("ix_requirement_versions_requirement_id", "requirement_versions", ["requirement_id"])

    # Threaded comments / review notes on requirements.
    if not table_exists(connection, "requirement_comments"):
        op.create_table(
            "requirement_comments",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("requirement_id", sa.Integer(), nullable=False),
            sa.Column("parent_id", sa.Integer(), nullable=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("is_resolved", sa.Boolean(), server_default=sa.false(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.ForeignKeyConstraint(["requirement_id"], ["requirements.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["parent_id"], ["requirement_comments.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_requirement_comments_requirement_id", "requirement_comments", ["requirement_id"])
        op.create_index("ix_requirement_comments_parent_id", "requirement_comments", ["parent_id"])


def downgrade() -> None:
    connection = op.get_bind()

    if table_exists(connection, "requirement_comments"):
        op.drop_index("ix_requirement_comments_parent_id", table_name="requirement_comments")
        op.drop_index("ix_requirement_comments_requirement_id", table_name="requirement_comments")
        op.drop_table("requirement_comments")

    if table_exists(connection, "requirement_versions"):
        op.drop_index("ix_requirement_versions_requirement_id", table_name="requirement_versions")
        op.drop_table("requirement_versions")
