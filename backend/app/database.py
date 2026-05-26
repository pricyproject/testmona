from sqlalchemy import DateTime, JSON, Column, create_engine, event, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import settings

engine = create_engine(settings.database_url)


if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):  # noqa: ARG001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Initialize or repair missing database tables."""
    # Import all models to ensure they're registered with Base.metadata
    from . import models
    from . import models_versioning
    
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    expected_tables = set(Base.metadata.tables.keys())
    missing_tables = expected_tables - existing_tables
    if missing_tables:
        Base.metadata.create_all(bind=engine)
        if existing_tables:
            print(f"✅ Missing database tables created: {', '.join(sorted(missing_tables))}")
        else:
            print("✅ Database tables created successfully")

    _repair_known_schema_drift()
