"""Make requirement_id unique per project instead of globally

Revision ID: requirement_id_per_project_unique
Revises: add_test_result_defect_links
Create Date: 2026-05-22 00:00:00.000000

The requirements.requirement_id column was globally UNIQUE, so a human-facing
ID such as REQ-001 could only exist once across the entire system. This swaps
that for a composite UNIQUE(project_id, requirement_id) so each project owns
its own ID namespace.
"""
from alembic import op
from sqlalchemy import inspect


revision = "requirement_id_per_project_unique"
down_revision = "add_test_result_defect_links"
branch_labels = None
depends_on = None

CONSTRAINT_NAME = "uq_requirements_project_requirement_id"
# Deterministic name alembic batch mode assigns to the reflected, originally
# unnamed column-level UNIQUE(requirement_id) so it can be dropped.
NAMING_CONVENTION = {"uq": "uq_%(table_name)s_%(column_0_name)s"}
LEGACY_UNIQUE_NAME = "uq_requirements_requirement_id"


def _has_composite_unique(connection) -> bool:
    inspector = inspect(connection)
    if "requirements" not in inspector.get_table_names():
        return False
    for unique in inspector.get_unique_constraints("requirements"):
        if unique.get("name") == CONSTRAINT_NAME:
            return True
        if set(unique.get("column_names") or []) == {"project_id", "requirement_id"}:
            return True
    return False


def upgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)
    if "requirements" not in inspector.get_table_names():
        return
    if _has_composite_unique(connection):
        return

    with op.batch_alter_table("requirements", naming_convention=NAMING_CONVENTION) as batch_op:
        try:
            batch_op.drop_constraint(LEGACY_UNIQUE_NAME, type_="unique")
        except Exception:
            # Some dialects do not surface an inline column UNIQUE as a
            # droppable constraint; the composite one below is what matters.
            pass
        batch_op.create_unique_constraint(CONSTRAINT_NAME, ["project_id", "requirement_id"])


def downgrade() -> None:
    connection = op.get_bind()
    if not _has_composite_unique(connection):
        return
    with op.batch_alter_table("requirements") as batch_op:
        batch_op.drop_constraint(CONSTRAINT_NAME, type_="unique")
        batch_op.create_unique_constraint(LEGACY_UNIQUE_NAME, ["requirement_id"])
