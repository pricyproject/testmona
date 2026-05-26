"""Add saved_filters table for list-page filter persistence

Revision ID: add_saved_filters
Revises: add_api_tokens_and_webhooks
Create Date: 2026-05-26 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import table_exists


revision = "add_saved_filters"
down_revision = "add_api_tokens_and_webhooks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    if not table_exists(connection, "saved_filters"):
        op.create_table(
            "saved_filters",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("scope", sa.String(length=32), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("definition", sa.JSON(), nullable=False),
            sa.Column("is_default", sa.Boolean(), server_default=sa.false(), nullable=False),
            sa.Column("is_shared", sa.Boolean(), server_default=sa.false(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "project_id", "scope", "name", name="uq_saved_filter_owner_scope_name"),
        )
        op.create_index("ix_saved_filters_user_id", "saved_filters", ["user_id"])
        op.create_index("ix_saved_filters_project_id", "saved_filters", ["project_id"])
        op.create_index("ix_saved_filters_scope", "saved_filters", ["scope"])


def downgrade() -> None:
    connection = op.get_bind()
    if table_exists(connection, "saved_filters"):
        op.drop_table("saved_filters")
