#!/usr/bin/env python3
"""
Production migration script for TestMona application.
This script handles database migrations for production environments.
"""

import os
import sys
import argparse
import shutil
import logging
import signal
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from alembic.config import Config
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.engine import make_url
from app.config import settings
from app.services.migration_helpers import compare_server_default, include_migration_object

BASE_DIR = Path(__file__).resolve().parent


# Setup logging
def setup_logging():
    """Setup logging to both file and console"""
    handlers = [logging.StreamHandler(sys.stdout)]

    log_dir = BASE_DIR / "logs"
    try:
        log_dir.mkdir(exist_ok=True)
        log_file = log_dir / f"migration_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
        handlers.insert(0, logging.FileHandler(log_file))
    except OSError:
        print("Migration file logging is disabled because the logs directory is not writable.", file=sys.stderr)

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=handlers
    )
    return logging.getLogger(__name__)

logger = setup_logging()
logger.setLevel(logging.INFO)

MIGRATION_FILE_PATTERN = re.compile(r"^\d{14}_[a-z0-9_]+\.py$")
LEGACY_REVISION_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
DESTRUCTIVE_PATTERNS = (
    ("drop_table", re.compile(r"\bop\.drop_table\(")),
    ("drop_column", re.compile(r"\b(?:op|batch_op)\.drop_column\(")),
    ("delete_data", re.compile(r"\b(?:DELETE|TRUNCATE)\b", re.IGNORECASE)),
)
REQUIRED_COLUMN_PATTERN = re.compile(
    r"add_column\([^\n]+nullable\s*=\s*False(?![^\n]+server_default)",
    re.DOTALL,
)

def validate_env_vars(env):
    """Validate required environment variables are set"""
    if env == 'prod':
        if not os.getenv('DATABASE_URL'):
            logger.warning("DATABASE_URL not set; using configured default SQLite database")
    return True


def normalize_database_url(db_url):
    """Resolve relative SQLite paths from the backend directory."""
    url = make_url(db_url)
    if not url.drivername.startswith("sqlite"):
        return db_url

    database = url.database
    if not database or database == ":memory:" or Path(database).is_absolute():
        return db_url

    return url.set(database=str(BASE_DIR / database)).render_as_string(hide_password=False)


def safe_database_url(db_url):
    """Render a database URL without exposing credentials in logs."""
    return make_url(db_url).render_as_string(hide_password=True)


