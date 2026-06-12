"""Environment matrix runs.

A matrix run executes the same test-case selection across N execution
environments: one child TestRun per environment (each with its own results and
environment snapshot), grouped by a MatrixRun row so the API can pivot results
case x environment.
"""
from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import crud, schemas, rbac, models
from ..feature_guard import require_project_feature
from ..database import get_db
from ..auth import get_current_active_user
from ..models import TestCase, TestResult, TestRun
from .test_management_helpers import (
    _attach_test_run_progress,
    _validate_test_run_assignee,
    _validate_test_run_scope,
)
import logging

logger = logging.getLogger(__name__)


def _derive_matrix_status(child_runs: List[TestRun]) -> str:
    """completed when every environment finished; pending until anything ran."""
    statuses = {str(run.status or "").lower().replace("-", "_") for run in child_runs}
    if statuses and statuses <= {"completed"}:
        return "completed"
    executed = sum(getattr(run, "executed_tests", 0) or 0 for run in child_runs)
    if statuses <= {"pending"} and executed == 0:
        return "pending"
    return "in_progress"


def _serialize_matrix_run(db: Session, matrix_run: models.MatrixRun) -> schemas.MatrixRun:
    child_runs = sorted(matrix_run.test_runs, key=lambda run: run.id)
    _attach_test_run_progress(db, child_runs)

    columns = [
        schemas.MatrixRunEnvironmentColumn(
            test_run_id=run.id,
            test_run_seq=run.project_seq,
            environment_id=run.environment_id,
            environment_name=run.environment.name if run.environment else "—",
            status=run.status or "pending",
            total_tests=getattr(run, "total_tests", 0),
            executed_tests=getattr(run, "executed_tests", 0),
            passed_tests=getattr(run, "passed_tests", 0),
            failed_tests=getattr(run, "failed_tests", 0),
            blocked_tests=getattr(run, "blocked_tests", 0),
            skipped_tests=getattr(run, "skipped_tests", 0),
            not_started_tests=getattr(run, "not_started_tests", 0),
            progress_percent=getattr(run, "progress_percent", 0),
        )
        for run in child_runs
    ]
    total = sum(col.total_tests for col in columns)
    executed = sum(col.executed_tests for col in columns)
    return schemas.MatrixRun(
        id=matrix_run.id,
        project_id=matrix_run.project_id,
        project_seq=matrix_run.project_seq,
        name=matrix_run.name,
        description=matrix_run.description,
        created_by=matrix_run.created_by,
        created_at=matrix_run.created_at,
        updated_at=matrix_run.updated_at,
        status=_derive_matrix_status(child_runs),
        case_count=max((col.total_tests for col in columns), default=0),
        progress_percent=round((executed / total) * 100) if total else 0,
        environments=columns,
    )


def _build_pivot_rows(db: Session, run_ids: List[int]) -> List[schemas.MatrixRunRow]:
    """Rows = test cases, cells = latest result per (case, child run)."""
    if not run_ids:
        return []
    records = (
        db.query(
            TestResult.id,
            TestResult.test_run_id,
            TestResult.status,
            TestCase.id,
            TestCase.project_seq,
            TestCase.title,
            TestCase.priority,
            TestCase.order_index,
        )
        .join(TestCase, TestResult.test_case_id == TestCase.id)
        .filter(
            TestResult.test_run_id.in_(run_ids),
            (TestCase.is_deleted.is_(None)) | (TestCase.is_deleted.is_(False)),
        )
        # Ascending result id: later re-imports/re-executions overwrite the cell.
        .order_by(TestCase.order_index.asc(), TestCase.id.asc(), TestResult.id.asc())
        .all()
    )

    rows: dict[int, schemas.MatrixRunRow] = {}
    for result_id, run_id, status, case_id, case_seq, title, priority, _order in records:
        row = rows.get(case_id)
        if row is None:
            row = schemas.MatrixRunRow(
                test_case_id=case_id,
                test_case_seq=case_seq,
                title=title,
                priority=priority,
            )
            rows[case_id] = row
        row.results[str(run_id)] = schemas.MatrixRunCell(
            test_result_id=result_id,
            status=status or "not_started",
        )
    return list(rows.values())


