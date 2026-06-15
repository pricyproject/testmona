"""Allow the IN_REVIEW value on docs.status (document review flow)

Revision ID: add_doc_in_review_status
Revises: add_notification_preferences
Create Date: 2026-06-15 13:00:00.000000

``DocStatus`` gains an ``IN_REVIEW`` member so a doc can be put up for review
(``POST /docs/{id}/request-review``). ``docs.status`` was created as a plain
``VARCHAR(50)`` (see ``add_doc_hub``) that stores the enum *name* ("DRAFT",
"PUBLISHED", …), so a new member needs no column change on SQLite/Postgres or on
the MySQL/MariaDB deployments this project ships. The only case that would need
DDL is a legacy install whose column is a *native* ENUM type; this migration
detects that and widens it, and is otherwise a no-op.
"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import can_inspect_database, column_exists


revision = "add_doc_in_review_status"
down_revision = "add_notification_preferences"
branch_labels = None
depends_on = None


# Enum names as stored in the column (SQLAlchemy persists the member name).
_NAMES = ("DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED")


def _status_is_native_enum(connection) -> bool:
    """True only when docs.status is a real ENUM type (legacy MySQL installs)."""
    if not can_inspect_database(connection) or not column_exists(connection, "docs", "status"):
        return False
    inspector = sa.inspect(connection)
    for col in inspector.get_columns("docs"):
        if col["name"] == "status":
            return isinstance(col["type"], sa.Enum)
    return False


def upgrade() -> None:
    connection = op.get_bind()
    # Plain VARCHAR column (every supported deployment): nothing to do — it already
    # accepts the new value. Only a native ENUM needs its allowed set extended.
    if _status_is_native_enum(connection):
        op.alter_column(
            "docs",
            "status",
            type_=sa.Enum(*_NAMES, name="docstatus"),
            existing_nullable=False,
        )


def downgrade() -> None:
    # Non-destructive by design: leaving IN_REVIEW permitted on a VARCHAR column is
    # harmless, and narrowing a native ENUM could orphan in-review docs. No-op.
    pass
