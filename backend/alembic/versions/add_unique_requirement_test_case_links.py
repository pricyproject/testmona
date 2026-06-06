"""Add unique requirement test case links

Revision ID: add_unique_requirement_test_case_links
Revises: repair_schema_drift
Create Date: 2026-05-19 00:00:00.000000

"""
from alembic import op
from sqlalchemy import Integer, inspect

from app.services.migration_helpers import column_exists, table_exists


revision = "add_unique_requirement_test_case_links"
down_revision = "repair_schema_drift"
branch_labels = None
depends_on = None


def _unique_constraint_exists(connection, table_name: str, constraint_name: str) -> bool:
    if not table_exists(connection, table_name):
        return False
    inspector = inspect(connection)
    return any(item.get("name") == constraint_name for item in inspector.get_unique_constraints(table_name)) or any(
        item.get("name") == constraint_name and item.get("unique")
        for item in inspector.get_indexes(table_name)
    )


def _dedupe_table(table_name: str) -> None:
    if table_name == "traceability_matrix":
        op.execute(
            """
            DELETE FROM traceability_matrix
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM traceability_matrix
                GROUP BY requirement_id, test_case_id
            )
            """
        )
        return

    op.execute(
        """
        CREATE TEMPORARY TABLE tmp_requirement_test_case_links AS
        SELECT DISTINCT requirement_id, test_case_id
        FROM requirement_test_case_links
        """
    )
    op.execute("DELETE FROM requirement_test_case_links")
    op.execute(
        """
        INSERT INTO requirement_test_case_links (requirement_id, test_case_id)
        SELECT requirement_id, test_case_id
        FROM tmp_requirement_test_case_links
        """
    )
    op.execute("DROP TABLE tmp_requirement_test_case_links")


def _create_unique_constraint(table_name: str, constraint_name: str) -> None:
    connection = op.get_bind()
    if not table_exists(connection, table_name) or _unique_constraint_exists(connection, table_name, constraint_name):
        return

    _dedupe_table(table_name)
    if connection.dialect.name == "sqlite":
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.create_unique_constraint(constraint_name, ["requirement_id", "test_case_id"])
    else:
        op.create_unique_constraint(constraint_name, table_name, ["requirement_id", "test_case_id"])


def _require_association_columns() -> None:
    connection = op.get_bind()
    if not (
        table_exists(connection, "requirement_test_case_links")
        and column_exists(connection, "requirement_test_case_links", "requirement_id")
        and column_exists(connection, "requirement_test_case_links", "test_case_id")
    ):
        return

    op.execute(
        """
        DELETE FROM requirement_test_case_links
        WHERE requirement_id IS NULL OR test_case_id IS NULL
        """
    )

    if connection.dialect.name == "sqlite":
        with op.batch_alter_table("requirement_test_case_links") as batch_op:
            batch_op.alter_column("requirement_id", nullable=False)
            batch_op.alter_column("test_case_id", nullable=False)
    else:
        # MySQL/MariaDB MODIFY COLUMN restates the full definition, so the
        # existing type must be provided.
        op.alter_column(
            "requirement_test_case_links", "requirement_id",
            existing_type=Integer(), nullable=False,
        )
        op.alter_column(
            "requirement_test_case_links", "test_case_id",
            existing_type=Integer(), nullable=False,
        )


def upgrade() -> None:
    _require_association_columns()
    _create_unique_constraint("traceability_matrix", "uq_traceability_matrix_requirement_test_case")
    _create_unique_constraint("requirement_test_case_links", "uq_requirement_test_case_links_requirement_test_case")


def downgrade() -> None:
    connection = op.get_bind()
    for table_name, constraint_name in (
        ("traceability_matrix", "uq_traceability_matrix_requirement_test_case"),
        ("requirement_test_case_links", "uq_requirement_test_case_links_requirement_test_case"),
    ):
        if not table_exists(connection, table_name) or not _unique_constraint_exists(connection, table_name, constraint_name):
            continue
        if connection.dialect.name == "sqlite":
            with op.batch_alter_table(table_name) as batch_op:
                batch_op.drop_constraint(constraint_name, type_="unique")
        else:
            op.drop_constraint(constraint_name, table_name, type_="unique")
