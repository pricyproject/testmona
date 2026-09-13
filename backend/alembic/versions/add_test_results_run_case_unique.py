"""Enforce one result row per (run, case) and merge legacy duplicates

Revision ID: add_test_results_run_case_unique
Revises: add_catalog_seq_unique_indexes
Create Date: 2026-09-13 00:00:00.000000

Double-added cases (double-click, retried requests, concurrent CI pushes) used
to create several ``test_results`` rows for the same (run, case), inflating run
totals and analytics. The application layer is idempotent now; this migration
merges pre-existing duplicates (survivor: latest execution, children
re-pointed) and adds the unique backstop.
"""
from alembic import op
from sqlalchemy import inspect, text

from app.services.migration_helpers import table_exists


revision = "add_test_results_run_case_unique"
down_revision = "add_catalog_seq_unique_indexes"
branch_labels = None
depends_on = None

CONSTRAINT_NAME = "uq_test_results_run_case"


def _has_constraint(connection) -> bool:
    if "test_results" not in inspect(connection).get_table_names():
        return False
    for unique in inspect(connection).get_unique_constraints("test_results"):
        if unique.get("name") == CONSTRAINT_NAME:
            return True
        if set(unique.get("column_names") or []) == {"test_run_id", "test_case_id"}:
            return True
    return False


def _merge_duplicates(connection) -> None:
    dup_groups = connection.execute(text(
        "SELECT test_run_id, test_case_id FROM test_results "
        "GROUP BY test_run_id, test_case_id HAVING COUNT(*) > 1"
    )).all()
    tables = set(inspect(connection).get_table_names())
    for run_id, case_id in dup_groups:
        rows = connection.execute(text(
            "SELECT id, executed_at FROM test_results "
            "WHERE test_run_id = :run AND test_case_id = :case "
            "ORDER BY CASE WHEN executed_at IS NULL THEN 1 ELSE 0 END, executed_at DESC, id DESC"
        ), {"run": run_id, "case": case_id}).all()
        survivor = rows[0][0]
        losers = [row[0] for row in rows[1:]]
        if not losers:
            continue
        for table, column in (
            ("test_step_results", "test_result_id"),
            ("execution_logs", "test_result_id"),
        ):
            if table in tables:
                connection.execute(text(
                    f"UPDATE {table} SET {column} = :keep "
                    f"WHERE {column} IN ({', '.join(str(i) for i in losers)})"
                ), {"keep": survivor})
        if "test_result_defect_links" in tables:
            for loser in losers:
                link_defects = connection.execute(text(
                    "SELECT defect_id FROM test_result_defect_links WHERE test_result_id = :loser"
                ), {"loser": loser}).all()
                for (defect_id,) in link_defects:
                    already = connection.execute(text(
                        "SELECT id FROM test_result_defect_links "
                        "WHERE test_result_id = :keep AND defect_id = :defect"
                    ), {"keep": survivor, "defect": defect_id}).first()
                    if already is None:
                        connection.execute(text(
                            "UPDATE test_result_defect_links SET test_result_id = :keep "
                            "WHERE test_result_id = :loser AND defect_id = :defect"
                        ), {"keep": survivor, "loser": loser, "defect": defect_id})
                    else:
                        connection.execute(text(
                            "DELETE FROM test_result_defect_links "
                            "WHERE test_result_id = :loser AND defect_id = :defect"
                        ), {"loser": loser, "defect": defect_id})
        connection.execute(text(
            f"DELETE FROM test_results WHERE id IN ({', '.join(str(i) for i in losers)})"
        ))


def upgrade() -> None:
    connection = op.get_bind()
    if not table_exists(connection, "test_results"):
        return
    _merge_duplicates(connection)
    if _has_constraint(connection):
        return
    with op.batch_alter_table("test_results") as batch_op:
        batch_op.create_unique_constraint(CONSTRAINT_NAME, ["test_run_id", "test_case_id"])


def downgrade() -> None:
    connection = op.get_bind()
    if not _has_constraint(connection):
        return
    with op.batch_alter_table("test_results") as batch_op:
        batch_op.drop_constraint(CONSTRAINT_NAME, type_="unique")
