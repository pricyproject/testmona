from sqlalchemy import MetaData, create_engine, event, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.sql import operators
from sqlalchemy.sql.expression import UnaryExpression
from .config import settings


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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _build_alembic_config():
    """Alembic Config pointing at this backend's migrations and the app's database.

    Built without alembic.ini on purpose: the ini's only extra payload is a
    logging section, and loading it here would let env.py's fileConfig()
    reconfigure the running app's logging during startup.
    """
    from pathlib import Path
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parent.parent
    cfg = Config()
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    cfg.attributes["database_url"] = settings.database_url
    return cfg


def _unmanaged_schema_tables() -> list:
    """Application tables present in a database that has no Alembic revision.

    Empty list means the database is either fresh (no tables) or already under
    migration control — both states `alembic upgrade head` handles correctly.
    """
    with engine.connect() as connection:
        inspector = inspect(connection)
        tables = set(inspector.get_table_names())
        app_tables = tables - {"alembic_version"}
        if not app_tables:
            return []
        if "alembic_version" not in tables:
            return sorted(app_tables)
        stamped = connection.execute(text("SELECT version_num FROM alembic_version")).first()
        return [] if stamped is not None else sorted(app_tables)


def init_db():
    """Bring the database schema to the current Alembic head.

    Alembic is the single schema authority: a fresh database is built by the
    bootstrap migration and carried forward by the migration chain; an existing
    database gets pending migrations applied; a database already at head is a
    no-op. There is deliberately no create_all/stamp/raw-SQL fallback here — a
    failed or skipped migration must surface as a startup error to be fixed via
    ``migrate.py``, not be papered over at runtime.

    Safe to run on every startup. Raises on an unstamped non-empty database
    rather than guessing which revision its schema corresponds to.
    """
    from alembic import command

    # Provision the database itself for server backends (no-op for SQLite).
    ensure_database_exists(settings.database_url)

    # Import all models so Base.metadata is complete when the bootstrap
    # migration (which builds the schema from metadata) runs.
    from . import models  # noqa: F401
    from . import models_versioning  # noqa: F401

    unmanaged = _unmanaged_schema_tables()
    if unmanaged:
        raise RuntimeError(
            "Database contains application tables but no Alembic revision "
            f"(e.g. {', '.join(unmanaged[:5])}). Refusing to guess its schema "
            "state. If the schema is current, run "
            "'python migrate.py stamp --revision head'; otherwise restore the "
            "database (including alembic_version) from backup and run "
            "'python migrate.py upgrade'."
        )

    command.upgrade(_build_alembic_config(), "head")
