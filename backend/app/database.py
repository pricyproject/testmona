from sqlalchemy import Boolean, DateTime, Integer, JSON, Column, MetaData, create_engine, event, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import operators
from sqlalchemy.sql.expression import UnaryExpression
from .config import settings
import uuid


# --- Cross-dialect SQL compatibility ---------------------------------------
# MySQL/MariaDB do not support the SQL-standard `NULLS FIRST` / `NULLS LAST`
# ordering syntax (PostgreSQL and SQLite do). Without this, any query using
# `.nullslast()` / `.nullsfirst()` raises a 1064 syntax error on MariaDB.
# Rewrite it to the portable `ISNULL(col)` form for the MySQL family only;
# every other backend keeps the native syntax. Registered globally on import,
# so it applies no matter which entry point (app, migrations, installers)
# loads the database module.
@compiles(UnaryExpression, "mysql")
@compiles(UnaryExpression, "mariadb")
def _mysql_nulls_ordering(element, compiler, **kw):
    modifier = getattr(element, "modifier", None)
    if modifier not in (operators.nullsfirst_op, operators.nullslast_op):
        # Any other unary expression (NOT, DISTINCT, IS NULL, negation, a bare
        # ASC/DESC, ...) — fall back to the dialect's default rendering.
        return compiler.visit_unary(element, **kw)

    inner = element.element
    # Strip an asc()/desc() wrapper to recover the bare column for the NULL test.
    if isinstance(inner, UnaryExpression) and inner.modifier in (operators.asc_op, operators.desc_op):
        column_sql = compiler.process(inner.element, **kw)
    else:
        column_sql = compiler.process(inner, **kw)
    ordering_sql = compiler.process(inner, **kw)

    # NULLS LAST  -> non-nulls first:  ISNULL(col) ASC, <ordering>
    # NULLS FIRST -> nulls first:      ISNULL(col) DESC, <ordering>
    if modifier is operators.nullslast_op:
        return "ISNULL(%s), %s" % (column_sql, ordering_sql)
    return "ISNULL(%s) DESC, %s" % (column_sql, ordering_sql)


def ensure_database_exists(database_url: str) -> None:
    """Create the target database/schema when it does not exist yet.

    SQLite creates its file automatically, but server databases (MariaDB/MySQL,
    PostgreSQL) require the database to be provisioned before we can connect to
    it. This lets a fresh deployment simply point ``DATABASE_URL`` at a running
    server — no manual ``CREATE DATABASE`` step needed.

    Called from the explicit setup paths (``init_db`` and Alembic), never at
    import time, so unit tests and CI stay unaffected.
    """
    url = make_url(database_url)
    backend = url.get_backend_name()
    db_name = url.database
    if backend not in ("mysql", "postgresql") or not db_name:
        return

    if backend == "mysql":
        # Connect to the server itself (no database selected).
        # Note: URL.set(database=None) is a no-op in SQLAlchemy; pass "" to clear.
        server_engine = create_engine(_normalize_url(database_url).set(database=""))
        try:
            with server_engine.connect() as connection:
                # Check existence first (a read every user can do) so a
                # least-privilege account pointed at a pre-created database is
                # never blocked by lacking CREATE DATABASE — MySQL denies
                # `CREATE DATABASE IF NOT EXISTS` on a privilege check before it
                # even evaluates "IF NOT EXISTS".
                exists = connection.execute(
                    text("SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = :name"),
                    {"name": db_name},
                ).scalar()
                if not exists:
                    connection.execute(
                        text(
                            f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
                            "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                        )
                    )
        finally:
            server_engine.dispose()
    else:  # postgresql
        # CREATE DATABASE can't run inside a transaction and we can't connect to
        # the target DB yet, so use the maintenance 'postgres' database in
        # autocommit mode.
        server_engine = create_engine(
            url.set(database="postgres"), isolation_level="AUTOCOMMIT"
        )
        try:
            with server_engine.connect() as connection:
                exists = connection.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :name"),
                    {"name": db_name},
                ).scalar()
                if not exists:
                    # Identifier can't be a bound parameter; db_name comes from
                    # trusted configuration.
                    connection.execute(text(f'CREATE DATABASE "{db_name}"'))
        finally:
            server_engine.dispose()


