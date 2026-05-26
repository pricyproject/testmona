"""Unify custom fields engine across test cases, runs, defects, requirements

Revision ID: unify_custom_fields_engine
Revises: add_saved_filters
Create Date: 2026-05-26 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import column_exists


revision = "unify_custom_fields_engine"
down_revision = "add_saved_filters"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    # CustomFieldDefinition: which entity types this field applies to.
    if not column_exists(connection, "custom_field_definitions", "entity_types"):
        op.add_column("custom_field_definitions", sa.Column("entity_types", sa.JSON(), nullable=True))

    # CustomFieldValue: polymorphic ownership across the four target tables.
    # We keep the existing test_case_id column and relax its NOT NULL so the
    # other three FKs can carry the row's owner. Existing rows are
    # untouched — they remain test-case owned.
    with op.batch_alter_table("custom_field_values") as batch:
        if not column_exists(connection, "custom_field_values", "test_run_id"):
            batch.add_column(sa.Column("test_run_id", sa.Integer(), nullable=True))
        if not column_exists(connection, "custom_field_values", "defect_id"):
            batch.add_column(sa.Column("defect_id", sa.Integer(), nullable=True))
        if not column_exists(connection, "custom_field_values", "requirement_id"):
            batch.add_column(sa.Column("requirement_id", sa.Integer(), nullable=True))
        # Relax test_case_id from NOT NULL to NULL so values can target other entities.
        batch.alter_column("test_case_id", existing_type=sa.Integer(), nullable=True)
        # FKs.
        batch.create_foreign_key("fk_cfv_test_run_id", "test_runs", ["test_run_id"], ["id"])
        batch.create_foreign_key("fk_cfv_defect_id", "defects", ["defect_id"], ["id"])
        batch.create_foreign_key("fk_cfv_requirement_id", "requirements", ["requirement_id"], ["id"])

    # Helpful indexes for per-entity lookups.
    op.create_index("ix_cfv_test_run_id", "custom_field_values", ["test_run_id"])
    op.create_index("ix_cfv_defect_id", "custom_field_values", ["defect_id"])
    op.create_index("ix_cfv_requirement_id", "custom_field_values", ["requirement_id"])


def downgrade() -> None:
    op.drop_index("ix_cfv_requirement_id", table_name="custom_field_values")
    op.drop_index("ix_cfv_defect_id", table_name="custom_field_values")
    op.drop_index("ix_cfv_test_run_id", table_name="custom_field_values")
    with op.batch_alter_table("custom_field_values") as batch:
        batch.drop_constraint("fk_cfv_requirement_id", type_="foreignkey")
        batch.drop_constraint("fk_cfv_defect_id", type_="foreignkey")
        batch.drop_constraint("fk_cfv_test_run_id", type_="foreignkey")
        batch.drop_column("requirement_id")
        batch.drop_column("defect_id")
        batch.drop_column("test_run_id")
        batch.alter_column("test_case_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("custom_field_definitions", "entity_types")
