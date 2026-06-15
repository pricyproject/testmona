"""Add notification_preferences (per-user, per-category mute switches)

Revision ID: add_notification_preferences
Revises: add_milestone_owner_id
Create Date: 2026-06-15 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import table_exists


revision = "add_notification_preferences"
down_revision = "add_milestone_owner_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if not table_exists(connection, "notification_preferences"):
        op.create_table(
            "notification_preferences",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            # Engine category key (e.g. 'mention', 'status'); loose string, not an
            # FK, so the category registry can evolve without a migration.
            sa.Column("category", sa.String(length=50), nullable=False),
            sa.Column("in_app", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("email", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "category", name="uq_notification_preference"),
        )
        op.create_index(
            "ix_notification_preferences_user_id",
            "notification_preferences",
            ["user_id"],
        )


def downgrade() -> None:
    connection = op.get_bind()
    if table_exists(connection, "notification_preferences"):
        op.drop_index(
            "ix_notification_preferences_user_id",
            table_name="notification_preferences",
        )
        op.drop_table("notification_preferences")
