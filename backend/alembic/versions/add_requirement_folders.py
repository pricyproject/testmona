"""Add requirement_folders table and requirements.folder_id

Revision ID: add_requirement_folders
Revises: extend_requirement_chat_management
Create Date: 2026-06-02 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import (
    add_column_if_missing,
    column_exists,
    drop_column_if_exists,
    table_exists,
)


revision = "add_requirement_folders"
down_revision = "extend_requirement_chat_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    if not table_exists(connection, "requirement_folders"):
        op.create_table(
            "requirement_folders",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("parent_folder_id", sa.Integer(), nullable=True),
            sa.Column("order_index", sa.Integer(), server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
            sa.ForeignKeyConstraint(["parent_folder_id"], ["requirement_folders.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_requirement_folders_project_id", "requirement_folders", ["project_id"])

    # Add the FK column that files a requirement under a folder.
    add_column_if_missing(
        op, "requirements", sa.Column("folder_id", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    connection = op.get_bind()
    if column_exists(connection, "requirements", "folder_id"):
        drop_column_if_exists(op, "requirements", "folder_id")
    if table_exists(connection, "requirement_folders"):
        op.drop_table("requirement_folders")