def _snapshot_run_environment(db: Session, run: TestRun, environment: models.ExecutionEnvironment) -> None:
    """Same per-run environment snapshot the single-run create path records."""
    try:
        config_snapshot = {
            "name": environment.name,
            "description": environment.description,
            "environment_type": environment.environment_type,
        }
        if environment.config_data:
            config_snapshot["config_data"] = environment.config_data
        crud.create_test_run_environment(db=db, test_run_environment={
            "test_run_id": run.id,
            "environment_id": environment.id,
            "config_snapshot": config_snapshot,
            "build_snapshot": {
                "created_at": run.created_at.isoformat() if run.created_at else None,
                "test_run_name": run.name,
            },
        })
    except Exception as exc:
        logger.error(f"Failed to create matrix run environment snapshot: {exc}")


def _get_matrix_run_or_404(db: Session, matrix_run_id: int, current_user, permission: str) -> models.MatrixRun:
    matrix_run = db.query(models.MatrixRun).filter(models.MatrixRun.id == matrix_run_id).first()
    if matrix_run is None:
        raise HTTPException(status_code=404, detail="Matrix run not found")
    if not rbac.has_permission(current_user, permission, matrix_run.project_id, db):
        raise HTTPException(status_code=403, detail="Not authorized to access this matrix run")
    return matrix_run


def _audit_matrix_run(db: Session, current_user, matrix_run_id: int, project_id: int, action, description: str) -> None:
    try:
        from ..services.audit_service import get_audit_service
        from ..schemas_audit import AuditTrailCreate
        from ..models import EntityType
        get_audit_service(db).create_audit_trail(AuditTrailCreate(
            user_id=current_user.id if current_user else None,
            action=action.value,
            entity_type=EntityType.TEST_RUN.value,
            entity_id=matrix_run_id,
            project_id=project_id,
            description=description,
        ))
    except Exception as exc:
        logger.warning(f"Failed to create audit trail for matrix run: {exc}")


