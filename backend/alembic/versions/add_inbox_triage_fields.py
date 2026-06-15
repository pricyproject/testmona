"""Add Work Inbox triage fields (snoozed_until, done_at) to notifications

Revision ID: add_inbox_triage_fields
Revises: add_doc_in_review_status
Create Date: 2026-06-15 14:00:00.000000

Phase W0 of PLAN B (Work Inbox as a task queue). The Work Inbox owns two new
lifecycle fields on ``notifications`` while ``is_read`` stays a shared primitive:

- ``snoozed_until``: when set and in the future, the row is hidden from the open
  inbox until the snooze elapses (Open → Snoozed → Open).
- ``done_at``: stamped when ``archived`` flips true ("done"); cleared on restore.

Both are loose ``DateTime(timezone=True)`` columns, nullable, with no default —
existing rows are simply "never snoozed / not done".
"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import (
    add_column_if_missing,
    drop_column_if_exists,
)


revision = "add_inbox_triage_fields"
down_revision = "add_doc_in_review_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    add_column_if_missing(
        op,
        "notifications",
        sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True),
    )
    add_column_if_missing(
        op,
        "notifications",
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    drop_column_if_exists(op, "notifications", "done_at")
    drop_column_if_exists(op, "notifications", "snoozed_until")
