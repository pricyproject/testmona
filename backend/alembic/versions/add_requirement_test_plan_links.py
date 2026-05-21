"""Add requirement test plan links

Revision ID: add_requirement_test_plan_links
Revises: add_unique_requirement_test_case_links
Create Date: 2026-05-19 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import table_exists


revision = "add_requirement_test_plan_links"
down_revision = "add_unique_requirement_test_case_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if table_exists(connection, "requirement_test_plan_links"):
        return

    op.create_table(
        "requirement_test_plan_links",
        sa.Column("requirement_id", sa.Integer(), nullable=False),
        sa.Column("test_plan_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["requirement_id"], ["requirements.id"]),
        sa.ForeignKeyConstraint(["test_plan_id"], ["test_plans.id"]),
        sa.UniqueConstraint(
            "requirement_id",
            "test_plan_id",
            name="uq_requirement_test_plan_links_requirement_test_plan",
        ),
    )


def downgrade() -> None:
    connection = op.get_bind()
    if table_exists(connection, "requirement_test_plan_links"):
        op.drop_table("requirement_test_plan_links")
