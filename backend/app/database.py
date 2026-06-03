from sqlalchemy import Boolean, DateTime, Integer, JSON, Column, create_engine, event, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import settings
import uuid

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
