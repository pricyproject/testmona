"""Add name to doc_versions (manual milestone revisions)

Revision ID: add_doc_version_name
Revises: add_normalized_test_case_tags
Create Date: 2026-06-21 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import (
    add_column_if_missing,
    drop_column_if_exists,
)


revision = "add_doc_version_name"
down_revision = "add_normalized_test_case_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Optional label for a manually-created "snapshot" revision. NULL for the
    # routine autosave snapshots, which keep their existing change_note only.
    add_column_if_missing(
        op,
        "doc_versions",
        sa.Column("name", sa.String(length=200), nullable=True),
    )


def downgrade() -> None:
    drop_column_if_exists(op, "doc_versions", "name")
