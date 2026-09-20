"""Add profile columns to users (bio/location/website/company/avatar_url)

Revision ID: add_user_profile_fields
Revises: add_test_debt_false_positive
Create Date: 2026-09-20 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import add_column_if_missing, drop_column_if_exists


revision = "add_user_profile_fields"
down_revision = "add_test_debt_false_positive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    add_column_if_missing(op, "users", sa.Column("bio", sa.String(500), nullable=True))
    add_column_if_missing(op, "users", sa.Column("location", sa.String(100), nullable=True))
    add_column_if_missing(op, "users", sa.Column("website", sa.String(255), nullable=True))
    add_column_if_missing(op, "users", sa.Column("company", sa.String(100), nullable=True))
    add_column_if_missing(op, "users", sa.Column("avatar_url", sa.Text(), nullable=True))


def downgrade() -> None:
    drop_column_if_exists(op, "users", "avatar_url")
    drop_column_if_exists(op, "users", "company")
    drop_column_if_exists(op, "users", "website")
    drop_column_if_exists(op, "users", "location")
    drop_column_if_exists(op, "users", "bio")
