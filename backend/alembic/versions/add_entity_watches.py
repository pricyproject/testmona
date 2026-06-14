"""Add entity watches (watch/notify for docs and requirements)

Revision ID: add_entity_watches
Revises: 20260612120000_repair_matrix_run_schema
Create Date: 2026-06-14 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import table_exists


revision = "add_entity_watches"
down_revision = "20260612120000_repair_matrix_run_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if not table_exists(connection, "entity_watches"):
        op.create_table(
            "entity_watches",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("entity_type", sa.String(length=20), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "entity_type", "entity_id", name="uq_entity_watch"),
        )
        op.create_index("ix_entity_watches_user_id", "entity_watches", ["user_id"])
        op.create_index("ix_entity_watches_entity", "entity_watches", ["entity_type", "entity_id"])


def downgrade() -> None:
    connection = op.get_bind()
    if table_exists(connection, "entity_watches"):
        op.drop_index("ix_entity_watches_entity", table_name="entity_watches")
        op.drop_index("ix_entity_watches_user_id", table_name="entity_watches")
        op.drop_table("entity_watches")
