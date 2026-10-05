from collections.abc import Iterable
from typing import Any

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session
from sqlalchemy.sql.schema import Column, Table

from ..database import Base
from ..models import (
    CoverageReport,
    CustomFieldValue,
    Defect,
    ExecutionLog,
    JiraIssue,
    TestExecution,
    TestResult,
    TestResultDefectLink,
    TestRunEnvironment,
    TestStepResult,
)


def _single_primary_key_column(table: Table) -> Column | None:
    primary_key_columns = list(table.primary_key.columns)
    if len(primary_key_columns) != 1:
        return None
    return primary_key_columns[0]


def _collect_dependent_row_ids(
    db: Session,
    parent_table_name: str,
    parent_ids: Iterable[Any],
) -> dict[str, set[Any]]:
    """Every row reachable from ``parent_ids`` by foreign key, table by table."""
    row_ids_by_table: dict[str, set[Any]] = {parent_table_name: set(parent_ids)}
    tables = list(Base.metadata.sorted_tables)
    changed = True

    while changed:
        changed = False
        for table in tables:
            primary_key_column = _single_primary_key_column(table)
            if primary_key_column is None:
                continue

            table_ids = row_ids_by_table.setdefault(table.name, set())
            for foreign_key in table.foreign_keys:
                parent_ids = row_ids_by_table.get(foreign_key.column.table.name)
                if not parent_ids:
                    continue

                dependent_ids = set(
                    db.execute(
                        select(primary_key_column).where(foreign_key.parent.in_(parent_ids))
                    ).scalars()
                )
                new_ids = dependent_ids - table_ids
                if new_ids:
                    table_ids.update(new_ids)
                    changed = True

    return row_ids_by_table


def _dependent_delete_condition(table: Table, row_ids_by_table: dict[str, set[Any]]):
    conditions = []
    primary_key_column = _single_primary_key_column(table)
    table_ids = row_ids_by_table.get(table.name)
    if primary_key_column is not None and table_ids:
        conditions.append(primary_key_column.in_(table_ids))

    for foreign_key in table.foreign_keys:
        parent_ids = row_ids_by_table.get(foreign_key.column.table.name)
        if parent_ids:
            conditions.append(foreign_key.parent.in_(parent_ids))

    if not conditions:
        return None
    return or_(*conditions)


def _clear_self_references(
    db: Session,
    table: Table,
    row_ids_by_table: dict[str, set[Any]],
) -> None:
    primary_key_column = _single_primary_key_column(table)
    table_ids = row_ids_by_table.get(table.name)
    if primary_key_column is None or not table_ids:
        return

    for foreign_key in table.foreign_keys:
        if foreign_key.column.table is not table or not foreign_key.parent.nullable:
            continue
        db.execute(
            update(table)
            .where(
                primary_key_column.in_(table_ids),
                foreign_key.parent.in_(table_ids),
            )
            .values({foreign_key.parent: None})
        )


def delete_project_dependents(db: Session, project_id: int) -> None:
    row_ids_by_table = _collect_dependent_row_ids(db, "projects", [project_id])

    for table in reversed(Base.metadata.sorted_tables):
        if table.name == "projects":
            continue

        _clear_self_references(db, table, row_ids_by_table)
        condition = _dependent_delete_condition(table, row_ids_by_table)
        if condition is not None:
            db.execute(delete(table).where(condition))


def delete_rows_with_dependents(
    db: Session,
    parent_table_name: str,
    parent_ids: Iterable[Any],
    skip_table_names: Iterable[str] = (),
) -> None:
    """Hard-delete rows of ``parent_table_name`` along with everything hanging
    off them.

    Used where a soft-deleted parent still blocks a hard delete through a
    non-nullable child FK.
    """
    row_ids_by_table = _collect_dependent_row_ids(db, parent_table_name, parent_ids)
    skipped = set(skip_table_names)

    for table in reversed(Base.metadata.sorted_tables):
        if table.name in skipped:
            continue

        _clear_self_references(db, table, row_ids_by_table)
        condition = _dependent_delete_condition(table, row_ids_by_table)
        if condition is not None:
            db.execute(delete(table).where(condition))


def delete_test_run_dependents(db: Session, test_run_ids: Iterable[int]) -> None:
    run_ids = [test_run_id for test_run_id in test_run_ids if test_run_id is not None]
    if not run_ids:
        return

    result_ids = select(TestResult.id).where(TestResult.test_run_id.in_(run_ids))
    for model in (TestResultDefectLink, TestStepResult):
        db.query(model).filter(model.test_result_id.in_(result_ids)).delete(
            synchronize_session=False
        )

    db.query(JiraIssue).filter(JiraIssue.test_result_id.in_(result_ids)).update(
        {JiraIssue.test_result_id: None}, synchronize_session=False
    )

    for model in (ExecutionLog, TestExecution, TestRunEnvironment, TestResult):
        db.query(model).filter(model.test_run_id.in_(run_ids)).delete(
            synchronize_session=False
        )

    for model in (Defect, CoverageReport):
        db.query(model).filter(model.test_run_id.in_(run_ids)).update(
            {model.test_run_id: None}, synchronize_session=False
        )

    # Custom field values belong to the run: nulling the FK would leave an
    # ownerless row that no endpoint can list or resolve.
    db.query(CustomFieldValue).filter(CustomFieldValue.test_run_id.in_(run_ids)).delete(
        synchronize_session=False
    )
