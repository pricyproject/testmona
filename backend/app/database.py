import logging

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import settings

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
logger = logging.getLogger(__name__)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _drop_legacy_custom_field_entity_type_column() -> None:
    """Repair older SQLite databases that still have a removed NOT NULL column."""
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    if "custom_field_definitions" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("custom_field_definitions")}
    if "entity_type" not in columns:
        return

    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE custom_field_definitions DROP COLUMN entity_type"))

    logger.info("Dropped obsolete custom_field_definitions.entity_type column")


def _ensure_runtime_tables() -> None:
    """Create tables added after legacy databases were first initialized."""
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    from . import models

    if "import_operations" not in table_names:
        models.ImportOperation.__table__.create(bind=engine)
        logger.info("Created missing import_operations table")


def init_db():
    """Initialize database tables if they don't exist and repair legacy schema drift."""
    # Import all models to ensure they're registered with Base.metadata
    from . import models
    
    inspector = inspect(engine)
    if not inspector.get_table_names():
        Base.metadata.create_all(bind=engine)
        print("✅ Database tables created successfully")

    _drop_legacy_custom_field_entity_type_column()
    _ensure_runtime_tables()
