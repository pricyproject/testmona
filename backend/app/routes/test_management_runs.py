from fastapi import Depends, File, Form, HTTPException, Path, Query, UploadFile
from sqlalchemy.orm import Session, joinedload, selectinload
from typing import List, Optional
from sqlalchemy import desc, case, func, cast, Date
from datetime import datetime, timedelta, timezone
import logging
import re

from .. import crud, schemas, auth, rbac, models
from ..feature_guard import require_project_feature
from ..database import get_db
from ..auth import get_current_active_user, get_current_user
from ..models import TestCase, TestResult, TestRun, User, TestCaseRevision, ResultStatus, canonical_result_status
from .test_management_helpers import *

logger = logging.getLogger(__name__)


def register_run_routes(app):
    @app.post("/test-runs", response_model=schemas.TestRun,
              dependencies=[Depends(require_project_feature("test_runs"))])
    def create_test_run(
        test_run: schemas.TestRunCreate, 
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        project = db.query(models.Project).filter(models.Project.id == test_run.project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if not rbac.has_permission(current_user, "write", test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to create test run in this project")

        _validate_test_run_scope(
            db,
            project_id=test_run.project_id,
            test_plan_id=test_run.test_plan_id,
            milestone_id=test_run.milestone_id,
            environment_id=test_run.environment_id,
        )
        assignee = _validate_test_run_assignee(db, test_run.assigned_to, test_run.project_id)
        db_test_run = crud.create_test_run(db=db, test_run=test_run)
        _attach_test_run_progress(db, [db_test_run])
        _notify_test_run_assignee(db, db_test_run, current_user, assignee)
        
        # Create TestRunEnvironment snapshot if environment_id is provided
        if test_run.environment_id:
            try:
                environment = db.query(models.ExecutionEnvironment).filter(
                    models.ExecutionEnvironment.id == test_run.environment_id
                ).first()
                if environment:
                    # Create environment snapshot
                    test_run_env_data = {
                        "test_run_id": db_test_run.id,
                        "environment_id": test_run.environment_id,
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
                logger.error(f"Failed to create test run environment snapshot: {e}")
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.TEST_RUN.value,
                entity_id=db_test_run.id,
                project_id=test_run.project_id,
                description=f"Test run created: {db_test_run.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for test run creation: {e}")
        
        return db_test_run

    @app.get("/test-runs", response_model=List[schemas.TestRun],
             dependencies=[Depends(require_project_feature("test_runs"))])
    def read_test_runs(
        project_id: Optional[int] = None,
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        search: Optional[str] = Query(None, min_length=1, max_length=200, description="Search test runs by name or description"),
        status: Optional[str] = Query(None, description="Filter by test run status"),
        priority: Optional[str] = Query(None, description="Filter by priority"),
        assigned_to: Optional[int] = Query(None, description="Filter by assigned user ID"),
        test_plan_id: Optional[int] = Query(None, description="Filter by linked test plan ID"),
        milestone_id: Optional[int] = Query(None, description="Filter by linked milestone ID"),
        environment_id: Optional[int] = Query(None, ge=1, description="Filter by execution environment ID"),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        # If project_id is provided, check project access
        if project_id:
            if not rbac.has_permission(current_user, "read", project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to access this project")
        
        test_runs = crud.get_test_runs(
            db,
            project_id=project_id,
            skip=skip,
            limit=limit,
            search=search.strip() if search else None,
            status=status,
            priority=priority,
            assigned_to=assigned_to,
            test_plan_id=test_plan_id,
            milestone_id=milestone_id,
            environment_id=environment_id,
        )
        
        # Filter test runs based on user permissions if no project_id specified
        if not project_id:
            # User can only see test runs for projects they have access to
            authorized_runs = []
            for run in test_runs:
                if rbac.has_permission(current_user, "read", run.project_id, db):
                    authorized_runs.append(run)
            return _attach_test_run_progress(db, authorized_runs)
        
        return _attach_test_run_progress(db, test_runs)

    @app.get("/test-runs/{test_run_id}", response_model=schemas.TestRun)
    def read_test_run(test_run_id: int, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        db_test_run = crud.get_test_run(db, test_run_id=test_run_id)
        if db_test_run is None:
            raise HTTPException(status_code=404, detail="Test run not found")
        
        # Check if user has permission to access this test run's project
        if not rbac.has_permission(current_user, "read", db_test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to access this test run")
        
        _attach_test_run_progress(db, [db_test_run])
        return db_test_run

    @app.get("/test-runs/{test_run_id}/environment", response_model=schemas.TestRunEnvironment)
    def get_test_run_environment(test_run_id: int, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        """Get the environment snapshot for a test run"""
        db_test_run = crud.get_test_run(db, test_run_id=test_run_id)
        if db_test_run is None:
            raise HTTPException(status_code=404, detail="Test run not found")
        
        # Check if user has permission to access this test run's project
        if not rbac.has_permission(current_user, "read", db_test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to access this test run")
        
        test_run_env = crud.get_test_run_environments(db, test_run_id=test_run_id)
        if not test_run_env:
            raise HTTPException(status_code=404, detail="Environment snapshot not found for this test run")
        
        return test_run_env[0]

    @app.put("/test-runs/{test_run_id}", response_model=schemas.TestRun)
    def update_test_run(test_run_id: int, test_run: schemas.TestRunUpdate, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        # First get the test run to check project access
        db_test_run = crud.get_test_run(db, test_run_id=test_run_id)
        if db_test_run is None:
            raise HTTPException(status_code=404, detail="Test run not found")
        
        # Check if user has permission to update this test run's project
        if not rbac.has_permission(current_user, "write", db_test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to update this test run")

        changed_fields = test_run.model_dump(exclude_unset=True)
        old_assignee_id = db_test_run.assigned_to
        assignee = None
        _validate_test_run_scope(
            db,
            project_id=db_test_run.project_id,
            test_plan_id=changed_fields.get("test_plan_id", db_test_run.test_plan_id),
            milestone_id=changed_fields.get("milestone_id", db_test_run.milestone_id),
            environment_id=changed_fields.get("environment_id", db_test_run.environment_id),
        )
        if "assigned_to" in changed_fields:
            assignee = _validate_test_run_assignee(db, changed_fields.get("assigned_to"), db_test_run.project_id)

        if changed_fields.get("status") == "completed" and "completed_at" not in changed_fields:
            test_run.completed_at = datetime.now(timezone.utc)
        elif changed_fields.get("status") in {"pending", "running", "in_progress"} and "completed_at" not in changed_fields:
            test_run.completed_at = None
        
        # Perform the update
        db_test_run = crud.update_test_run(db, test_run_id=test_run_id, test_run=test_run)
        _attach_test_run_progress(db, [db_test_run])

        # Update TestRunEnvironment snapshot if environment_id changed
        if "environment_id" in changed_fields:
            try:
                # Delete old snapshot if exists
                old_snapshots = crud.get_test_run_environments(db, test_run_id=test_run_id)
                for old_snapshot in old_snapshots:
                    db.delete(old_snapshot)
                
                # Create new snapshot if environment_id is provided
                if db_test_run.environment_id:
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
                                "updated_at": datetime.now(timezone.utc).isoformat(),
                                "test_run_name": db_test_run.name,
                            }
                        }
                        crud.create_test_run_environment(db=db, test_run_environment=test_run_env_data)
                db.commit()
            except Exception as e:
                logger.error(f"Failed to update test run environment snapshot: {e}")

        if "assigned_to" in changed_fields and db_test_run.assigned_to != old_assignee_id:
            _notify_test_run_assignee(db, db_test_run, current_user, assignee)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_RUN.value,
                entity_id=db_test_run.id,
                project_id=db_test_run.project_id,
                description=f"Test run updated: {db_test_run.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for test run update: {e}")
        
        return db_test_run

    @app.put("/test-runs/{test_run_id}/assign", response_model=schemas.TestRun)
    def assign_test_run(
        test_run_id: int,
        assignment: schemas.TestRunAssign,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_test_run = crud.get_test_run(db, test_run_id=test_run_id)
        if db_test_run is None:
            raise HTTPException(status_code=404, detail="Test run not found")

        if not rbac.has_permission(current_user, "write", db_test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to assign this test run")

        assignee = _validate_test_run_assignee(db, assignment.assigned_to, db_test_run.project_id)
        old_assignee_id = db_test_run.assigned_to
        db_test_run = crud.update_test_run(db, test_run_id=test_run_id, test_run=schemas.TestRunUpdate(assigned_to=assignment.assigned_to))
        _attach_test_run_progress(db, [db_test_run])

        if db_test_run.assigned_to != old_assignee_id:
            _notify_test_run_assignee(db, db_test_run, current_user, assignee)

        return db_test_run

    @app.post("/test-runs/{test_run_id}/import-results")
    async def import_test_run_results(
        test_run_id: int,
        file: UploadFile = File(...),
        format: Optional[str] = Form(None),
        auto_create: bool = Form(False),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Import CI test results (JUnit XML or CTRF JSON) into a test run.

        ``format`` may be omitted; it's inferred from the filename and content.
        ``auto_create=true`` attaches matched cases that aren't yet in the run.
        """
        from ..services.ci_ingestion_service import (
            CIIngestError,
            SUPPORTED_FORMATS,
            apply_results,
            detect_format,
            parse,
        )

        db_test_run = crud.get_test_run(db, test_run_id=test_run_id)
        if db_test_run is None:
            raise HTTPException(status_code=404, detail="Test run not found")
        if not rbac.has_permission(current_user, "execute", db_test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to import results into this test run")

        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        try:
            chosen_format = (format or "").strip().lower() or detect_format(content, file.filename)
        except CIIngestError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if chosen_format not in SUPPORTED_FORMATS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported format '{chosen_format}'. Supported: {', '.join(SUPPORTED_FORMATS)}",
            )

        try:
            parsed = parse(content, chosen_format)
        except CIIngestError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        try:
            summary = apply_results(
                db,
                db_test_run,
                parsed,
                fmt=chosen_format,
                executor_id=current_user.id if current_user else None,
                auto_create=bool(auto_create),
            )
            crud.safe_commit(db)
        except Exception:
            db.rollback()
            raise

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_service.create_audit_trail(AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_RUN.value,
                entity_id=test_run_id,
                project_id=db_test_run.project_id,
                description=(
                    f"CI results imported ({chosen_format}): "
                    f"{summary.matched} matched, {summary.created} created, "
                    f"{summary.updated} updated, {summary.unmatched} unmatched, "
                    f"{summary.skipped} skipped"
                ),
            ))
        except Exception as exc:
            logger.warning("Failed to create audit trail for CI import: %s", exc)

        return summary.to_dict()

    @app.delete("/test-runs/{test_run_id}", response_model=schemas.MessageResponse)
    def delete_test_run(test_run_id: int, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        # First get the test run to check project access
        db_test_run = crud.get_test_run(db, test_run_id=test_run_id)
        if db_test_run is None:
            raise HTTPException(status_code=404, detail="Test run not found")
        
        # Check if user has permission to delete this test run's project
        if not rbac.has_permission(current_user, "delete", db_test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to delete this test run")
        
        # Store data for audit trail before deletion
        run_id = db_test_run.id
        run_name = db_test_run.name
        project_id = db_test_run.project_id
        
        # Perform the deletion
        db_test_run = crud.delete_test_run(db, test_run_id=test_run_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.TEST_RUN.value,
                entity_id=run_id,
                project_id=project_id,
                description=f"Test run deleted: {run_name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for test run deletion: {e}")
        
        return {"message": "Test run deleted successfully"}

    @app.put("/test-runs/{test_run_id}/reset-time")
    def reset_test_run_time(
        test_run_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Reset all timing data for a test run and its test results"""
        # Get the test run
        db_test_run = crud.get_test_run(db, test_run_id=test_run_id)
        if db_test_run is None:
            raise HTTPException(status_code=404, detail="Test run not found")
        
        # Check if user has permission to update this test run's project
        if not rbac.has_permission(current_user, "write", db_test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to reset time for this test run")
        
        try:
            # Reset test run timing fields
            db_test_run.started_at = None
            db_test_run.completed_at = None
            db.commit()
            
            # Reset all test result timing fields for this test run
            test_results = db.query(models.TestResult).filter(
                models.TestResult.test_run_id == test_run_id
            ).all()
            
            for result in test_results:
                result.execution_time = None
                result.execution_started_at = None
                result.executed_at = func.now()  # Reset to current time
                result.execution_state = "idle"
                result.paused_at = None
                result.total_paused_time = 0.0
                result.manual_time_adjustment = 0.0
            
            db.commit()
            
            # Create audit trail
            try:
                from ..services.audit_service import get_audit_service
                from ..schemas_audit import AuditTrailCreate
                from ..models import AuditAction, EntityType
                audit_service = get_audit_service(db)
                audit_data = AuditTrailCreate(
                    user_id=current_user.id if current_user else None,
                    action=AuditAction.UPDATE.value,
                    entity_type=EntityType.TEST_RUN.value,
                    entity_id=db_test_run.id,
                    project_id=db_test_run.project_id,
                    description=f"Test run time reset: {db_test_run.name or 'Untitled'}",
                )
                audit_service.create_audit_trail(audit_data)
            except Exception as e:
                logger.warning(f"Failed to create audit trail for test run time reset: {e}")
            
            return {
                "message": "Test run time reset successfully",
                "test_run_id": test_run_id,
                "test_results_reset": len(test_results)
            }
            
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to reset test run time: {str(e)}")
