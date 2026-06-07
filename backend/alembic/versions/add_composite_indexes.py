"""Add composite and partial indexes for common query patterns

Revision ID: add_composite_indexes
Revises: add_project_scoped_definitions
Create Date: 2026-06-07 12:00:00.000000

Adds composite indexes to optimize common query patterns:
- test_results(test_run_id, status) - for filtering results by run and status
- test_results(test_case_id, executed_at) - for test case execution history
- requirements(project_id, status, priority) - for requirement filtering
- defects(project_id, status, severity) - for defect triage
- audit_trails(user_id, created_at) - for user activity queries
- doc_visits(user_id, last_visited_at) - for recent docs sorting

Adds partial indexes (PostgreSQL/SQLite only) for better performance:
- test_results(status) WHERE status != 'not_started' - exclude unexecuted results
- defects(status) WHERE status != 'closed' - active defects only
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

from app.services.migration_helpers import table_exists, index_exists


revision = "add_composite_indexes"
down_revision = "add_project_scoped_definitions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)

    # test_results(test_run_id, status) - for filtering results by run and status
    if table_exists(connection, "test_results"):
        if not index_exists(connection, "test_results", "ix_test_results_test_run_id_status"):
            if connection.dialect.name == "postgresql":
                op.execute("CREATE INDEX CONCURRENTLY ix_test_results_test_run_id_status ON test_results (test_run_id, status)")
            else:
                op.create_index(
                    "ix_test_results_test_run_id_status",
                    "test_results",
                    ["test_run_id", "status"]
                )
        
        if not index_exists(connection, "test_results", "ix_test_results_test_case_id_executed_at"):
            if connection.dialect.name == "postgresql":
                op.execute("CREATE INDEX CONCURRENTLY ix_test_results_test_case_id_executed_at ON test_results (test_case_id, executed_at)")
            else:
                op.create_index(
                    "ix_test_results_test_case_id_executed_at",
                    "test_results",
                    ["test_case_id", "executed_at"]
                )

    # requirements(project_id, status, priority) - for requirement filtering
    if table_exists(connection, "requirements"):
        if not index_exists(connection, "requirements", "ix_requirements_project_id_status_priority"):
            if connection.dialect.name == "postgresql":
                op.execute("CREATE INDEX CONCURRENTLY ix_requirements_project_id_status_priority ON requirements (project_id, status, priority)")
            else:
                op.create_index(
                    "ix_requirements_project_id_status_priority",
                    "requirements",
                    ["project_id", "status", "priority"]
                )

    # defects(project_id, status, severity) - for defect triage
    if table_exists(connection, "defects"):
        if not index_exists(connection, "defects", "ix_defects_project_id_status_severity"):
            if connection.dialect.name == "postgresql":
                op.execute("CREATE INDEX CONCURRENTLY ix_defects_project_id_status_severity ON defects (project_id, status, severity)")
            else:
                op.create_index(
                    "ix_defects_project_id_status_severity",
                    "defects",
                    ["project_id", "status", "severity"]
                )

    # audit_trails(user_id, created_at) - for user activity queries
    if table_exists(connection, "audit_trails"):
        if not index_exists(connection, "audit_trails", "ix_audit_trails_user_id_created_at"):
            if connection.dialect.name == "postgresql":
                op.execute("CREATE INDEX CONCURRENTLY ix_audit_trails_user_id_created_at ON audit_trails (user_id, created_at)")
            else:
                op.create_index(
                    "ix_audit_trails_user_id_created_at",
                    "audit_trails",
                    ["user_id", "created_at"]
                )

    # doc_visits(user_id, last_visited_at) - for recent docs sorting
    if table_exists(connection, "doc_visits"):
        if not index_exists(connection, "doc_visits", "ix_doc_visits_user_id_last_visited_at"):
            # Use CONCURRENTLY for PostgreSQL to avoid table locking on large tables
            if connection.dialect.name == "postgresql":
                op.execute("CREATE INDEX CONCURRENTLY ix_doc_visits_user_id_last_visited_at ON doc_visits (user_id, last_visited_at)")
            else:
                op.create_index(
                    "ix_doc_visits_user_id_last_visited_at",
                    "doc_visits",
                    ["user_id", "last_visited_at"]
                )

    # Partial indexes for better performance on large tables
    # test_results(status) WHERE status != 'not_started' - exclude unexecuted results
    if table_exists(connection, "test_results"):
        if not index_exists(connection, "test_results", "ix_test_results_status_active"):
            if connection.dialect.name == "postgresql":
                op.execute("CREATE INDEX CONCURRENTLY ix_test_results_status_active ON test_results (status) WHERE status != 'not_started'")
            elif connection.dialect.name == "sqlite":
                op.execute("CREATE INDEX ix_test_results_status_active ON test_results (status) WHERE status != 'not_started'")
            # MySQL doesn't support partial indexes until very recent versions, skip for compatibility

    # defects(status) WHERE status != 'closed' - active defects only
    if table_exists(connection, "defects"):
        if not index_exists(connection, "defects", "ix_defects_status_active"):
            if connection.dialect.name == "postgresql":
                op.execute("CREATE INDEX CONCURRENTLY ix_defects_status_active ON defects (status) WHERE status != 'closed'")
            elif connection.dialect.name == "sqlite":
                op.execute("CREATE INDEX ix_defects_status_active ON defects (status) WHERE status != 'closed'")
            # MySQL doesn't support partial indexes until very recent versions, skip for compatibility


def downgrade() -> None:
    connection = op.get_bind()

    # Drop composite indexes (with error handling for FK constraints)
    if table_exists(connection, "test_results"):
        try:
            if index_exists(connection, "test_results", "ix_test_results_test_run_id_status"):
                op.drop_index("ix_test_results_test_run_id_status", "test_results")
        except Exception:
            pass  # Index may be required by FK constraint
        try:
            if index_exists(connection, "test_results", "ix_test_results_test_case_id_executed_at"):
                op.drop_index("ix_test_results_test_case_id_executed_at", "test_results")
        except Exception:
            pass
        try:
            if index_exists(connection, "test_results", "ix_test_results_status_active"):
                op.drop_index("ix_test_results_status_active", "test_results")
        except Exception:
            pass

    if table_exists(connection, "requirements"):
        try:
            if index_exists(connection, "requirements", "ix_requirements_project_id_status_priority"):
                op.drop_index("ix_requirements_project_id_status_priority", "requirements")
        except Exception:
            pass

    if table_exists(connection, "defects"):
        try:
            if index_exists(connection, "defects", "ix_defects_project_id_status_severity"):
                op.drop_index("ix_defects_project_id_status_severity", "defects")
        except Exception:
            pass
        try:
            if index_exists(connection, "defects", "ix_defects_status_active"):
                op.drop_index("ix_defects_status_active", "defects")
        except Exception:
            pass

    if table_exists(connection, "audit_trails"):
        try:
            if index_exists(connection, "audit_trails", "ix_audit_trails_user_id_created_at"):
                op.drop_index("ix_audit_trails_user_id_created_at", "audit_trails")
        except Exception:
            pass

    if table_exists(connection, "doc_visits"):
        try:
            if index_exists(connection, "doc_visits", "ix_doc_visits_user_id_last_visited_at"):
                op.drop_index("ix_doc_visits_user_id_last_visited_at", "doc_visits")
        except Exception:
            pass
