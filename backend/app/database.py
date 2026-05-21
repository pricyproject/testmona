from sqlalchemy import create_engine, inspect
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import settings

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


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
