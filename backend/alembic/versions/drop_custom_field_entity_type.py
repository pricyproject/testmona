"""drop obsolete custom field entity type

Revision ID: drop_custom_field_entity_type
Revises: add_import_operations
Create Date: 2026-05-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import can_inspect_database, column_exists, table_exists


revision = "drop_custom_field_entity_type"
down_revision = "add_import_operations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if not can_inspect_database(connection):
        return

    if not column_exists(connection, "custom_field_definitions", "entity_type"):
        return

    if connection.dialect.name == "sqlite":
        with op.batch_alter_table("custom_field_definitions") as batch_op:
            batch_op.drop_column("entity_type")
    else:
        op.drop_column("custom_field_definitions", "entity_type")


def downgrade() -> None:
    connection = op.get_bind()
    if not can_inspect_database(connection):
        return

    if table_exists(connection, "custom_field_definitions") and not column_exists(
        connection,
        "custom_field_definitions",
        "entity_type",
    ):
        op.add_column("custom_field_definitions", sa.Column("entity_type", sa.String(50), nullable=True))
