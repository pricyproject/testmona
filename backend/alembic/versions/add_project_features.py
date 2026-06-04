"""Add features JSON column to projects for per-project feature toggles

Revision ID: add_project_features
Revises: add_doc_hub
Create Date: 2026-06-04 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import column_exists


revision = "add_project_features"
down_revision = "add_doc_hub"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if not column_exists(connection, "projects", "features"):
        op.add_column("projects", sa.Column("features", sa.JSON(), nullable=True))


def downgrade() -> None:
    connection = op.get_bind()
    if column_exists(connection, "projects", "features"):
        op.drop_column("projects", "features")