def build_alembic_config(db_url):
    """Build Alembic config with paths that work from any current directory."""
    alembic_cfg = Config(str(BASE_DIR / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(BASE_DIR / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", db_url)
    alembic_cfg.attributes["database_url"] = db_url
    return alembic_cfg


def run_alembic_command(command_func, *args, **kwargs):
    """Run an Alembic command without letting successful SystemExit skip cleanup."""
    try:
        return command_func(*args, **kwargs)
    except SystemExit as exc:
        if exc.code in (0, None):
            return None
        raise


def build_revision_id(message: str) -> str:
    """Build sortable revision IDs with a compact timestamp and slug."""
    slug = re.sub(r"[^a-z0-9]+", "_", message.lower()).strip("_") or "migration"
    slug = re.sub(r"_+", "_", slug)[:40].strip("_") or "migration"
    return f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{slug}"


def check_single_head(alembic_cfg: Config) -> bool:
    """Return True when the migration graph has exactly one head."""
    script = ScriptDirectory.from_config(alembic_cfg)
    heads = script.get_heads()
    if len(heads) == 1:
        logger.info(f"✅ Single migration head: {heads[0]}")
        return True

    if not heads:
        logger.error("❌ No migration heads found")
    else:
        logger.error(f"❌ Multiple migration heads found: {', '.join(heads)}")
    return False


def format_schema_diff(diff: object) -> str:
    """Render Alembic schema diff entries in a compact log-friendly form."""
    text_value = repr(diff)
    return text_value if len(text_value) <= 500 else f"{text_value[:497]}..."


def _unique_index_signature(diff: object) -> tuple[str, tuple[str, ...]] | None:
    if not isinstance(diff, tuple) or len(diff) < 2 or diff[0] != "remove_index":
        return None

    index = diff[1]
    if not getattr(index, "unique", False):
        return None

    table = getattr(index, "table", None)
    table_name = getattr(table, "name", None)
    columns = tuple(column.name for column in getattr(index, "columns", []))
    if not table_name or not columns:
        return None
    return table_name, columns


def _unique_constraint_signature(diff: object) -> tuple[str, tuple[str, ...]] | None:
    if not isinstance(diff, tuple) or len(diff) < 2 or diff[0] != "add_constraint":
        return None

    constraint = diff[1]
    table = getattr(constraint, "table", None)
    table_name = getattr(table, "name", None)
    columns = tuple(column.name for column in getattr(constraint, "columns", []))
    if not table_name or not columns:
        return None
    return table_name, columns


def filter_schema_differences(differences: list[object]) -> list[object]:
    """Drop dialect naming artifacts while preserving material schema drift."""
    removed_unique_indexes = {
        signature for difference in differences if (signature := _unique_index_signature(difference))
    }
    added_unique_constraints = {
        signature for difference in differences if (signature := _unique_constraint_signature(difference))
    }
    equivalent_unique_signatures = removed_unique_indexes & added_unique_constraints

    filtered: list[object] = []
    for difference in differences:
        unique_index_signature = _unique_index_signature(difference)
        if unique_index_signature in equivalent_unique_signatures:
            continue

        unique_constraint_signature = _unique_constraint_signature(difference)
        if unique_constraint_signature in equivalent_unique_signatures:
            continue

        filtered.append(difference)

    return filtered


def check_schema_drift(db_url: str, alembic_cfg: Config) -> bool:
    """Compare live database schema with SQLAlchemy metadata."""
    logger.info("🔍 Checking schema drift...")
    engine = None
    autogenerate_logger = logging.getLogger("alembic.autogenerate.compare")
    runtime_logger = logging.getLogger("alembic.runtime.migration")
    previous_autogenerate_level = autogenerate_logger.level
    previous_runtime_level = runtime_logger.level
    try:
        from app.database import Base
        from app import models, models_versioning  # noqa: F401 (register metadata)

        engine = create_engine(db_url)
        with engine.connect() as connection:
            runtime_logger.setLevel(logging.WARNING)
            expected_heads = set(ScriptDirectory.from_config(alembic_cfg).get_heads())
            current_heads = set(MigrationContext.configure(connection).get_current_heads())
            if current_heads != expected_heads:
                logger.error(
                    "❌ Database revision is not at migration head; "
                    f"current={sorted(current_heads) or ['<unversioned>']} "
                    f"expected={sorted(expected_heads)}"
                )
                return False

            migration_context = MigrationContext.configure(
                connection,
                opts={
                    "target_metadata": Base.metadata,
                    "include_object": include_migration_object,
                    "compare_type": True,
                    "compare_server_default": compare_server_default,
                },
            )
            # Alembic logs raw dialect artifacts before callers can filter them;
            # keep check-drift output focused on material differences only.
            autogenerate_logger.setLevel(logging.WARNING)
            differences = filter_schema_differences(compare_metadata(migration_context, Base.metadata))

        if differences:
            logger.error(f"❌ Schema drift detected: {len(differences)} difference(s)")
            for difference in differences[:25]:
                logger.error(f"  - {format_schema_diff(difference)}")
            if len(differences) > 25:
                logger.error(f"  - ... {len(differences) - 25} more difference(s)")
            return False

        logger.info("✅ No schema drift detected")
        return True
    except Exception as e:
        logger.error(f"❌ Schema drift check failed: {e}")
        return False
    finally:
        autogenerate_logger.setLevel(previous_autogenerate_level)
        runtime_logger.setLevel(previous_runtime_level)
        if engine is not None:
            engine.dispose()


def lint_migration_files(alembic_cfg: Config) -> bool:
    """Run lightweight safety checks over migration scripts."""
    script = ScriptDirectory.from_config(alembic_cfg)
    version_dir = Path(script.versions)
    revisions_by_path = {Path(revision.path).resolve(): revision.revision for revision in script.walk_revisions()}
    ok = True
    legacy_count = 0

    for migration_path in sorted(version_dir.glob("*.py")):
        if migration_path.name == "__init__.py":
            continue

        contents = migration_path.read_text(encoding="utf-8")
        relative_path = migration_path.relative_to(BASE_DIR)
        revision_id = revisions_by_path.get(migration_path.resolve(), migration_path.stem)
        is_standard_revision = MIGRATION_FILE_PATTERN.match(f"{revision_id}.py") is not None
        is_legacy_revision = LEGACY_REVISION_ID_PATTERN.match(revision_id) is not None

        if not is_standard_revision:
            if is_legacy_revision:
                legacy_count += 1
            else:
                logger.error(f"❌ Non-standard migration revision ID: {revision_id} ({relative_path})")
                ok = False

        if "def downgrade()" not in contents:
            logger.error(f"❌ Missing downgrade function: {relative_path}")
            ok = False

        if re.search(r"def downgrade\(\) -> None:\s+pass\b", contents) and is_standard_revision:
            logger.error(f"❌ Empty downgrade function: {relative_path}")
            ok = False

        if REQUIRED_COLUMN_PATTERN.search(contents) and is_standard_revision:
            logger.error(
                f"❌ Required column added without an inline server_default; "
                f"prefer nullable-first rollout: {relative_path}"
            )
            ok = False

        if is_standard_revision:
            for label, pattern in DESTRUCTIVE_PATTERNS:
                if pattern.search(contents) and "migration-reviewed-destructive-operation" not in contents:
                    logger.error(
                        f"❌ Destructive operation ({label}) requires "
                        f"migration-reviewed-destructive-operation marker: {relative_path}"
                    )
                    ok = False

    if ok:
        if legacy_count:
            logger.info(f"ℹ️  Legacy migrations accepted without retroactive lint: {legacy_count}")
        logger.info("✅ Migration lint completed")
    return ok


def warn_production_backup(args, db_url: str) -> None:
    """Warn when production server-database migrations rely on external backups."""
    if args.env != "prod" or args.action not in {"upgrade", "downgrade"} or getattr(args, "dry_run", False):
        return

    if make_url(db_url).drivername.startswith("sqlite"):
        return

    logger.warning(
        "⚠️  Production server database detected. Confirm an external backup "
        "or snapshot exists before applying migrations."
    )

def check_database_connection(db_url):
    """Check if database is accessible"""
    engine = None
    try:
        engine = create_engine(db_url)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("✅ Database connection successful")
        return True
    except SQLAlchemyError as e:
        logger.error(f"❌ Database connection failed: {e}")
        return False
    finally:
        if engine is not None:
            engine.dispose()

def backup_sqlite_database(db_url):
    """Create backup of SQLite database before migration"""
    url = make_url(db_url)
    if not url.drivername.startswith('sqlite'):
        logger.info("Skipping backup (not SQLite)")
        return None

    db_path = url.database
    if not db_path or db_path == ":memory:":
        logger.info("Skipping backup (SQLite in-memory database)")
        return None

    if not os.path.exists(db_path):
        logger.warning(f"Database file not found: {db_path}")
        return None
    
    # Create backup
    backup_dir = BASE_DIR / "backups"
    backup_dir.mkdir(exist_ok=True)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = backup_dir / f"{Path(db_path).stem}_{timestamp}.db"
    
    try:
        shutil.copy2(db_path, backup_path)
        logger.info(f"✅ Database backed up to: {backup_path}")
        return str(backup_path)
    except Exception as e:
        logger.error(f"❌ Backup failed: {e}")
        return None

def check_sqlite_limitations(db_url, action, dry_run=False):
    """Check for SQLite-specific limitations"""
    if not make_url(db_url).drivername.startswith('sqlite'):
        return True

    if action not in {"upgrade", "downgrade"} or dry_run:
        return True
    
    logger.info("Checking SQLite limitations...")
    # SQLite limitations are handled by Alembic, but we log awareness
    logger.info("⚠️  SQLite has limited ALTER TABLE support")
    logger.info("⚠️  Some schema changes may require manual intervention")
    return True

def timeout_handler(signum, frame):
    """Handle timeout for long-running migrations"""
    logger.error("❌ Migration timeout reached")
    sys.exit(1)

def verify_schema(db_url):
    """Verify database schema after migration"""
    logger.info("🔍 Verifying database schema...")
    
    engine = None
    try:
        from app.database import Base
        from app import models, models_versioning

        engine = create_engine(db_url)
        with engine.connect() as conn:
            inspector = inspect(conn)
            tables = set(inspector.get_table_names())
            expected_tables = set(Base.metadata.tables.keys()) | {'alembic_version'}
            
            # Check for missing tables
            missing_tables = [t for t in expected_tables if t not in tables]
            if missing_tables:
                logger.error(f"❌ Missing tables: {sorted(missing_tables)}")
                return False
            else:
                logger.info("✅ All expected tables present")

            for table_name, table in Base.metadata.tables.items():
                actual_columns = {column["name"] for column in inspector.get_columns(table_name)}
                expected_columns = {column.name for column in table.columns}
                missing_columns = sorted(expected_columns - actual_columns)
                if missing_columns:
                    logger.error(f"❌ Missing columns in {table_name}: {missing_columns}")
                    return False

            if "custom_field_definitions" in tables:
                custom_field_columns = {
                    column["name"] for column in inspector.get_columns("custom_field_definitions")
                }
                if "entity_type" in custom_field_columns:
                    logger.error("❌ Obsolete custom_field_definitions.entity_type column is still present")
                    return False
            
            # Check alembic_version table exists (indicates migrations are tracked)
            if 'alembic_version' in tables:
                result = conn.execute(text("SELECT version_num FROM alembic_version"))
                version = result.fetchone()
                if version:
                    logger.info(f"✅ Current migration version: {version[0]}")
                else:
                    logger.warning("⚠️  alembic_version table is empty")
            else:
                logger.warning("⚠️  alembic_version table not found - migrations may not be tracked")
            
            # Check for critical columns in users table
            if 'users' in tables:
                columns = [column["name"] for column in inspector.get_columns("users")]
                critical_user_columns = ['id', 'username', 'email', 'hashed_password', 'role']
                missing_user_columns = [c for c in critical_user_columns if c not in columns]
                if missing_user_columns:
                    logger.error(f"❌ Missing critical columns in users table: {missing_user_columns}")
                    return False
                else:
                    logger.info("✅ Users table structure verified")
            
            logger.info("✅ Schema verification completed")
            return True
            
    except Exception as e:
        logger.error(f"❌ Schema verification failed: {e}")
        return False
    finally:
        if engine is not None:
            engine.dispose()

def backfill_missing_tables(db_url):
    """Create any tables that migrations didn't produce.

    `alembic upgrade head` is a no-op when the database is already stamped at
    head, even if tables are missing (partially-restored DB, a bare stamp, etc.).
    create_all is idempotent, so this is a safe net that guarantees the app
    never starts against an incomplete schema.
    """
    engine = None
    try:
        from app.database import Base
        from app import models, models_versioning  # noqa: F401 (register metadata)

        engine = create_engine(db_url)
        before = set(inspect(engine).get_table_names())
        Base.metadata.create_all(bind=engine)
        created = sorted(set(inspect(engine).get_table_names()) - before)
        if created:
            logger.warning(f"🩹 Backfilled tables missing after migration: {created}")
    except Exception as e:
        logger.error(f"❌ Failed to backfill missing tables: {e}")
        raise
    finally:
        if engine is not None:
            engine.dispose()


def main():
    parser = argparse.ArgumentParser(description='Database migration utility')
    parser.add_argument('--env', choices=['dev', 'prod', 'test'], default='dev',
                       help='Environment (dev, prod, test)')
    parser.add_argument('--url', help='Database URL (overrides environment)')
    subparsers = parser.add_subparsers(dest='action', help='Migration actions')
    
    # Upgrade command
    upgrade_parser = subparsers.add_parser('upgrade', help='Upgrade to latest migration')
    upgrade_parser.add_argument('--revision', help='Specific revision to upgrade to')
    upgrade_parser.add_argument('--dry-run', action='store_true', help='Preview changes without applying')
    upgrade_parser.add_argument('--no-backup', action='store_true', help='Skip database backup')
    upgrade_parser.add_argument('--no-backfill', action='store_true', help='Do not create missing metadata tables after upgrade')
    upgrade_parser.add_argument('--no-verify', action='store_true', help='Skip schema verification after migration')
    
    # Downgrade command
    downgrade_parser = subparsers.add_parser('downgrade', help='Downgrade to specific revision')
    downgrade_parser.add_argument('--revision', required=True, help='Revision to downgrade to')
    downgrade_parser.add_argument('--dry-run', action='store_true', help='Preview changes without applying')
    downgrade_parser.add_argument('--no-backup', action='store_true', help='Skip database backup')
    downgrade_parser.add_argument('--no-verify', action='store_true', help='Skip schema verification after migration')
    
    # Current command
    subparsers.add_parser('current', help='Show current revision')

    # Heads command
    subparsers.add_parser('heads', help='Show migration heads and fail on multiple heads')
    
    # History command
    history_parser = subparsers.add_parser('history', help='Show migration history')
    history_parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    
    # Revision command
    revision_parser = subparsers.add_parser('revision', help='Create new migration')
    revision_parser.add_argument('--message', '-m', required=True, help='Migration message')
    revision_parser.add_argument('--autogenerate', action='store_true', help='Autogenerate migration')
    revision_parser.add_argument('--rev-id', help='Explicit revision ID override')
    
    # Stamp command
    stamp_parser = subparsers.add_parser('stamp', help='Stamp database with specific revision')
    stamp_parser.add_argument('--revision', required=True, help='Revision to stamp')
    stamp_parser.add_argument('--purge', action='store_true', help='Purge all versions before stamping')
    
    # Show command
    show_parser = subparsers.add_parser('show', help='Show SQL for migration')
    show_parser.add_argument('--revision', required=True, help='Revision to show')

    # Drift command
    subparsers.add_parser('check-drift', help='Fail if models and database schema differ')

    # Lint command
    subparsers.add_parser('lint', help='Run migration graph and safety checks')

    # Preflight command
    subparsers.add_parser('preflight', help='Run connection, graph, lint, and drift checks')
    
    # Global timeout option
    parser.add_argument('--timeout', type=int, default=300, help='Timeout in seconds (default: 300)')
    
    args = parser.parse_args()
    
    if not args.action:
        parser.print_help()
        return
    
    # Validate environment variables
    if not validate_env_vars(args.env):
        logger.error("❌ Environment validation failed")
        sys.exit(1)
    
    # Override database URL based on environment or command line
    if args.url:
        db_url = args.url
    elif args.env == 'prod':
        # In production, use environment variable or default to SQLite
        db_url = os.getenv('DATABASE_URL', settings.database_url)
    elif args.env == 'test':
        db_url = os.getenv('TEST_DATABASE_URL', settings.test_database_url)
    else:
        # Dev environment
        db_url = os.getenv('DATABASE_URL', settings.database_url)

    db_url = normalize_database_url(db_url)
    alembic_cfg = build_alembic_config(db_url)
    
    logger.info(f"Using database: {safe_database_url(db_url)}")
    warn_production_backup(args, db_url)
    
    # Check SQLite limitations
    if not check_sqlite_limitations(db_url, args.action, getattr(args, 'dry_run', False)):
        logger.error("❌ SQLite limitations check failed")
        sys.exit(1)
    
    # Set timeout handler
    timeout_enabled = hasattr(signal, "SIGALRM")
    if timeout_enabled:
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(args.timeout)
    else:
        logger.warning("Migration timeout is not supported on this platform")
    
    # For live upgrade/downgrade, check connection and create backup
    if args.action in ['upgrade', 'downgrade'] and not getattr(args, 'dry_run', False):
        if not check_database_connection(db_url):
            logger.error("❌ Cannot proceed without database connection")
            sys.exit(1)
        
        # Create backup unless skipped
        if not getattr(args, 'no_backup', False):
            backup_path = backup_sqlite_database(db_url)
            if backup_path:
                logger.info(f"Backup created at: {backup_path}")
    
    try:
        started_at = time.perf_counter()
        if args.action == 'upgrade':
            if not check_single_head(alembic_cfg):
                sys.exit(1)
            if getattr(args, 'dry_run', False):
                logger.info("🔍 Dry-run mode: previewing upgrade")
                run_alembic_command(command.upgrade, alembic_cfg, args.revision if args.revision else "head", sql=True)
            else:
                if args.revision:
                    run_alembic_command(command.upgrade, alembic_cfg, args.revision)
                else:
                    run_alembic_command(command.upgrade, alembic_cfg, "head")
                logger.info("✅ Database upgraded successfully")

                if not getattr(args, 'no_backfill', False):
                    # Safety net for the stamped-but-incomplete state, where the
                    # upgrade above is a no-op yet tables are missing.
                    backfill_missing_tables(db_url)

                # Verify schema after upgrade unless skipped
                if not getattr(args, 'no_verify', False):
                    if not verify_schema(db_url):
                        logger.error("❌ Schema verification failed after upgrade")
                        sys.exit(1)
            
        elif args.action == 'downgrade':
            if not check_single_head(alembic_cfg):
                sys.exit(1)
            if getattr(args, 'dry_run', False):
                logger.info("🔍 Dry-run mode: previewing downgrade")
                run_alembic_command(command.downgrade, alembic_cfg, args.revision, sql=True)
            else:
                run_alembic_command(command.downgrade, alembic_cfg, args.revision)
                logger.info(f"✅ Database downgraded to {args.revision}")
                
                # Verify schema after downgrade unless skipped
                if not getattr(args, 'no_verify', False):
                    if not verify_schema(db_url):
                        logger.error("❌ Schema verification failed after downgrade")
                        sys.exit(1)
            
        elif args.action == 'current':
            run_alembic_command(command.current, alembic_cfg)

        elif args.action == 'heads':
            run_alembic_command(command.heads, alembic_cfg)
            if not check_single_head(alembic_cfg):
                sys.exit(1)
            
        elif args.action == 'history':
            if args.verbose:
                run_alembic_command(command.history, alembic_cfg, verbose=True)
            else:
                run_alembic_command(command.history, alembic_cfg)
                
        elif args.action == 'revision':
            if not check_single_head(alembic_cfg):
                sys.exit(1)
            revision_id = args.rev_id or build_revision_id(args.message)
            run_alembic_command(
                command.revision,
                alembic_cfg,
                message=args.message,
                autogenerate=args.autogenerate,
                rev_id=revision_id,
            )
            logger.info(f"✅ New migration created: {revision_id} {args.message}")
            
        elif args.action == 'stamp':
            if getattr(args, 'purge', False):
                run_alembic_command(command.stamp, alembic_cfg, args.revision, purge=True)
            else:
                run_alembic_command(command.stamp, alembic_cfg, args.revision)
            logger.info(f"✅ Database stamped to revision: {args.revision}")
            
        elif args.action == 'show':
            logger.info(f"Showing SQL for revision: {args.revision}")
            run_alembic_command(command.upgrade, alembic_cfg, args.revision, sql=True)

        elif args.action == 'check-drift':
            if not check_schema_drift(db_url, alembic_cfg):
                sys.exit(1)

        elif args.action == 'lint':
            graph_ok = check_single_head(alembic_cfg)
            lint_ok = lint_migration_files(alembic_cfg)
            if not graph_ok or not lint_ok:
                sys.exit(1)

        elif args.action == 'preflight':
            checks = [
                check_database_connection(db_url),
                check_single_head(alembic_cfg),
                lint_migration_files(alembic_cfg),
                check_schema_drift(db_url, alembic_cfg),
            ]
            if not all(checks):
                sys.exit(1)
            logger.info("✅ Migration preflight completed")

        elapsed = time.perf_counter() - started_at
        logger.info(f"Migration action '{args.action}' completed in {elapsed:.2f}s")

    except Exception as e:
        logger.error(f"❌ Migration error: {str(e)}")
        sys.exit(1)
    finally:
        # Cancel timeout
        if timeout_enabled:
            signal.alarm(0)

if __name__ == "__main__":
    main()
