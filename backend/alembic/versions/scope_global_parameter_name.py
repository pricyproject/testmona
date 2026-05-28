"""Scope global_parameters uniqueness to (project_id, name)

Previously ``name`` was globally unique, so two projects could not reuse the
same parameter name and a collision surfaced as a DB IntegrityError. Replace the
single-column unique index with a composite unique on (project_id, name).

Revision ID: scope_global_parameter_name
Revises: add_test_datasets
Create Date: 2026-05-28 11:00:00.000000

"""
from alembic import op

from app.services.migration_helpers import index_exists


revision = "scope_global_parameter_name"
down_revision = "add_test_datasets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    # Drop the old global unique index on name.
    if index_exists(connection, "global_parameters", "ix_global_parameters_name"):
        op.drop_index("ix_global_parameters_name", table_name="global_parameters")
    # Recreate it as a plain (non-unique) index so name lookups stay fast.
    if not index_exists(connection, "global_parameters", "ix_global_parameters_name"):
        op.create_index("ix_global_parameters_name", "global_parameters", ["name"])
    # Enforce uniqueness per scope instead of globally.
    if not index_exists(connection, "global_parameters", "uq_global_parameter_project_name"):
        op.create_index(
            "uq_global_parameter_project_name",
            "global_parameters",
            ["project_id", "name"],
            unique=True,
        )


def downgrade() -> None:
    connection = op.get_bind()

    if index_exists(connection, "global_parameters", "uq_global_parameter_project_name"):
        op.drop_index("uq_global_parameter_project_name", table_name="global_parameters")
    if index_exists(connection, "global_parameters", "ix_global_parameters_name"):
        op.drop_index("ix_global_parameters_name", table_name="global_parameters")
    op.create_index("ix_global_parameters_name", "global_parameters", ["name"], unique=True)
