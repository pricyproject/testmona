from typing import Any

from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.exc import NoInspectionAvailable


def can_inspect_database(connection: Connection) -> bool:
    """Return True when SQLAlchemy can inspect live database metadata."""
    try:
        inspect(connection)
    except NoInspectionAvailable:
        return False
    return True


def table_exists(connection: Connection, table_name: str) -> bool:
    """Return True when the database currently has the given table."""
    try:
        return inspect(connection).has_table(table_name)
    except NoInspectionAvailable:
        return False


def column_exists(connection: Connection, table_name: str, column_name: str) -> bool:
    """Return True when the table currently has the given column."""
    if not table_exists(connection, table_name):
        return False
    return any(column["name"] == column_name for column in inspect(connection).get_columns(table_name))


def index_exists(connection: Connection, table_name: str, index_name: str) -> bool:
    """Return True when the table currently has the given index."""
    if not table_exists(connection, table_name):
        return False
    return any(index["name"] == index_name for index in inspect(connection).get_indexes(table_name))


def foreign_key_exists(
    connection: Connection,
    table_name: str,
    constrained_column: str,
    referred_table: str,
    referred_column: str,
) -> bool:
    """Return True when the table has the expected foreign key relationship."""
    if not table_exists(connection, table_name):
        return False

    for foreign_key in inspect(connection).get_foreign_keys(table_name):
        if (
            foreign_key.get("constrained_columns") == [constrained_column]
            and foreign_key.get("referred_table") == referred_table
            and foreign_key.get("referred_columns") == [referred_column]
        ):
            return True
    return False


def foreign_key_name(
    connection: Connection,
    table_name: str,
    constrained_column: str,
    referred_table: str,
    referred_column: str,
) -> str | None:
    """Return the matching foreign key constraint name when the database exposes it."""
    if not table_exists(connection, table_name):
        return None

    for foreign_key in inspect(connection).get_foreign_keys(table_name):
        if (
            foreign_key.get("constrained_columns") == [constrained_column]
            and foreign_key.get("referred_table") == referred_table
            and foreign_key.get("referred_columns") == [referred_column]
        ):
            return foreign_key.get("name")
    return None


def add_column_if_missing(operations: Any, table_name: str, column: Any) -> None:
    """Add a column only when both the table exists and the column is absent."""
    connection = operations.get_bind()
    if table_exists(connection, table_name) and not column_exists(connection, table_name, column.name):
        operations.add_column(table_name, column)


def drop_column_if_exists(operations: Any, table_name: str, column_name: str) -> None:
    """Drop a column only when it is present."""
    connection = operations.get_bind()
    if column_exists(connection, table_name, column_name):
        if connection.dialect.name == "sqlite":
            with operations.batch_alter_table(table_name) as batch_op:
                batch_op.drop_column(column_name)
        else:
            operations.drop_column(table_name, column_name)