def _normalize_url(database_url: str):
    """Apply backend-appropriate connection defaults to a database URL.

    For MariaDB/MySQL we force ``charset=utf8mb4`` (unless the URL already sets
    a charset) so full 4-byte UTF-8 — emoji, non-BMP characters — round-trips
    correctly. SQLite/PostgreSQL URLs are returned unchanged.
    """
    url = make_url(database_url)
    if url.get_backend_name() == "mysql" and "charset" not in url.query:
        url = url.update_query_dict({"charset": "utf8mb4"})
    return url


def _build_engine(database_url: str):
    """Create an engine tuned for the configured database backend.

    SQLite needs ``check_same_thread=False`` for FastAPI's threaded request
    handling. Server databases (MariaDB/MySQL, PostgreSQL) need a pool that
    survives idle/dropped connections, so we enable pre-ping and recycling.
    """
    url = _normalize_url(database_url)
    backend = url.get_backend_name()
    connect_args: dict = {}
    engine_kwargs: dict = {}

    if backend == "sqlite":
        connect_args["check_same_thread"] = False
    else:
        engine_kwargs.update(pool_pre_ping=True, pool_recycle=1800)
        if backend == "mysql":
            engine_kwargs.update(pool_size=10, max_overflow=20)

    return create_engine(url, connect_args=connect_args, **engine_kwargs)


engine = _build_engine(settings.database_url)


if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):  # noqa: ARG001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(column_0_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

Base = declarative_base(metadata=MetaData(naming_convention=NAMING_CONVENTION))


def _add_column_if_missing(table_name: str, column: Column) -> bool:
    """Add one nullable column to an existing table when schema drift is detected."""
    with engine.begin() as connection:
        inspector = inspect(connection)
        if not inspector.has_table(table_name):
            return False

        existing_columns = {existing_column["name"] for existing_column in inspector.get_columns(table_name)}
        if column.name in existing_columns:
            return False

        preparer = connection.dialect.identifier_preparer
        column_type = column.type.compile(dialect=connection.dialect)
        nullable = "" if column.nullable else " NOT NULL"
        connection.execute(
            text(
                f"ALTER TABLE {preparer.quote(table_name)} "
                f"ADD COLUMN {preparer.quote(column.name)} {column_type}{nullable}"
            )
        )
        return True


