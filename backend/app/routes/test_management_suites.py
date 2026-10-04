from fastapi import Depends, File, Form, HTTPException, Path, Query, UploadFile
from sqlalchemy.orm import Session, joinedload, selectinload
from typing import List, Optional
from sqlalchemy import desc, case, func, cast, Date
from datetime import datetime, timedelta, timezone
import logging
import re

from .. import crud, schemas, auth, rbac, models
from ..feature_guard import require_any_project_feature, require_project_feature
from ..database import get_db
from ..auth import get_current_active_user, get_current_user
from ..models import (
    AuditAction,
    EntityType,
    ResultStatus,
    TestCase,
    TestCaseRevision,
    TestResult,
    TestRun,
    User,
    canonical_result_status,
)
from .test_management_helpers import *

logger = logging.getLogger(__name__)

# test_suites.name is String(255); a clone of a max-length name still has to fit.
MAX_SUITE_NAME_LENGTH = 255


def _record_suite_audit(db, current_user, action, suite_id, project_id, description):
    """Best-effort audit entry: never fail the request because auditing did."""
    try:
        from ..services.audit_service import get_audit_service
        from ..schemas_audit import AuditTrailCreate
        get_audit_service(db).create_audit_trail(
            AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=action,
                entity_type=EntityType.TEST_SUITE.value,
                entity_id=suite_id,
                project_id=project_id,
                description=description,
            )
        )
    except Exception:
        logger.exception("Failed to create audit trail for test suite %s", action)


