"""Add milestone_id to test_runs

Revision ID: add_milestone_id_to_test_runs
Revises: add_execution_pause_resume_fields
Create Date: 2026-05-14 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import (
    add_column_if_missing,
    column_exists,
    drop_column_if_exists,
    foreign_key_exists,
    foreign_key_name,
    table_exists,
)


# revision identifiers, used by Alembic.
revision = 'add_milestone_id_to_test_runs'
down_revision = 'add_execution_pause_resume_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    add_column_if_missing(op, 'test_runs', sa.Column('milestone_id', sa.Integer(), nullable=True))

    if not (
        table_exists(connection, 'test_runs')
        and table_exists(connection, 'milestones')
        and column_exists(connection, 'test_runs', 'milestone_id')
        and not foreign_key_exists(connection, 'test_runs', 'milestone_id', 'milestones', 'id')
    ):
        return

    op.execute(
        """
        UPDATE test_runs
        SET milestone_id = NULL
        WHERE milestone_id IS NOT NULL
        AND milestone_id NOT IN (SELECT id FROM milestones)
        """
    )

    if connection.dialect.name == 'sqlite':
        with op.batch_alter_table('test_runs') as batch_op:
            batch_op.create_foreign_key(
                'fk_test_runs_milestone_id_milestones',
                'milestones',
                ['milestone_id'],
                ['id'],
            )
    else:
        op.create_foreign_key(
            'fk_test_runs_milestone_id_milestones',
            'test_runs',
            'milestones',
            ['milestone_id'],
            ['id'],
        )


def downgrade() -> None:
    connection = op.get_bind()
    constraint_name = foreign_key_name(connection, 'test_runs', 'milestone_id', 'milestones', 'id')
    if constraint_name and connection.dialect.name != 'sqlite':
        op.drop_constraint(constraint_name, 'test_runs', type_='foreignkey')

    drop_column_if_exists(op, 'test_runs', 'milestone_id')
