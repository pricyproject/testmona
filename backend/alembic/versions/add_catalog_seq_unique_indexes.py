"""Add missing unique (project_id, project_seq) backstops to catalog tables

Revision ID: add_catalog_seq_unique_indexes
Revises: add_user_items_per_page
Create Date: 2026-09-13 00:00:00.000000

``test_type_definitions``, ``priority_definitions`` and ``shared_step_templates``
allocate ``project_seq`` via the central listener but were the only seq-bearing
tables without a unique ``(project_id, project_seq)`` index, so the documented
race backstop did not cover them. Adds the three indexes (idempotent).
"""
from alembic import op

from app.services.migration_helpers import create_index_if_missing


revision = "add_catalog_seq_unique_indexes"
down_revision = "add_user_items_per_page"
branch_labels = None
depends_on = None


_INDEXES = [
    ("uq_test_type_definitions_project_seq", "test_type_definitions"),
    ("uq_priority_definitions_project_seq", "priority_definitions"),
    ("uq_shared_step_templates_project_seq", "shared_step_templates"),
]


def upgrade() -> None:
    for index_name, table_name in _INDEXES:
        create_index_if_missing(
            op, index_name, table_name, ["project_id", "project_seq"], unique=True
        )


def downgrade() -> None:
    for index_name, table_name in _INDEXES:
        op.drop_index(index_name, table_name=table_name)
