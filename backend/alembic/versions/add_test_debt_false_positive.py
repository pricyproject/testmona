"""Add false-positive marking to test debt items

Revision ID: add_test_debt_false_positive
Revises: add_catalog_seq_unique_indexes
Create Date: 2026-09-15 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "add_test_debt_false_positive"
down_revision = "add_catalog_seq_unique_indexes"
branch_labels = None
depends_on = None


def _column_exists(connection, table: str, column: str) -> bool:
    inspector = sa.inspect(connection)
    try:
        return any(col["name"] == column for col in inspector.get_columns(table))
    except Exception:
        return False


def upgrade() -> None:
    connection = op.get_bind()
    if not _column_exists(connection, "test_debt_items", "is_false_positive"):
        op.add_column(
            "test_debt_items",
            sa.Column("is_false_positive", sa.Boolean(), nullable=False, server_default="0"),
        )
    if not _column_exists(connection, "test_debt_items", "false_positive_reason"):
        op.add_column("test_debt_items", sa.Column("false_positive_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    connection = op.get_bind()
    if _column_exists(connection, "test_debt_items", "false_positive_reason"):
        op.drop_column("test_debt_items", "false_positive_reason")
    if _column_exists(connection, "test_debt_items", "is_false_positive"):
        op.drop_column("test_debt_items", "is_false_positive")
