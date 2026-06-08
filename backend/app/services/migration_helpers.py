from collections.abc import Callable, Iterable, Iterator, Sequence
from typing import Any
import re

from sqlalchemy import Table, inspect, select, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import NoInspectionAvailable


IGNORED_MIGRATION_TABLES = {"alembic_version"}
IGNORED_MIGRATION_PREFIXES = ("sqlite_", "tmp_", "temp_")


def include_migration_object(
    object_: Any,
    name: str | None,
    type_: str,
    reflected: bool,
    compare_to: Any,
) -> bool:
    """Filter internal/transient objects out of Alembic autogenerate diffs."""
    del object_, reflected, compare_to
    if not name:
        return True

    if type_ == "table" and (name in IGNORED_MIGRATION_TABLES or name.startswith(IGNORED_MIGRATION_PREFIXES)):
        return False

    if type_ == "index" and name.startswith(IGNORED_MIGRATION_PREFIXES):
        return False

    return True


def _normalize_default(default: Any) -> str:
    if default is None:
        return ""

    normalized = str(default).lower().strip()
    normalized = normalized.replace("`", "").replace("'", "").replace('"', "")
    normalized = re.sub(r"\s+", "", normalized)
    normalized = normalized.replace("defaultclause(", "")
    normalized = normalized.replace("current_timestamp()", "current_timestamp")
    normalized = normalized.replace("now()", "current_timestamp")
    normalized = normalized.replace("false", "0").replace("true", "1")
    return normalized


def compare_server_default(
    context: Any,
    inspected_column: Any,
    metadata_column: Any,
    inspected_default: Any,
    metadata_default: Any,
    rendered_metadata_default: Any,
) -> bool | None:
    """Suppress equivalent default diffs while keeping real default drift visible."""
    del context, inspected_column, metadata_column
    inspected = _normalize_default(inspected_default)
    metadata = _normalize_default(rendered_metadata_default or metadata_default)

    if inspected == metadata:
        return False

    timestamp_defaults = {"current_timestamp", "current_timestamp(6)", "current_timestamponupdatecurrent_timestamp"}
    if inspected in timestamp_defaults and metadata in timestamp_defaults:
        return False

    return None


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


def require_table(connection: Connection, table_name: str) -> None:
    """Fail a migration early when an expected table is absent."""
    if not table_exists(connection, table_name):
        raise RuntimeError(f"Required table is missing before migration: {table_name}")


def require_column(connection: Connection, table_name: str, column_name: str) -> None:
    """Fail a migration early when an expected column is absent."""
    if not column_exists(connection, table_name, column_name):
        raise RuntimeError(f"Required column is missing before migration: {table_name}.{column_name}")


def require_column_absent(connection: Connection, table_name: str, column_name: str) -> None:
    """Fail a migration early when an additive column would overwrite existing data."""
    if column_exists(connection, table_name, column_name):
        raise RuntimeError(f"Column already exists before migration: {table_name}.{column_name}")


def create_index_if_missing(
    operations: Any,
    index_name: str,
    table_name: str,
    columns: Sequence[str],
    *,
    unique: bool = False,
) -> None:
    """Create an index only when the table exists and the index is absent."""
    connection = operations.get_bind()
    if table_exists(connection, table_name) and not index_exists(connection, table_name, index_name):
        operations.create_index(index_name, table_name, list(columns), unique=unique)


def drop_index_if_exists(operations: Any, index_name: str, table_name: str) -> None:
    """Drop an index only when it is present."""
    connection = operations.get_bind()
    if index_exists(connection, table_name, index_name):
        operations.drop_index(index_name, table_name=table_name)


def iter_primary_key_batches(
    connection: Connection,
    table: Table,
    primary_key_column: Any,
    *,
    batch_size: int = 500,
) -> Iterator[list[Any]]:
    """Yield primary-key batches for data backfills without long table locks."""
    last_seen = None
    while True:
        statement = select(primary_key_column).select_from(table).order_by(primary_key_column).limit(batch_size)
        if last_seen is not None:
            statement = statement.where(primary_key_column > last_seen)

        batch = [row[0] for row in connection.execute(statement).all()]
        if not batch:
            return

        yield batch
        last_seen = batch[-1]


def run_batched_update(
    connection: Connection,
    batches: Iterable[Sequence[Any]],
    update_sql: str,
    bind_parameters: Callable[[Sequence[Any]], dict[str, Any]],
) -> int:
    """Run a parameterized update for each batch and return the affected row count."""
    affected_rows = 0
    statement = text(update_sql)
    for batch in batches:
        result = connection.execute(statement, bind_parameters(batch))
        affected_rows += result.rowcount or 0
    return affected_rows
