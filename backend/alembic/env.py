from logging.config import fileConfig
from sqlalchemy import engine_from_config
from sqlalchemy import pool
from alembic import context
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.database import Base
from app.models import *
from app.models_versioning import *
from app.config import settings

config = context.config

# Honor the same database configuration the app uses: an explicit DATABASE_URL
# environment variable wins, otherwise fall back to the app settings (which read
# the .env file). This keeps `alembic` and the running app pointed at the same DB.
database_url = os.getenv("DATABASE_URL") or settings.database_url
if database_url:
    config.set_main_option("sqlalchemy.url", database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Provision the target database for server backends before connecting
    # (no-op for SQLite). Mirrors the app's init_db() behavior.
    from app.database import ensure_database_exists
    ensure_database_exists(config.get_main_option("sqlalchemy.url"))

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    render_as_batch = connectable.dialect.name == "sqlite"

    with connectable.connect() as connection:
        # This project uses descriptive revision identifiers longer than 32
        # characters. Alembic's default alembic_version.version_num is
        # VARCHAR(32), which SQLite ignores but length-enforcing backends
        # (MySQL/MariaDB) reject. Pre-create the table with room to spare.
        if connection.dialect.name != "sqlite":
            from sqlalchemy import text
            connection.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS alembic_version ("
                    "version_num VARCHAR(255) NOT NULL, "
                    "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
                )
            )
            connection.commit()

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=render_as_batch,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