def register_suite_routes(app):
    @app.post("/test-suites", response_model=schemas.TestSuite,
              dependencies=[Depends(require_project_feature("test_suites"))])
    def create_test_suite(
        test_suite: schemas.TestSuiteCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if test_suite.project_id <= 0:
            raise HTTPException(status_code=400, detail="Invalid project_id")

        project = db.query(models.Project).filter(models.Project.id == test_suite.project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to create test suite in this project")

        db_test_suite = crud.create_test_suite(db=db, test_suite=test_suite)

        # Attach count so the response is consistent with list/detail responses.
        counts = crud.get_test_case_counts_by_suite(db, [db_test_suite.id])
        db_test_suite.test_case_count = counts.get(db_test_suite.id, 0)

        _record_suite_audit(
            db,
            current_user,
            AuditAction.CREATE.value,
            db_test_suite.id,
            db_test_suite.project_id,
            f"Test suite created: {db_test_suite.name or 'Untitled'}",
        )

        return db_test_suite

    @app.get("/test-suites", response_model=List[schemas.TestSuite],
             dependencies=[Depends(require_project_feature("test_suites"))])
    def read_test_suites(
        project_id: Optional[int] = Query(None, ge=1),
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if project_id is not None:
            if not rbac.has_permission(current_user, "read", project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to access this project")
            test_suites = crud.get_test_suites(db, project_id=project_id, skip=skip, limit=limit)
        else:
            # Scope in SQL rather than filtering the page afterwards: post-filtering
            # both hands restricted users short/empty pages and costs two permission
            # queries per suite on every request.
            accessible_project_ids = [
                project.id for project in rbac.get_accessible_projects(current_user, db)
            ]
            if not accessible_project_ids:
                return []
            test_suites = crud.get_test_suites(
                db,
                skip=skip,
                limit=limit,
                project_ids=accessible_project_ids,
            )

        suite_ids = [suite.id for suite in test_suites]
        counts = crud.get_test_case_counts_by_suite(db, suite_ids)
        for suite in test_suites:
            suite.test_case_count = counts.get(suite.id, 0)

        return test_suites

    @app.get("/test-suites/{test_suite_id}", response_model=schemas.TestSuite,
             dependencies=[Depends(require_project_feature("test_suites"))])
    def read_test_suite(
        test_suite_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        db_test_suite = crud.get_test_suite(db, test_suite_id=test_suite_id)
        if db_test_suite is None:
            raise HTTPException(status_code=404, detail="Test suite not found")

        if not rbac.has_permission(current_user, "read", db_test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to access this test suite")

        counts = crud.get_test_case_counts_by_suite(db, [db_test_suite.id])
        db_test_suite.test_case_count = counts.get(db_test_suite.id, 0)
        return db_test_suite

    # Runs are owned by the test_runs module but always launched from a suite, so
    # either module being on keeps this route available.
    @app.post("/test-suites/{test_suite_id}/test-runs", response_model=schemas.TestSuiteRun,
              dependencies=[Depends(require_any_project_feature("test_suites", "test_runs"))])
    def create_test_run_from_suite(
        run_data: schemas.TestSuiteRunCreate,
        test_suite_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_test_suite = crud.get_test_suite(db, test_suite_id=test_suite_id)
        if db_test_suite is None:
            raise HTTPException(status_code=404, detail="Test suite not found")

        if not rbac.has_permission(current_user, "write", db_test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to create a test run for this test suite")

        test_cases = db.query(models.TestCase).filter(
            models.TestCase.test_suite_id == test_suite_id,
            models.TestCase.is_deleted == False
        ).all()
        if not test_cases:
            raise HTTPException(status_code=400, detail="Cannot create a test run for a suite with no test cases")

        try:
            db_test_run = crud.create_test_suite_run(db, db_test_suite, test_cases, run_data)
        except Exception:
            db.rollback()
            raise

        # Create TestRunEnvironment snapshot if environment_id is provided
        if db_test_run.environment_id:
            try:
                environment = db.query(models.ExecutionEnvironment).filter(
                    models.ExecutionEnvironment.id == db_test_run.environment_id
                ).first()
                if environment:
                    test_run_env_data = {
                        "test_run_id": db_test_run.id,
                        "environment_id": db_test_run.environment_id,
                        "config_snapshot": {
                            "name": environment.name,
                            "description": environment.description,
                            "environment_type": environment.environment_type,
                            "config_data": environment.config_data,
                        } if environment.config_data else {
                            "name": environment.name,
                            "description": environment.description,
                            "environment_type": environment.environment_type,
                        },
                        "build_snapshot": {
                            "created_at": db_test_run.created_at.isoformat() if db_test_run.created_at else None,
                            "test_run_name": db_test_run.name,
                        }
                    }
                    crud.create_test_run_environment(db=db, test_run_environment=test_run_env_data)
            except Exception as e:
                logger.error(f"Failed to create test run environment snapshot from suite: {e}")

        # Create audit trail after the atomic run/result transaction succeeds.
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            get_audit_service(db).create_audit_trail(
                AuditTrailCreate(
                    user_id=current_user.id if current_user else None,
                    action=AuditAction.CREATE.value,
                    entity_type=EntityType.TEST_RUN.value,
                    entity_id=db_test_run.id,
                    project_id=db_test_suite.project_id,
                    description=f"Test run created from suite: {db_test_suite.name or 'Untitled'}",
                )
            )
        except Exception:
            logger.exception("Failed to create audit trail for suite test run creation")

        return db_test_run

    @app.put("/test-suites/{test_suite_id}", response_model=schemas.TestSuite,
             dependencies=[Depends(require_project_feature("test_suites"))])
    def update_test_suite(
        test_suite: schemas.TestSuiteUpdate,
        test_suite_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        db_test_suite = crud.get_test_suite(db, test_suite_id=test_suite_id)
        if db_test_suite is None:
            raise HTTPException(status_code=404, detail="Test suite not found")

        if not rbac.has_permission(current_user, "write", db_test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to update this test suite")

        db_test_suite = crud.update_test_suite(db, test_suite_id=test_suite_id, test_suite=test_suite)

        counts = crud.get_test_case_counts_by_suite(db, [db_test_suite.id])
        db_test_suite.test_case_count = counts.get(db_test_suite.id, 0)

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            get_audit_service(db).create_audit_trail(
                AuditTrailCreate(
                    user_id=current_user.id if current_user else None,
                    action=AuditAction.UPDATE.value,
                    entity_type=EntityType.TEST_SUITE.value,
                    entity_id=db_test_suite.id,
                    project_id=db_test_suite.project_id,
                    description=f"Test suite updated: {db_test_suite.name or 'Untitled'}",
                )
            )
        except Exception:
            logger.exception("Failed to create audit trail for test suite update")

        return db_test_suite

    @app.delete("/test-suites/{test_suite_id}", response_model=schemas.MessageResponse,
             dependencies=[Depends(require_project_feature("test_suites"))])
    def delete_test_suite(
        test_suite_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        db_test_suite = crud.get_test_suite(db, test_suite_id=test_suite_id)
        if db_test_suite is None:
            raise HTTPException(status_code=404, detail="Test suite not found")

        if not rbac.has_permission(current_user, "delete", db_test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to delete this test suite")

        # Refuse to delete a suite that still has test cases or sections. Without
        # this guard the bare db.delete() in the CRUD would crash with an
        # integrity error (no ON DELETE CASCADE is configured on the children).
        test_case_count = (
            db.query(models.TestCase)
            .filter(
                models.TestCase.test_suite_id == test_suite_id,
                ((models.TestCase.is_deleted.is_(None)) | (models.TestCase.is_deleted.is_(False))),
            )
            .count()
        )
        section_count = (
            db.query(models.TestCaseSection)
            .filter(models.TestCaseSection.test_suite_id == test_suite_id)
            .count()
        )
        if test_case_count or section_count:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Test suite is not empty. Move or delete its test cases and sections first "
                    f"({test_case_count} test cases, {section_count} sections)."
                ),
            )

        suite_id = db_test_suite.id
        suite_name = db_test_suite.name
        project_id = db_test_suite.project_id

        crud.delete_test_suite(db, test_suite_id=test_suite_id)

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            get_audit_service(db).create_audit_trail(
                AuditTrailCreate(
                    user_id=current_user.id if current_user else None,
                    action=AuditAction.DELETE.value,
                    entity_type=EntityType.TEST_SUITE.value,
                    entity_id=suite_id,
                    project_id=project_id,
                    description=f"Test suite deleted: {suite_name or 'Untitled'}",
                )
            )
        except Exception:
            logger.exception("Failed to create audit trail for test suite deletion")

        return {"message": "Test suite deleted successfully"}
