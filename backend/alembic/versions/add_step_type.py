"""add step_type to test_case_steps

Revision ID: add_step_type
Revises: bootstrap_current_schema
Create Date: 2026-04-22

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import add_column_if_missing, drop_column_if_exists

# revision identifiers, used by Alembic.
revision = 'add_step_type'
down_revision = "bootstrap_current_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    add_column_if_missing(op, 'test_case_steps', sa.Column('step_type', sa.String(20), default='manual'))
    add_column_if_missing(op, 'test_case_steps', sa.Column('data', sa.JSON, nullable=True))
    add_column_if_missing(op, 'test_case_steps', sa.Column('order_index', sa.Integer, default=0))


def downgrade() -> None:
    drop_column_if_exists(op, 'test_case_steps', 'order_index')
    drop_column_if_exists(op, 'test_case_steps', 'data')
    drop_column_if_exists(op, 'test_case_steps', 'step_type')
