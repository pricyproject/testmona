"""Add API tokens, webhook subscriptions, and webhook deliveries

Revision ID: add_api_tokens_and_webhooks
Revises: add_result_defect_link_snapshots
Create Date: 2026-05-26 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import table_exists


revision = "add_api_tokens_and_webhooks"
down_revision = "add_result_defect_link_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    if not table_exists(connection, "api_tokens"):
        op.create_table(
            "api_tokens",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("prefix", sa.String(length=16), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True)),
            sa.Column("expires_at", sa.DateTime(timezone=True)),
            sa.Column("revoked_at", sa.DateTime(timezone=True)),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash", name="uq_api_tokens_token_hash"),
        )
        op.create_index("ix_api_tokens_user_id", "api_tokens", ["user_id"])
        op.create_index("ix_api_tokens_prefix", "api_tokens", ["prefix"])
        op.create_index("ix_api_tokens_token_hash", "api_tokens", ["token_hash"])

    if not table_exists(connection, "webhook_subscriptions"):
        op.create_table(
            "webhook_subscriptions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("created_by", sa.Integer()),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("url", sa.String(length=2048), nullable=False),
            sa.Column("secret", sa.String(length=128), nullable=False),
            sa.Column("events", sa.JSON(), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_webhook_subscriptions_project_id", "webhook_subscriptions", ["project_id"])

    if not table_exists(connection, "webhook_deliveries"):
        op.create_table(
            "webhook_deliveries",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("subscription_id", sa.Integer(), nullable=False),
            sa.Column("event", sa.String(length=64), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
            sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
            sa.Column("response_status", sa.Integer()),
            sa.Column("response_body", sa.Text()),
            sa.Column("error", sa.Text()),
            sa.Column("delivered_at", sa.DateTime(timezone=True)),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.ForeignKeyConstraint(["subscription_id"], ["webhook_subscriptions.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_webhook_deliveries_subscription_id", "webhook_deliveries", ["subscription_id"])
        op.create_index("ix_webhook_deliveries_event", "webhook_deliveries", ["event"])


def downgrade() -> None:
    connection = op.get_bind()
    if table_exists(connection, "webhook_deliveries"):
        op.drop_table("webhook_deliveries")
    if table_exists(connection, "webhook_subscriptions"):
        op.drop_table("webhook_subscriptions")
    if table_exists(connection, "api_tokens"):
        op.drop_table("api_tokens")
