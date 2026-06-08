"""extend user two-factor recovery and sessions

Revision ID: extend_user_two_factor_recovery
Revises: add_user_two_factor_auth
Create Date: 2026-06-08 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

from app.services.migration_helpers import add_column_if_missing, column_exists, drop_column_if_exists, table_exists


revision = "extend_user_two_factor_recovery"
down_revision = "add_user_two_factor_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    add_column_if_missing(op, "users", sa.Column("two_factor_recovery_codes", sa.Text(), nullable=True))
    add_column_if_missing(op, "users", sa.Column("session_version", sa.Integer(), nullable=False, server_default="0"))

    if table_exists(connection, "users") and column_exists(connection, "users", "two_factor_secret"):
        if connection.dialect.name == "sqlite":
            with op.batch_alter_table("users") as batch_op:
                batch_op.alter_column("two_factor_secret", existing_type=sa.String(length=64), type_=sa.Text(), nullable=True)
        elif connection.dialect.name in {"mysql", "mariadb"}:
            op.alter_column("users", "two_factor_secret", existing_type=sa.String(length=64), type_=sa.Text(), nullable=True)
        else:
            op.alter_column("users", "two_factor_secret", type_=sa.Text(), nullable=True)

        from app.crypto import decrypt_data, encrypt_data

        rows = connection.execute(sa.text("SELECT id, two_factor_secret FROM users WHERE two_factor_secret IS NOT NULL")).fetchall()
        for user_id, stored_secret in rows:
            try:
                decrypt_data(stored_secret)
            except ValueError:
                connection.execute(
                    sa.text("UPDATE users SET two_factor_secret = :secret WHERE id = :user_id"),
                    {"secret": encrypt_data(stored_secret), "user_id": user_id},
                )


def downgrade() -> None:
    drop_column_if_exists(op, "users", "session_version")
    drop_column_if_exists(op, "users", "two_factor_recovery_codes")