def _repair_known_schema_drift() -> None:
    repaired_columns = []
    for column in (
        Column("result_snapshot", JSON(), nullable=True),
        Column("failing_step_snapshot", JSON(), nullable=True),
        Column("snapshot_created_at", DateTime(timezone=True), nullable=True),
    ):
        if _add_column_if_missing("test_result_defect_links", column):
            repaired_columns.append(column.name)

    if repaired_columns:
        print(f"✅ Missing database columns added: test_result_defect_links.{', '.join(repaired_columns)}")

    chat_repaired_columns = []
    for column in (
        # Keep these nullable at the physical schema-repair layer so SQLite can
        # add them to existing tables with rows. ORM defaults/backfills handle
        # runtime values, and the Alembic migration remains the canonical schema.
        Column("pinned", Boolean(), nullable=True),
        Column("share_expires_at", DateTime(timezone=True), nullable=True),
        Column("share_allowed_user_ids", JSON(), nullable=True),
    ):
        if _add_column_if_missing("requirement_chat_conversations", column):
            chat_repaired_columns.append(column.name)

    if chat_repaired_columns:
        with engine.begin() as connection:
            if "pinned" in chat_repaired_columns:
                connection.execute(
                    text("UPDATE requirement_chat_conversations SET pinned = 0 WHERE pinned IS NULL")
                )
        print(f"✅ Missing database columns added: requirement_chat_conversations.{', '.join(chat_repaired_columns)}")

    # Requirement foldering: the requirement_folders table is created by
    # create_all (it's a new table), but the folder_id FK on the existing
    # requirements table needs an explicit ALTER for already-provisioned DBs.
    if _add_column_if_missing("requirements", Column("folder_id", Integer(), nullable=True)):
        print("✅ Missing database column added: requirements.folder_id")

    # Doc Hub: these tables/columns may be present from older development
    # builds, so repair additive columns without rebuilding the database.
    from sqlalchemy import String as _String
    for table_name in ("doc_spaces", "doc_folders", "docs"):
        if _add_column_if_missing(table_name, Column("uuid", _String(36), nullable=True)):
            with engine.begin() as connection:
                rows = connection.execute(text(f"SELECT id FROM {table_name} WHERE uuid IS NULL")).fetchall()
                for row in rows:
                    connection.execute(
                        text(f"UPDATE {table_name} SET uuid = :uuid WHERE id = :id"),
                        {"uuid": str(uuid.uuid4()), "id": row.id},
                    )
            print(f"✅ Missing database column added: {table_name}.uuid")

    doc_share_repaired = []
    for column in (
        Column("public_id", _String(64), nullable=True),
        Column("share_scope", _String(20), nullable=True),
        Column("share_expires_at", DateTime(timezone=True), nullable=True),
        Column("view_count", Integer(), nullable=True),
        Column("last_viewed_at", DateTime(timezone=True), nullable=True),
    ):
        if _add_column_if_missing("docs", column):
            doc_share_repaired.append(column.name)
    if doc_share_repaired:
        with engine.begin() as connection:
            if "share_scope" in doc_share_repaired:
                connection.execute(text("UPDATE docs SET share_scope = 'private' WHERE share_scope IS NULL"))
            if "view_count" in doc_share_repaired:
                connection.execute(text("UPDATE docs SET view_count = 0 WHERE view_count IS NULL"))
        print(f"✅ Missing database columns added: docs.{', '.join(doc_share_repaired)}")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _stamp_alembic_head_if_unmanaged() -> None:
    """Stamp alembic_version to head when the schema was bootstrapped by
    create_all rather than by migrations (i.e. no migration history yet).

    Without this, a fresh create_all leaves alembic_version empty, so a later
    `alembic upgrade head` would replay every migration against an already
    complete schema. Best-effort: never block startup if alembic isn't usable.
    """
    try:
        from pathlib import Path
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        backend_dir = Path(__file__).resolve().parent.parent
        cfg = Config(str(backend_dir / "alembic.ini"))
        cfg.set_main_option("script_location", str(backend_dir / "alembic"))
        head = ScriptDirectory.from_config(cfg).get_current_head()
        if not head:
            return

        with engine.begin() as connection:
            if not inspect(connection).has_table("alembic_version"):
                connection.execute(
                    text(
                        "CREATE TABLE alembic_version ("
                        "version_num VARCHAR(255) NOT NULL, "
                        "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
                    )
                )
            already = connection.execute(text("SELECT version_num FROM alembic_version")).first()
            if already is None:
                connection.execute(
                    text("INSERT INTO alembic_version (version_num) VALUES (:rev)"),
                    {"rev": head},
                )
    except Exception as exc:  # pragma: no cover - defensive
        print(f"⚠️  Could not stamp alembic_version to head: {exc}")


def init_db():
    """Create or repair the database schema. Safe to run on every startup."""
    # Provision the database itself for server backends (no-op for SQLite).
    ensure_database_exists(settings.database_url)

    # Import all models to ensure they're registered with Base.metadata
    from . import models
    from . import models_versioning

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    expected_tables = set(Base.metadata.tables.keys())
    missing_tables = expected_tables - existing_tables

    # Always call create_all: it is idempotent (checkfirst skips existing
    # tables) and is the authoritative safety net. This self-heals a database
    # that has an alembic_version row but is missing tables — a state where
    # `alembic upgrade head` is a silent no-op (partially restored DB, a stamp
    # without a real upgrade, etc.) and the app would otherwise crash with
    # "table doesn't exist".
    Base.metadata.create_all(bind=engine)
    if missing_tables:
        if existing_tables - {"alembic_version"}:
            print(f"✅ Missing database tables created: {', '.join(sorted(missing_tables))}")
        else:
            print("✅ Database tables created successfully")
        # We just materialized the schema outside of Alembic — record it as head
        # so migrations stay coherent.
        _stamp_alembic_head_if_unmanaged()

    _repair_known_schema_drift()