def register_matrix_run_routes(app):
    @app.post("/matrix-runs", response_model=schemas.MatrixRunDetail,
              dependencies=[Depends(require_project_feature("test_runs"))])
    def create_matrix_run(
        matrix_run: schemas.MatrixRunCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        project = db.query(models.Project).filter(models.Project.id == matrix_run.project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if not rbac.has_permission(current_user, "write", matrix_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to create test runs in this project")

        # Dedupe while preserving the caller's column order.
        environment_ids = list(dict.fromkeys(matrix_run.environment_ids))
        test_case_ids = list(dict.fromkeys(matrix_run.test_case_ids))

        environments = db.query(models.ExecutionEnvironment).filter(
            models.ExecutionEnvironment.id.in_(environment_ids)
        ).all()
        env_by_id = {env.id: env for env in environments}
        missing_envs = [env_id for env_id in environment_ids if env_id not in env_by_id]
        if missing_envs:
            raise HTTPException(status_code=404, detail=f"Environment(s) not found: {missing_envs}")
        foreign_envs = [env.id for env in environments if env.project_id != matrix_run.project_id]
        if foreign_envs:
            raise HTTPException(status_code=400, detail=f"Environment(s) do not belong to this project: {foreign_envs}")

        valid_case_ids = {
            row[0]
            for row in db.query(TestCase.id).filter(
                TestCase.id.in_(test_case_ids),
                TestCase.project_id == matrix_run.project_id,
                (TestCase.is_deleted.is_(None)) | (TestCase.is_deleted.is_(False)),
            ).all()
        }
        missing_cases = [case_id for case_id in test_case_ids if case_id not in valid_case_ids]
        if missing_cases:
            raise HTTPException(status_code=404, detail=f"Test case(s) not found in this project: {missing_cases}")

        _validate_test_run_scope(
            db,
            project_id=matrix_run.project_id,
            test_plan_id=matrix_run.test_plan_id,
            milestone_id=matrix_run.milestone_id,
        )
        assignee = _validate_test_run_assignee(db, matrix_run.assigned_to, matrix_run.project_id)

        db_matrix_run = models.MatrixRun(
            name=matrix_run.name,
            description=matrix_run.description,
            project_id=matrix_run.project_id,
            created_by=current_user.id,
        )
        db.add(db_matrix_run)
        db.flush()

        child_runs: List[TestRun] = []
        for env_id in environment_ids:
            environment = env_by_id[env_id]
            db_run = TestRun(
                name=f"{matrix_run.name} — {environment.name}",
                description=matrix_run.description,
                project_id=matrix_run.project_id,
                matrix_run_id=db_matrix_run.id,
                environment_id=env_id,
                test_plan_id=matrix_run.test_plan_id,
                milestone_id=matrix_run.milestone_id,
                assigned_to=matrix_run.assigned_to,
                priority=matrix_run.priority or "medium",
                estimated_duration=matrix_run.estimated_duration,
                status="pending",
            )
            db.add(db_run)
            db.flush()
            db.add_all([
                TestResult(test_run_id=db_run.id, test_case_id=case_id, status="not_started")
                for case_id in test_case_ids
            ])
            child_runs.append(db_run)

        crud.safe_commit(db)
        db.refresh(db_matrix_run)

        for db_run in child_runs:
            _snapshot_run_environment(db, db_run, env_by_id[db_run.environment_id])

        # Seeded results change milestone denominators; one child run is enough
        # to recompute the linked milestone.
        if matrix_run.milestone_id or matrix_run.test_plan_id:
            try:
                from ..services.milestone_service import recompute_milestones_for_test_run
                recompute_milestones_for_test_run(db, child_runs[0])
            except Exception as exc:
                logger.warning(f"Failed to recompute milestones for matrix run: {exc}")

        # One notification for the whole matrix instead of N per-run pings.
        if assignee:
            try:
                crud.create_notification(db=db, notification=schemas.NotificationCreate(
                    user_id=assignee.id,
                    title="Matrix run assigned",
                    message=(
                        f"{current_user.full_name or current_user.username} assigned matrix run "
                        f"{db_matrix_run.name} ({len(environment_ids)} environments) to you."
                    ),
                    type=models.NotificationType.INFO,
                    related_entity_type="matrix_run",
                    related_entity_id=db_matrix_run.id,
                ))
            except Exception:
                logger.exception("Failed to create matrix run assignment notification")

        from ..models import AuditAction
        _audit_matrix_run(
            db, current_user, db_matrix_run.id, db_matrix_run.project_id, AuditAction.CREATE,
            f"Matrix run created: {db_matrix_run.name} "
            f"({len(environment_ids)} environments x {len(test_case_ids)} cases)",
        )

        detail = schemas.MatrixRunDetail(**_serialize_matrix_run(db, db_matrix_run).model_dump())
        detail.rows = _build_pivot_rows(db, [run.id for run in child_runs])
        return detail

    @app.get("/matrix-runs", response_model=List[schemas.MatrixRun],
             dependencies=[Depends(require_project_feature("test_runs"))])
    def read_matrix_runs(
        project_id: int = Query(..., ge=1),
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        search: Optional[str] = Query(None, min_length=1, max_length=200),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to access this project")

        query = db.query(models.MatrixRun).filter(models.MatrixRun.project_id == project_id)
        if search:
            pattern = f"%{search.strip()}%"
            query = query.filter(models.MatrixRun.name.ilike(pattern))
        matrix_runs = (
            query.order_by(models.MatrixRun.created_at.desc(), models.MatrixRun.id.desc())
            .offset(skip).limit(limit).all()
        )
        return [_serialize_matrix_run(db, matrix_run) for matrix_run in matrix_runs]

    @app.get("/matrix-runs/{matrix_run_id}", response_model=schemas.MatrixRunDetail)
    def read_matrix_run(
        matrix_run_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        matrix_run = _get_matrix_run_or_404(db, matrix_run_id, current_user, "read")
        detail = schemas.MatrixRunDetail(**_serialize_matrix_run(db, matrix_run).model_dump())
        detail.rows = _build_pivot_rows(db, [run.id for run in matrix_run.test_runs])
        return detail

    @app.delete("/matrix-runs/{matrix_run_id}", response_model=schemas.MessageResponse)
    def delete_matrix_run(
        matrix_run_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        matrix_run = _get_matrix_run_or_404(db, matrix_run_id, current_user, "delete")
        name, project_id = matrix_run.name, matrix_run.project_id

        # Reuse the single-run delete so results/milestone refresh behave the same.
        child_run_ids = [run.id for run in matrix_run.test_runs]
        for run_id in child_run_ids:
            crud.delete_test_run(db, test_run_id=run_id)
        db.delete(matrix_run)
        crud.safe_commit(db)

        from ..models import AuditAction
        _audit_matrix_run(
            db, current_user, matrix_run_id, project_id, AuditAction.DELETE,
            f"Matrix run deleted: {name} ({len(child_run_ids)} environment runs)",
        )
        return {"message": "Matrix run deleted successfully"}
