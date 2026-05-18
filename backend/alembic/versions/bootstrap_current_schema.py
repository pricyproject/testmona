"""bootstrap current schema

Revision ID: bootstrap_current_schema
Revises:
Create Date: 2026-05-18 00:00:00.000000

"""
from alembic import op

from app.database import Base
from app import models, models_versioning


revision = "bootstrap_current_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    raise RuntimeError("Refusing to drop the full application schema from the bootstrap migration")
