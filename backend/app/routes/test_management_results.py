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
from ..auth import get_current_active_user
from ..models import TestCase, TestResult, TestRun, User, TestCaseRevision, ResultStatus, canonical_result_status
from .test_management_helpers import *

logger = logging.getLogger(__name__)


def register_result_routes(app):
    @app.get("/test-runs/{test_run_id}/statistics", response_model=schemas.TestRunStatistics)
    def get_test_run_statistics(
        test_run_id: int, 
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        test_results = crud.get_test_results(db, test_run_id=test_run_id)

        total_tests = len(test_results)
        passed = len([r for r in test_results if r.status == ResultStatus.PASS])
        failed = len([r for r in test_results if r.status == ResultStatus.FAIL])
        skipped = len([r for r in test_results if r.status == ResultStatus.SKIP])
        blocked = len([r for r in test_results if r.status == ResultStatus.BLOCK])
        
        pass_rate = (passed / total_tests * 100) if total_tests > 0 else 0
        execution_time = sum([r.execution_time or 0 for r in test_results])
        
        return schemas.TestRunStatistics(
            total_tests=total_tests,
            passed=passed,
            failed=failed,
            skipped=skipped,
            blocked=blocked,
            pass_rate=pass_rate,
            execution_time=execution_time
        )

    @app.post("/test-results", response_model=schemas.TestResult)
    def create_test_result(
        test_result: schemas.TestResultCreate, 
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_case = crud.get_test_case(db, test_case_id=test_result.test_case_id)
        if not test_case:
            raise HTTPException(status_code=404, detail="Test case not found")

        test_run = crud.get_test_run(db, test_run_id=test_result.test_run_id)
        if not test_run:
            raise HTTPException(status_code=404, detail="Test run not found")

        test_case_project_id = test_case.test_suite.project_id if test_case.test_suite else None
        if test_case_project_id != test_run.project_id:
            raise HTTPException(status_code=400, detail="Test case does not belong to the test run project")

        if not rbac.has_permission(current_user, "write", test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to create test result in this project")

        # Canonicalize the status so storage never holds two spellings of the same
        # outcome (skip/skipped, pass/passed, ...).
        if test_result.status is not None:
            test_result.status = canonical_result_status(test_result.status)

        if _is_completed_result_status(test_result.status) and not test_result.executed_by:
            test_result.executed_by = current_user.id

        db_test_result = crud.create_test_result(db=db, test_result=test_result)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            
            # Get project_id from test run
            project_id = None
            if db_test_result.test_run_id:
                test_run = crud.get_test_run(db, test_run_id=db_test_result.test_run_id)
                if test_run:
                    project_id = test_run.project_id
            
            audit_data = AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.EXECUTE.value,
                entity_type=EntityType.TEST_RESULT.value,
                entity_id=db_test_result.id,
                project_id=project_id,
                description=f"Test result created: {db_test_result.status}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for test result creation: {e}")
        
        return db_test_result

    @app.get("/test-results", response_model=List[schemas.TestResultWithDetails])
    def read_test_results(test_run_id: int = None, test_case_id: int = None, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        query = db.query(models.TestResult).options(
            joinedload(models.TestResult.test_case).joinedload(models.TestCase.section),
            joinedload(models.TestResult.test_case).selectinload(models.TestCase.custom_field_values),
            joinedload(models.TestResult.executor),
            selectinload(models.TestResult.defect_links).joinedload(models.TestResultDefectLink.defect),
        ).join(models.TestRun).filter(
            models.TestResult.test_case_id.isnot(None),
            models.TestResult.test_run_id.isnot(None),
            models.TestResult.test_case.has(
                (models.TestCase.is_deleted.is_(None)) | (models.TestCase.is_deleted.is_(False))
            ),
        )

        scoped_project_ids = None
        if test_run_id is not None:
            test_run = crud.get_test_run(db, test_run_id=test_run_id)
            if not test_run:
                raise HTTPException(status_code=404, detail="Test run not found")
            if not rbac.has_permission(current_user, "read", test_run.project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to access this test run")
            scoped_project_ids = [test_run.project_id]
            query = query.filter(models.TestResult.test_run_id == test_run_id)

        if test_case_id is not None:
            test_case = crud.get_test_case(db, test_case_id=test_case_id)
            if not test_case or getattr(test_case, "is_deleted", False):
                raise HTTPException(status_code=404, detail="Test case not found")
            test_case_project_id = test_case.project_id or (test_case.test_suite.project_id if test_case.test_suite else None)
            if test_case_project_id is None:
                raise HTTPException(status_code=404, detail="Test case project not found")
            if not rbac.has_permission(current_user, "read", test_case_project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to access this test case")
            scoped_project_ids = [test_case_project_id] if scoped_project_ids is None else scoped_project_ids
            query = query.filter(models.TestResult.test_case_id == test_case_id)

        if scoped_project_ids is None:
            scoped_project_ids = [project.id for project in rbac.get_accessible_projects(current_user, db)]
        if not scoped_project_ids:
            return []

        return query.filter(models.TestRun.project_id.in_(scoped_project_ids)).offset(skip).limit(limit).all()

    @app.get("/test-results/{test_result_id}", response_model=schemas.TestResult)
    def read_test_result(test_result_id: int, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        db_test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if db_test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")
        
        # Get the test run to check project access
        test_run = crud.get_test_run(db, test_run_id=db_test_result.test_run_id)
        if test_run:
            # Check if user has permission to access this test result's project
            if not rbac.has_permission(current_user, "read", test_run.project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to access this test result")
        
        return db_test_result

    @app.put("/test-results/{test_result_id}", response_model=schemas.TestResultWithDetails)
    def update_test_result(test_result_id: int, test_result: schemas.TestResultUpdate, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        # First get the test result to check project access
        db_test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if db_test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")
        
        # Get the test run to check project access
        test_run = crud.get_test_run(db, test_run_id=db_test_result.test_run_id)
        if test_run:
            # Check if user has permission to update this test result's project
            if not rbac.has_permission(current_user, "write", test_run.project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to update this test result")

        # Canonicalize the status so storage never holds two spellings of the same
        # outcome (skip/skipped, pass/passed, ...).
        if test_result.status is not None:
            test_result.status = canonical_result_status(test_result.status)

        if (
            test_result.status is not None
            and _is_completed_result_status(test_result.status)
            and not test_result.executed_by
            and not db_test_result.executed_by
        ):
            test_result.executed_by = current_user.id

        # Perform the update
        db_test_result = crud.update_test_result(db, test_result_id=test_result_id, test_result=test_result)
        return crud.get_test_result(db, test_result_id=db_test_result.id)

    @app.delete("/test-results/{test_result_id}", response_model=schemas.MessageResponse)
    def delete_test_result(test_result_id: int, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        # First get the test result to check project access
        db_test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if db_test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")
        
        # Get the test run to check project access
        test_run = crud.get_test_run(db, test_run_id=db_test_result.test_run_id)
        if test_run:
            # Check if user has permission to delete this test result's project
            if not rbac.has_permission(current_user, "delete", test_run.project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to delete this test result")
        
        # Perform the deletion
        db_test_result = crud.delete_test_result(db, test_result_id=test_result_id)
        return {"message": "Test result deleted successfully"}

    @app.put("/test-results/{test_result_id}/pause")
    def pause_test_execution(
        test_result_id: int, 
        db: Session = Depends(get_db), 
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Pause a test execution"""
        db_test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if db_test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")
        
        # Check project access
        test_run = crud.get_test_run(db, test_run_id=db_test_result.test_run_id)
        if test_run and not rbac.has_permission(current_user, "write", test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to pause this test result")
        
        # Update execution state to paused
        update_data = {"execution_state": "paused"}
        crud.update_test_result(db, test_result_id, schemas.TestResultUpdate(**update_data))
        
        return {"message": "Test execution paused", "execution_state": "paused"}

    @app.put("/test-results/{test_result_id}/resume")
    def resume_test_execution(
        test_result_id: int, 
        db: Session = Depends(get_db), 
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Resume a paused test execution"""
        db_test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if db_test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")
        
        # Check project access
        test_run = crud.get_test_run(db, test_run_id=db_test_result.test_run_id)
        if test_run and not rbac.has_permission(current_user, "write", test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to resume this test result")
        
        # Update execution state to running
        update_data = {"execution_state": "running"}
        crud.update_test_result(db, test_result_id, schemas.TestResultUpdate(**update_data))
        
        return {"message": "Test execution resumed", "execution_state": "running"}

    @app.put("/test-results/{test_result_id}/add-time")
    def add_manual_time(
        test_result_id: int,
        time_data: dict,  # Expect {"hours": float}
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Add manual time adjustment to test execution"""
        db_test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if db_test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")
        
        # Check project access
        test_run = crud.get_test_run(db, test_run_id=db_test_result.test_run_id)
        if test_run and not rbac.has_permission(current_user, "write", test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to modify this test result")
        
        # Validate input
        hours = time_data.get("hours", 0)
        if hours <= 0 or hours > 24:
            raise HTTPException(status_code=400, detail="Hours must be between 0 and 24")
        
        # Add manual time adjustment
        current_adjustment = db_test_result.manual_time_adjustment or 0
        current_execution_time = db_test_result.execution_time or 0
        additional_seconds = hours * 3600
        
        # If currently paused, don't let timing logic recalculate on next update
        # Set explicit execution_time to prevent override
        update_data = {
            "manual_time_adjustment": current_adjustment + additional_seconds,
            "execution_time": current_execution_time + additional_seconds
        }
        
        # If paused, also update the execution_state to maintain pause
        if db_test_result.execution_state == "paused":
            # Don't change execution_state, just update timing fields
            pass
            
        crud.update_test_result(db, test_result_id, schemas.TestResultUpdate(**update_data))
        
        return {
            "message": f"Added {hours} hours to execution time",
            "total_manual_adjustment": current_adjustment + additional_seconds
        }

    @app.put("/test-results/{test_result_id}/reset-time")
    def reset_test_result_time(
        test_result_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Reset timing data for a specific test result"""
        db_test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if db_test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")
        
        # Check project access
        test_run = crud.get_test_run(db, test_run_id=db_test_result.test_run_id)
        if test_run and not rbac.has_permission(current_user, "write", test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to reset time for this test result")
        
        try:
            # Reset timing fields for this specific test result only
            update_data = {
                "execution_time": None,
                "execution_started_at": None,
                "execution_state": "idle",
                "paused_at": None,
                "total_paused_time": 0.0,
                "manual_time_adjustment": 0.0,
                "executed_at": func.now()  # Reset to current time
            }
            crud.update_test_result(db, test_result_id, schemas.TestResultUpdate(**update_data))
            
            # Create audit trail
            try:
                from ..services.audit_service import get_audit_service
                from ..schemas_audit import AuditTrailCreate
                from ..models import AuditAction, EntityType
                audit_service = get_audit_service(db)
                audit_data = AuditTrailCreate(
                    user_id=current_user.id if current_user else None,
                    action=AuditAction.UPDATE.value,
                    entity_type=EntityType.TEST_RESULT.value,
                    entity_id=db_test_result.id,
                    project_id=test_run.project_id,
                    description=f"Test result time reset: {db_test_result.test_case.title if db_test_result.test_case else 'Test Case'}",
                )
                audit_service.create_audit_trail(audit_data)
            except Exception as e:
                logger.warning(f"Failed to create audit trail for test result time reset: {e}")
            
            return {
                "message": "Test result time reset successfully",
                "test_result_id": test_result_id
            }
            
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to reset test result time: {str(e)}")

    @app.get("/test-results/{test_result_id}/step-results", response_model=List[schemas.TestStepResult])
    def get_result_step_results(
        test_result_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Per-step pass/fail outcomes recorded for a test result."""
        db_test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if db_test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")
        test_run = crud.get_test_run(db, test_run_id=db_test_result.test_run_id)
        if test_run and not rbac.has_permission(current_user, "read", test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to view this test result")
        return crud.get_test_step_results_by_test_result(db, test_result_id)

    @app.put("/test-results/{test_result_id}/step-results", response_model=List[schemas.TestStepResult])
    def set_result_step_results(
        test_result_id: int,
        step_results: List[schemas.TestStepResultBase],
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Replace the per-step outcomes for a test result in one shot."""
        db_test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if db_test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")
        test_run = crud.get_test_run(db, test_run_id=db_test_result.test_run_id)
        if test_run and not rbac.has_permission(current_user, "write", test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to modify this test result")
        return crud.replace_test_step_results(db, test_result_id, step_results)

    @app.get("/test-cases/{test_case_id}/execution-history", response_model=List[schemas.ExecutionHistoryItem])
    def get_test_case_execution_history(
        test_case_id: int,
        limit: int = Query(50, ge=1, le=200),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get execution history for a specific test case across all test runs"""

        test_case = db.query(TestCase).filter(
            TestCase.id == test_case_id,
            TestCase.is_deleted == False
        ).first()
        if not test_case:
            raise HTTPException(status_code=404, detail="Test case not found")

        suite = db.query(models.TestSuite).filter(models.TestSuite.id == test_case.test_suite_id).first()
        if not suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")

        if not rbac.has_permission(current_user, "read", suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to access this test case")

        history = db.query(TestResult).options(
            joinedload(TestResult.test_run).joinedload(TestRun.project),
            joinedload(TestResult.test_run).joinedload(TestRun.assignee),
            joinedload(TestResult.executor),
        ).filter(
            TestResult.test_case_id == test_case_id
        ).order_by(
            desc(case(
                (TestResult.executed_at.isnot(None), TestResult.executed_at),
                else_=TestResult.created_at
            ))
        ).limit(limit).all()

        result = []
        for item in history:
            test_run = item.test_run
            executed_by_user = item.executor or (
                test_run.assignee if test_run and _is_completed_result_status(item.status) else None
            )

            result.append({
                "id": item.id,
                "test_run_id": item.test_run_id,
                "test_run_name": test_run.name if test_run else None,
                "test_run_status": test_run.status if test_run else None,
                "test_run_priority": test_run.priority if test_run else None,
                "test_run_created_at": test_run.created_at if test_run else None,
                "test_run_started_at": test_run.started_at if test_run else None,
                "test_run_completed_at": test_run.completed_at if test_run else None,
                "project_id": test_run.project_id if test_run else None,
                "project_name": test_run.project.name if test_run and test_run.project else None,
                "status": item.status.value if hasattr(item.status, 'value') else item.status,
                "executed_by": executed_by_user.username if executed_by_user else None,
                "executed_by_full_name": executed_by_user.full_name if executed_by_user else None,
                "executed_by_email": executed_by_user.email if executed_by_user else None,
                "executed_by_id": item.executed_by or (test_run.assigned_to if test_run else None),
                "executor_source": "result" if item.executor else ("test_run_assignee" if executed_by_user else None),
                "executed_at": item.executed_at or item.created_at,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
                "comments": item.comments,
                "actual_result": item.actual_result,
                "execution_started_at": item.execution_started_at,
                "execution_time": item.execution_time,
            })
        
        return result

    @app.get("/user/preferences/items-per-page")
    def get_items_per_page_preference(
        current_user: models.User = Depends(get_current_active_user),
        db: Session = Depends(get_db)
    ):
        # Get user's preference for items per page, default to 10
        # For now, return a default value. In a real implementation, this would be stored in a user preferences table
        return {"items_per_page": 10}

    @app.put("/user/preferences/items-per-page")
    def update_items_per_page_preference(
        request: dict,
        current_user: models.User = Depends(get_current_active_user),
        db: Session = Depends(get_db)
    ):
        # Update user's preference for items per page
        items_per_page = request.get("items_per_page")
        if items_per_page is None:
            raise HTTPException(status_code=400, detail="items_per_page field is required")
        
        try:
            items_per_page = int(items_per_page)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="items_per_page must be an integer")
        
        if 5 <= items_per_page <= 100:
            return {"items_per_page": items_per_page}
        else:
            raise HTTPException(status_code=400, detail="Items per page must be between 5 and 100")
