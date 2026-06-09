"""Add test case suite memberships

Revision ID: add_test_case_suite_memberships
Revises: add_composite_indexes
Create Date: 2026-06-05 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import index_exists, table_exists


revision = "add_test_case_suite_memberships"
down_revision = "add_composite_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    if not table_exists(connection, "test_case_suite_memberships"):
        op.create_table(
            "test_case_suite_memberships",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("test_case_id", sa.Integer(), nullable=False),
            sa.Column("test_suite_id", sa.Integer(), nullable=False),
            sa.Column("section_id", sa.Integer(), nullable=True),
            sa.Column("order_index", sa.Integer(), nullable=True),
            sa.Column("is_primary", sa.Boolean(), server_default=sa.false(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["section_id"], ["test_case_sections.id"]),
            sa.ForeignKeyConstraint(["test_case_id"], ["test_cases.id"]),
            sa.ForeignKeyConstraint(["test_suite_id"], ["test_suites.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "test_case_id",
                "test_suite_id",
                name="uq_test_case_suite_memberships_case_suite",
            ),
        )

    for index_name, columns, unique in (
        (op.f("ix_test_case_suite_memberships_id"), ["id"], False),
        (op.f("ix_test_case_suite_memberships_test_case_id"), ["test_case_id"], False),
        (op.f("ix_test_case_suite_memberships_test_suite_id"), ["test_suite_id"], False),
        (op.f("ix_test_case_suite_memberships_section_id"), ["section_id"], False),
    ):
        if not index_exists(connection, "test_case_suite_memberships", index_name):
            op.create_index(index_name, "test_case_suite_memberships", columns, unique=unique)

    op.execute(
        """
        INSERT INTO test_case_suite_memberships (
            test_case_id,
            test_suite_id,
            section_id,
            order_index,
            is_primary
        )
        SELECT
            tc.id,
            tc.test_suite_id,
            tc.section_id,
            COALESCE(tc.order_index, 0),
            1
        FROM test_cases tc
        WHERE tc.test_suite_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1
            FROM test_case_suite_memberships existing
            WHERE existing.test_case_id = tc.id
            AND existing.test_suite_id = tc.test_suite_id
        )
        """
    )


def downgrade() -> None:
    connection = op.get_bind()
    if not table_exists(connection, "test_case_suite_memberships"):
        return

    for index_name in (
        op.f("ix_test_case_suite_memberships_section_id"),
        op.f("ix_test_case_suite_memberships_test_suite_id"),
        op.f("ix_test_case_suite_memberships_test_case_id"),
        op.f("ix_test_case_suite_memberships_id"),
    ):
        if index_exists(connection, "test_case_suite_memberships", index_name):
            op.drop_index(index_name, table_name="test_case_suite_memberships")
    op.drop_table("test_case_suite_memberships")
