"""Add execution pause/resume fields to test_results

Revision ID: add_execution_pause_resume_fields
Revises: add_step_type
Create Date: 2026-05-12 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import add_column_if_missing, column_exists, drop_column_if_exists


# revision identifiers, used by Alembic.
revision = 'add_execution_pause_resume_fields'
down_revision = 'add_step_type'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add pause/resume fields to test_results table"""

    add_column_if_missing(op, 'test_results', sa.Column('execution_state', sa.String(length=20), nullable=True, default='idle'))
    add_column_if_missing(op, 'test_results', sa.Column('paused_at', sa.DateTime(timezone=True), nullable=True))
    add_column_if_missing(op, 'test_results', sa.Column('total_paused_time', sa.Float(), nullable=True, default=0.0))
    add_column_if_missing(op, 'test_results', sa.Column('manual_time_adjustment', sa.Float(), nullable=True, default=0.0))

    connection = op.get_bind()
    if column_exists(connection, 'test_results', 'execution_state'):
        op.execute("UPDATE test_results SET execution_state = 'idle' WHERE execution_state IS NULL")
    if column_exists(connection, 'test_results', 'total_paused_time'):
        op.execute("UPDATE test_results SET total_paused_time = 0.0 WHERE total_paused_time IS NULL")
    if column_exists(connection, 'test_results', 'manual_time_adjustment'):
        op.execute("UPDATE test_results SET manual_time_adjustment = 0.0 WHERE manual_time_adjustment IS NULL")


def downgrade() -> None:
    """Remove pause/resume fields from test_results table"""

    drop_column_if_exists(op, 'test_results', 'manual_time_adjustment')
    drop_column_if_exists(op, 'test_results', 'total_paused_time')
    drop_column_if_exists(op, 'test_results', 'paused_at')
    drop_column_if_exists(op, 'test_results', 'execution_state')
