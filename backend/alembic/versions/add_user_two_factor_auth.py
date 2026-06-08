"""add user two-factor auth fields

Revision ID: add_user_two_factor_auth
Revises: add_composite_indexes
Create Date: 2026-06-08 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import add_column_if_missing, drop_column_if_exists


revision = "add_user_two_factor_auth"
down_revision = "add_composite_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    add_column_if_missing(op, "users", sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    add_column_if_missing(op, "users", sa.Column("two_factor_secret", sa.Text(), nullable=True))


def downgrade() -> None:
    drop_column_if_exists(op, "users", "two_factor_secret")
    drop_column_if_exists(op, "users", "two_factor_enabled")
