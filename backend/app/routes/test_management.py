"""
Test management routes for test suites, sections, cases, runs, results, and steps.
"""

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, selectinload
from typing import List, Optional
from sqlalchemy import desc, case, func, cast, Date
from datetime import datetime, timedelta, timezone
import logging

from .. import crud, schemas, auth, rbac, models
from ..database import get_db
from ..auth import get_current_active_user, get_current_user
from ..models import TestCase, TestResult, TestRun, User, TestCaseRevision, ResultStatus

logger = logging.getLogger(__name__)


COMPLETED_RESULT_STATUSES = {"pass", "fail", "skip", "block"}


def _normalize_status_value(status: object) -> str:
    return getattr(status, "value", status) or ""


def _is_completed_result_status(status: object) -> bool:
    return _normalize_status_value(status) in COMPLETED_RESULT_STATUSES


def _attach_test_run_progress(db: Session, test_runs: List[TestRun]) -> List[TestRun]:
    run_ids = [run.id for run in test_runs if run and run.id]
    if not run_ids:
        return test_runs

    rows = db.query(
        TestResult.test_run_id,
        TestResult.status,
        func.count(TestResult.id),
    ).filter(
        TestResult.test_run_id.in_(run_ids)
    ).group_by(
        TestResult.test_run_id,
        TestResult.status,
    ).all()

    progress_by_run = {
        run_id: {
            "total_tests": 0,
            "executed_tests": 0,
            "not_tested_tests": 0,
            "passed_tests": 0,
            "failed_tests": 0,
            "blocked_tests": 0,
            "skipped_tests": 0,
        }
        for run_id in run_ids
    }

    status_key_map = {
        "pass": "passed_tests",
        "fail": "failed_tests",
        "block": "blocked_tests",
        "skip": "skipped_tests",
        "not_tested": "not_tested_tests",
        "pending": "not_tested_tests",
    }

    for run_id, status, count in rows:
        normalized_status = _normalize_status_value(status)
        run_progress = progress_by_run.setdefault(run_id, {})
        run_progress["total_tests"] = run_progress.get("total_tests", 0) + count
        if normalized_status in COMPLETED_RESULT_STATUSES:
            run_progress["executed_tests"] = run_progress.get("executed_tests", 0) + count
        key = status_key_map.get(normalized_status)
        if key:
            run_progress[key] = run_progress.get(key, 0) + count

    for run in test_runs:
        run_progress = progress_by_run.get(run.id, {})
        total_tests = run_progress.get("total_tests", 0)
        executed_tests = run_progress.get("executed_tests", 0)
        for key, value in run_progress.items():
            setattr(run, key, value)
        setattr(run, "progress_percent", round((executed_tests / total_tests) * 100) if total_tests else 0)

    return test_runs


def _validate_test_run_assignee(db: Session, user_id: Optional[int], project_id: int) -> Optional[User]:
    if user_id is None:
        return None

    assignee = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not assignee:
        raise HTTPException(status_code=404, detail="Assignee not found")
    if not rbac.has_permission(assignee, "read", project_id, db):
        raise HTTPException(status_code=400, detail="Assignee does not have access to this project")
    return assignee


def _notify_test_run_assignee(db: Session, test_run: TestRun, assigned_by: User, assignee: Optional[User]) -> None:
    if not assignee or not test_run.assigned_to:
        return

    try:
        crud.create_notification(
            db=db,
            notification=schemas.NotificationCreate(
                user_id=assignee.id,
                title="Test run assigned",
                message=f"{assigned_by.full_name or assigned_by.username} assigned test run {test_run.name} to you.",
                type=models.NotificationType.INFO,
                related_entity_type="test_run",
                related_entity_id=test_run.id,
            ),
        )
        logger.info("Created test run assignment notification", extra={"test_run_id": test_run.id, "assignee_id": assignee.id})
    except Exception:
        logger.exception("Failed to create test run assignment notification", extra={"test_run_id": test_run.id, "assignee_id": assignee.id})


def register_test_management_routes(app):
    """Register test management routes with the FastAPI app."""
    
    # Test Suite Endpoints
    @app.post("/test-suites", response_model=schemas.TestSuite)
    def create_test_suite(
        test_suite: schemas.TestSuiteCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Validate project_id is positive
        if test_suite.project_id <= 0:
            raise HTTPException(status_code=400, detail="Invalid project_id")
        
        # Check if the project exists
        project = db.query(models.Project).filter(models.Project.id == test_suite.project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Check if user has permission to create test suite in this project
        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to create test suite in this project")
        
        db_test_suite = crud.create_test_suite(db=db, test_suite=test_suite)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.TEST_SUITE.value,
                entity_id=db_test_suite.id,
                project_id=db_test_suite.project_id,
                description=f"Test suite created: {db_test_suite.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test suite creation: {e}")
        
        return db_test_suite

    @app.get("/test-suites", response_model=List[schemas.TestSuite])
    def read_test_suites(project_id: int = None, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        # If project_id is provided, check project access
        if project_id:
            if not rbac.has_permission(current_user, "read", project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to access this project")
        
        test_suites = crud.get_test_suites(db, project_id=project_id, skip=skip, limit=limit)
        
        # Filter test suites based on user permissions if no project_id specified
        if not project_id:
            # User can only see test suites for projects they have access to
            authorized_suites = []
            for suite in test_suites:
                if rbac.has_permission(current_user, "read", suite.project_id, db):
                    authorized_suites.append(suite)
            return authorized_suites
        
        return test_suites

    @app.get("/test-suites/{test_suite_id}", response_model=schemas.TestSuite)
    def read_test_suite(test_suite_id: int, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        db_test_suite = crud.get_test_suite(db, test_suite_id=test_suite_id)
        if db_test_suite is None:
            raise HTTPException(status_code=404, detail="Test suite not found")
        
        # Check if user has permission to access this test suite's project
        if not rbac.has_permission(current_user, "read", db_test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to access this test suite")
        
        return db_test_suite

    @app.post("/test-suites/{test_suite_id}/test-runs", response_model=schemas.TestSuiteRun)
    def create_test_run_from_suite(
        test_suite_id: int,
        run_data: schemas.TestSuiteRunCreate,
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

        # Create audit trail after the atomic run/result transaction succeeds.
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.TEST_RUN.value,
                entity_id=db_test_run.id,
                project_id=db_test_suite.project_id,
                description=f"Test run created from suite: {db_test_suite.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for suite test run creation: {e}")

        return db_test_run

    @app.put("/test-suites/{test_suite_id}", response_model=schemas.TestSuite)
    def update_test_suite(test_suite_id: int, test_suite: schemas.TestSuiteUpdate, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        # First get the test suite to check project access
        db_test_suite = crud.get_test_suite(db, test_suite_id=test_suite_id)
        if db_test_suite is None:
            raise HTTPException(status_code=404, detail="Test suite not found")
        
        # Check if user has permission to update this test suite's project
        if not rbac.has_permission(current_user, "write", db_test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to update this test suite")
        
        # Perform the update
        db_test_suite = crud.update_test_suite(db, test_suite_id=test_suite_id, test_suite=test_suite)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_SUITE.value,
                entity_id=db_test_suite.id,
                project_id=db_test_suite.project_id,
                description=f"Test suite updated: {db_test_suite.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test suite update: {e}")
        
        return db_test_suite

    @app.delete("/test-suites/{test_suite_id}")
    def delete_test_suite(test_suite_id: int, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        # First get the test suite to check project access
        db_test_suite = crud.get_test_suite(db, test_suite_id=test_suite_id)
        if db_test_suite is None:
            raise HTTPException(status_code=404, detail="Test suite not found")
        
        # Check if user has permission to delete this test suite's project
        if not rbac.has_permission(current_user, "delete", db_test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to delete this test suite")
        
        # Store data for audit trail before deletion
        suite_id = db_test_suite.id
        suite_name = db_test_suite.name
        project_id = db_test_suite.project_id
        
        # Perform the deletion
        db_test_suite = crud.delete_test_suite(db, test_suite_id=test_suite_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.TEST_SUITE.value,
                entity_id=suite_id,
                project_id=project_id,
                description=f"Test suite deleted: {suite_name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test suite deletion: {e}")
        
        return {"message": "Test suite deleted successfully"}

    # Test Case Section Endpoints
    @app.post("/test-case-sections", response_model=schemas.TestCaseSection)
    def create_test_case_section_endpoint(
        section: schemas.TestCaseSectionCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_section = crud.create_test_case_section(db=db, section=section)
        
        # Get project_id for audit trail
        project_id = None
        if db_section.test_suite_id:
            test_suite = crud.get_test_suite(db, test_suite_id=db_section.test_suite_id)
            if test_suite:
                project_id = test_suite.project_id
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.TEST_CASE_SECTION.value,
                entity_id=db_section.id,
                project_id=project_id,
                description=f"Test case section created: {db_section.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test case section creation: {e}")
        
        return db_section





    @app.get("/test-case-sections")
    def read_test_case_sections(
        test_suite_id: Optional[int] = None,
        parent_section_id: Optional[int] = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            sections = crud.get_test_case_sections(db, test_suite_id=test_suite_id, parent_section_id=parent_section_id, skip=skip, limit=limit)
            return [
                {
                    "id": s.id,
                    "name": s.name,
                    "description": s.description,
                    "test_suite_id": s.test_suite_id,
                    "parent_section_id": s.parent_section_id,
                    "order_index": s.order_index,
                    "is_active": s.is_active,
                    "created_at": s.created_at,
                    "updated_at": s.updated_at
                }
                for s in sections
            ]
        except Exception as e:
            # If database query fails due to enum issues, return empty list
            print(f"Database error in read_test_case_sections: {e}")
            return []

    @app.get("/test-case-sections/{section_id}", response_model=schemas.TestCaseSection)
    def read_test_case_section(
        section_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_section = crud.get_test_case_section(db, section_id=section_id)
        if db_section is None:
            raise HTTPException(status_code=404, detail="Test case section not found")
        return db_section

    @app.put("/test-case-sections/{section_id}", response_model=schemas.TestCaseSection)
    def update_test_case_section_endpoint(
        section_id: int,
        section: schemas.TestCaseSectionUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_section = crud.update_test_case_section(db, section_id=section_id, section=section)
        if db_section is None:
            raise HTTPException(status_code=404, detail="Test case section not found")
        
        # Get project_id for audit trail
        project_id = None
        if db_section.test_suite_id:
            test_suite = crud.get_test_suite(db, test_suite_id=db_section.test_suite_id)
            if test_suite:
                project_id = test_suite.project_id
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_CASE_SECTION.value,
                entity_id=db_section.id,
                project_id=project_id,
                description=f"Test case section updated: {db_section.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test case section update: {e}")
        
        return db_section

    @app.delete("/test-case-sections/{section_id}")
    def delete_test_case_section(
        section_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "delete"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Get section before deletion for audit trail
        db_section = crud.get_test_case_section(db, section_id=section_id)
        if db_section is None:
            raise HTTPException(status_code=404, detail="Test case section not found")
        
        # Store data for audit trail
        section_id_val = db_section.id
        section_name = db_section.name
        project_id = None
        if db_section.test_suite_id:
            test_suite = crud.get_test_suite(db, test_suite_id=db_section.test_suite_id)
            if test_suite:
                project_id = test_suite.project_id
        
        # Perform the deletion
        db_section = crud.delete_test_case_section(db, section_id=section_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.TEST_CASE_SECTION.value,
                entity_id=section_id_val,
                project_id=project_id,
                description=f"Test case section deleted: {section_name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test case section deletion: {e}")
        
        return {"message": "Test case section deleted successfully"}

    # Test Case Endpoints
    @app.post("/test-cases", response_model=schemas.TestCaseWithRelations)
    def create_test_case(
        test_case: schemas.TestCaseCreate, 
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Ensure default priority and test type definitions exist if they are blank in the DB
        crud.ensure_default_priority_and_test_type_definitions(db, current_user.id)
        
        # Validate that the test suite exists
        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found")
        
        # Ensure default environment definitions exist for the project
        crud.ensure_default_environment_definitions(db, test_suite.project_id, current_user.id)
        
        # Test suites are already required to be in projects, so this ensures
        # all test cases are assigned to projects through their test suite
        db_test_case = crud.create_test_case(db=db, test_case=test_case, created_by=current_user.id)

        try:
            initial_revision_data = {
                "test_case_id": db_test_case.id,
                "title": db_test_case.title,
                "description": db_test_case.description,
                "test_type": db_test_case.test_type,
                "preconditions": db_test_case.preconditions,
                "steps": db_test_case.steps,
                "expected_result": db_test_case.expected_result,
                "priority": db_test_case.priority,
                "tags": db_test_case.tags,
                "changed_fields": {"created": "created"},
                "change_reason": "Initial version",
                "created_by": current_user.id,
            }
            crud.create_test_case_revision(db, schemas.TestCaseRevisionCreate(**initial_revision_data))
        except Exception as e:
            logger.error("Failed to create initial revision for test case %s: %s", db_test_case.id, e)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            project_id = test_suite.project_id if test_suite else None
            audit_data = AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.TEST_CASE.value,
                entity_id=db_test_case.id,
                project_id=project_id,
                description=f"Test case created: {db_test_case.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test case creation: {e}")
        
        return db_test_case

    @app.get("/test-cases", response_model=List[schemas.TestCaseWithRelations])
    def read_test_cases(
        project_id: int = None,
        test_suite_id: int = None, 
        section_id: int = None, 
        skip: int = 0, 
        limit: int = 100,
        sort_by: str = "id",
        sort_order: str = "asc",
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # If project_id is provided, check project access
        if project_id:
            if not rbac.has_permission(current_user, "read", project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to access this project")
        
        # If project_id is provided, filter test cases by project
        if project_id:
            query = db.query(models.TestCase).options(
                joinedload(models.TestCase.test_suite).joinedload(models.TestSuite.project),
                joinedload(models.TestCase.section),
                joinedload(models.TestCase.creator),
                selectinload(models.TestCase.custom_field_values)
            ).join(models.TestSuite).filter(
                models.TestSuite.project_id == project_id
            )
            if test_suite_id:
                query = query.filter(models.TestCase.test_suite_id == test_suite_id)
            if section_id:
                query = query.filter(models.TestCase.section_id == section_id)
            
            # Apply sorting
            if sort_by == "created_at":
                if sort_order == "desc":
                    query = query.order_by(models.TestCase.created_at.desc())
                else:
                    query = query.order_by(models.TestCase.created_at.asc())
            elif sort_by == "updated_at":
                if sort_order == "desc":
                    query = query.order_by(models.TestCase.updated_at.desc())
                else:
                    query = query.order_by(models.TestCase.updated_at.asc())
            elif sort_by == "title":
                if sort_order == "desc":
                    query = query.order_by(models.TestCase.title.desc())
                else:
                    query = query.order_by(models.TestCase.title.asc())
            elif sort_by == "id":
                if sort_order == "desc":
                    query = query.order_by(models.TestCase.id.desc())
                else:
                    query = query.order_by(models.TestCase.id.asc())
            else:
                # Default sort by id
                query = query.order_by(models.TestCase.id.asc())
                
            test_cases = query.offset(skip).limit(limit).all()
        else:
            test_cases = crud.get_test_cases(db, test_suite_id=test_suite_id, section_id=section_id, skip=skip, limit=limit)
            
            # Filter test cases based on user permissions if no project_id specified
            authorized_cases = []
            for case in test_cases:
                # Get the test suite to check project access
                test_suite = crud.get_test_suite(db, test_suite_id=case.test_suite_id)
                if test_suite and rbac.has_permission(current_user, "read", test_suite.project_id, db):
                    authorized_cases.append(case)
            test_cases = authorized_cases
        
        return test_cases

    @app.get("/test-cases/count")
    def get_test_cases_count(
        project_id: int = None,
        test_suite_id: int = None, 
        section_id: int = None,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # If project_id is provided, filter test cases by project and check authorization
        if project_id:
            # Check if user has permission to access this project
            if not rbac.has_permission(current_user, "read", project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to access this project")
            
            query = db.query(models.TestCase).join(models.TestSuite).filter(
                models.TestSuite.project_id == project_id
            )
            if test_suite_id:
                query = query.filter(models.TestCase.test_suite_id == test_suite_id)
            if section_id:
                query = query.filter(models.TestCase.section_id == section_id)
            count = query.count()
        else:
            # Use existing logic from crud
            query = db.query(models.TestCase)
            if test_suite_id:
                query = query.filter(models.TestCase.test_suite_id == test_suite_id)
            if section_id:
                query = query.filter(models.TestCase.section_id == section_id)
            count = query.count()
        return {"count": count}

    @app.get("/test-cases/{test_case_id}", response_model=schemas.TestCaseWithRelations)
    def read_test_case(test_case_id: int, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        db_test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if db_test_case is None:
            raise HTTPException(status_code=404, detail="Test case not found")
        
        # Get the test suite to check project access
        test_suite = crud.get_test_suite(db, test_suite_id=db_test_case.test_suite_id)
        if test_suite:
            # Check if user has permission to access this test case's project
            if not rbac.has_permission(current_user, "read", test_suite.project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to access this test case")
        
        return db_test_case

    @app.put("/test-cases/{test_case_id}", response_model=schemas.TestCaseWithRelations)
    def update_test_case(
        test_case_id: int,
        test_case: schemas.TestCaseUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        # Get the original test case before update
        original_test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if not original_test_case:
            raise HTTPException(status_code=404, detail="Test case not found")
        
        # Get the test suite to check project access
        test_suite = crud.get_test_suite(db, test_suite_id=original_test_case.test_suite_id)
        if test_suite:
            # Check if user has permission to update this test case's project
            if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to update this test case")
        
        # If updating test_suite_id, validate that the new test suite exists and check access
        if test_case.test_suite_id is not None:
            new_test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
            if not new_test_suite:
                raise HTTPException(status_code=404, detail="Test suite not found")
            # Check if user has permission to write to the new project
            if not rbac.has_permission(current_user, "write", new_test_suite.project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to move test case to this project")

        # Store original data BEFORE the update
        original_data = {
            'title': original_test_case.title,
            'description': original_test_case.description,
            'test_type': original_test_case.test_type,
            'preconditions': original_test_case.preconditions,
            'steps': original_test_case.steps,
            'expected_result': original_test_case.expected_result,
            'priority': original_test_case.priority,
            'status': original_test_case.status,
            'tags': original_test_case.tags,
            'section_id': original_test_case.section_id,
            'test_suite_id': original_test_case.test_suite_id
        }

        # Update the test case
        db_test_case = crud.update_test_case(db, test_case_id=test_case_id, test_case=test_case)
        if db_test_case is None:
            raise HTTPException(status_code=404, detail="Test case not found")

        # Create a revision record
        try:
            # Determine which fields were changed
            changed_fields = []
            update_data = test_case.model_dump(exclude_unset=True)
            
            for field, new_value in update_data.items():
                old_value = original_data.get(field)
                # Handle string comparison for None/empty values
                if old_value is None:
                    old_value = None
                if new_value is None:
                    new_value = None
                
                # Convert to string for comparison to handle type differences
                old_str = str(old_value) if old_value is not None else ''
                new_str = str(new_value) if new_value is not None else ''
                
                if old_str != new_str:
                    changed_fields.append(field)
            
            if changed_fields:
                revision_data = {
                    "test_case_id": test_case_id,
                    "title": db_test_case.title,
                    "description": db_test_case.description,
                    "test_type": db_test_case.test_type,
                    "preconditions": db_test_case.preconditions,
                    "steps": db_test_case.steps,
                    "expected_result": db_test_case.expected_result,
                    "priority": db_test_case.priority,
                    "tags": db_test_case.tags,
                    "changed_fields": {field: "updated" for field in changed_fields},
                    "change_reason": f"Updated fields: {', '.join(changed_fields)}",
                    "created_by": current_user.id
                }
                
                crud.create_test_case_revision(db, schemas.TestCaseRevisionCreate(**revision_data))
        except Exception as e:
            # Log error but don't fail the update
            print(f"Failed to create revision: {e}")

        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            project_id = original_test_case.project_id if original_test_case else None
            audit_data = AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_CASE.value,
                entity_id=db_test_case.id,
                project_id=project_id,
                description=f"Test case updated: {db_test_case.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test case update: {e}")

        return db_test_case

    @app.delete("/test-cases/{test_case_id}")
    def delete_test_case(
        test_case_id: int, 
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Get test case before deleting for audit trail
        db_test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if db_test_case is None:
            raise HTTPException(status_code=404, detail="Test case not found")
        
        # Get project_id for audit trail
        project_id = None
        if db_test_case.test_suite_id:
            suite = crud.get_test_suite(db, test_suite_id=db_test_case.test_suite_id)
            if suite:
                project_id = suite.project_id
        
        test_case_title = db_test_case.title
        
        # Delete the test case
        crud.delete_test_case(db, test_case_id=test_case_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.TEST_CASE.value,
                entity_id=test_case_id,
                project_id=project_id,
                description=f"Test case deleted: {test_case_title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test case deletion: {e}")
        
        return {"message": "Test case deleted successfully"}

    @app.get("/test-cases/{test_case_id}/revisions")
    def get_test_case_revisions(
        test_case_id: int,
        db: Session = Depends(get_db),
        current_user: models.User = Depends(get_current_user)
    ):
        """Get revision history for a test case (admin and manager only)"""
        from sqlalchemy.orm import joinedload, selectinload
        
        # Check if user is admin or manager (handle both string and enum)
        user_role = str(current_user.role).upper()
        if user_role not in ["ADMIN", "MANAGER"]:
            raise HTTPException(
                status_code=403, 
                detail="Only administrators and managers can view revision history"
            )
        
        revisions = db.query(TestCaseRevision).options(
            joinedload(TestCaseRevision.creator)
        ).filter(
            TestCaseRevision.test_case_id == test_case_id
        ).order_by(TestCaseRevision.revision_number.desc()).all()
        
        return revisions

    @app.post("/test-cases/{test_case_id}/revisions/{revision_number}/restore", response_model=schemas.TestCaseWithRelations)
    def restore_test_case_revision(
        test_case_id: int,
        revision_number: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Restore editable test case fields from a saved revision."""
        user_role = str(current_user.role).upper()
        if user_role not in ["ADMIN", "MANAGER"]:
            raise HTTPException(
                status_code=403,
                detail="Only administrators and managers can restore revision history"
            )

        db_test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if not db_test_case:
            raise HTTPException(status_code=404, detail="Test case not found")

        test_suite = crud.get_test_suite(db, test_suite_id=db_test_case.test_suite_id)
        if test_suite and not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to restore this test case")

        revision = db.query(TestCaseRevision).filter(
            TestCaseRevision.test_case_id == test_case_id,
            TestCaseRevision.revision_number == revision_number,
        ).first()
        if not revision:
            raise HTTPException(status_code=404, detail="Test case revision not found")

        def enum_value(value: object) -> object:
            return getattr(value, "value", value)

        restore_data = {
            "title": revision.title,
            "description": revision.description,
            "test_type": enum_value(revision.test_type),
            "preconditions": revision.preconditions,
            "steps": revision.steps,
            "expected_result": revision.expected_result,
            "priority": enum_value(revision.priority),
            "tags": revision.tags,
        }

        changed_fields = []
        for field, new_value in restore_data.items():
            old_value = getattr(db_test_case, field)
            if str(old_value or "") != str(new_value or ""):
                changed_fields.append(field)

        if not changed_fields:
            return db_test_case

        updated_test_case = crud.update_test_case(
            db,
            test_case_id=test_case_id,
            test_case=schemas.TestCaseUpdate(**restore_data),
        )
        if not updated_test_case:
            raise HTTPException(status_code=404, detail="Test case not found")

        try:
            revision_data = {
                "test_case_id": test_case_id,
                "title": updated_test_case.title,
                "description": updated_test_case.description,
                "test_type": updated_test_case.test_type,
                "preconditions": updated_test_case.preconditions,
                "steps": updated_test_case.steps,
                "expected_result": updated_test_case.expected_result,
                "priority": updated_test_case.priority,
                "tags": updated_test_case.tags,
                "changed_fields": {field: "restored" for field in changed_fields},
                "change_reason": f"Restored revision {revision_number}: {', '.join(changed_fields)}",
                "created_by": current_user.id,
            }
            crud.create_test_case_revision(db, schemas.TestCaseRevisionCreate(**revision_data))
        except Exception as e:
            logger.error("Failed to create restore revision for test case %s: %s", test_case_id, e)

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_service.create_audit_trail(AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_CASE.value,
                entity_id=updated_test_case.id,
                project_id=test_suite.project_id if test_suite else None,
                description=f"Test case restored to revision {revision_number}: {updated_test_case.title or 'Untitled'}",
            ))
        except Exception as e:
            logger.error("Failed to create audit trail for test case restore: %s", e)

        return updated_test_case

    # Test Run Endpoints
    @app.post("/test-runs", response_model=schemas.TestRun)
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

        assignee = _validate_test_run_assignee(db, test_run.assigned_to, test_run.project_id)
        db_test_run = crud.create_test_run(db=db, test_run=test_run)
        _attach_test_run_progress(db, [db_test_run])
        _notify_test_run_assignee(db, db_test_run, current_user, assignee)
        
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
            print(f"Failed to create audit trail for test run creation: {e}")
        
        return db_test_run

    @app.get("/test-runs", response_model=List[schemas.TestRun])
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
        if "assigned_to" in changed_fields:
            assignee = _validate_test_run_assignee(db, changed_fields.get("assigned_to"), db_test_run.project_id)

        if changed_fields.get("status") == "completed" and "completed_at" not in changed_fields:
            test_run.completed_at = datetime.now(timezone.utc)
        elif changed_fields.get("status") in {"pending", "running", "in_progress"} and "completed_at" not in changed_fields:
            test_run.completed_at = None
        
        # Perform the update
        db_test_run = crud.update_test_run(db, test_run_id=test_run_id, test_run=test_run)
        _attach_test_run_progress(db, [db_test_run])

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
            print(f"Failed to create audit trail for test run update: {e}")
        
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

    @app.delete("/test-runs/{test_run_id}")
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
            print(f"Failed to create audit trail for test run deletion: {e}")
        
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
                print(f"Failed to create audit trail for test run time reset: {e}")
            
            return {
                "message": "Test run time reset successfully",
                "test_run_id": test_run_id,
                "test_results_reset": len(test_results)
            }
            
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to reset test run time: {str(e)}")

    @app.get("/projects/{project_id}/sections/hierarchy")
    def get_project_section_hierarchy(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        try:
            # Get all test suites for the project
            test_suites = db.query(models.TestSuite).filter(models.TestSuite.project_id == project_id).all()
            
            hierarchy = []
            
            for suite in test_suites:
                # Get root sections (no parent) for this test suite
                root_sections = db.query(models.TestCaseSection).filter(
                    models.TestCaseSection.test_suite_id == suite.id,
                    models.TestCaseSection.parent_section_id.is_(None)
                ).all()
                
                def build_hierarchy(section):
                    subsections = db.query(models.TestCaseSection).filter(
                        models.TestCaseSection.parent_section_id == section.id
                    ).all()
                    return {
                        "id": section.id,
                        "name": section.name,
                        "description": section.description,
                        "test_case_count": db.query(models.TestCase).filter(models.TestCase.section_id == section.id).count(),
                        "subsections": [build_hierarchy(sub) for sub in subsections]
                    }
                
                suite_hierarchy = {
                    "test_suite": {
                        "id": suite.id,
                        "name": suite.name,
                        "description": suite.description
                    },
                    "sections": [build_hierarchy(section) for section in root_sections]
                }
                
                hierarchy.append(suite_hierarchy)
            
            return {"project_id": project_id, "hierarchy": hierarchy}
        
        except Exception as e:
            # If database query fails due to enum issues, return empty hierarchy
            print(f"Database error in get_project_section_hierarchy: {e}")
            return {"project_id": project_id, "hierarchy": []}

    # Test Case Steps Endpoints
    @app.get("/test-cases/{test_case_id}/steps", response_model=List[schemas.TestCaseStep])
    def get_test_case_steps_endpoint(
        test_case_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if test_case is None:
            raise HTTPException(status_code=404, detail="Test case not found")
        
        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not rbac.has_permission(current_user, "read", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.get_test_case_steps(db, test_case_id=test_case_id)

    @app.get("/test-cases/{test_case_id}/with-steps", response_model=schemas.TestCaseWithRelations)
    def get_test_case_with_steps_endpoint(
        test_case_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_case = crud.get_test_case_with_steps(db, test_case_id=test_case_id)
        if test_case is None:
            raise HTTPException(status_code=404, detail="Test case not found")
        
        if not rbac.has_permission(current_user, "read", test_case.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return test_case

    @app.post("/test-cases/{test_case_id}/steps", response_model=List[schemas.TestCaseStep])
    def create_test_case_steps_endpoint(
        test_case_id: int,
        steps: List[schemas.TestCaseStepCreate],
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if test_case is None:
            raise HTTPException(status_code=404, detail="Test case not found")
        
        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        if steps:
            crud.update_test_case(db, test_case_id, schemas.TestCaseUpdate(is_multistep=True))
        
        return crud.create_test_case_steps(db, test_case_id=test_case_id, steps=steps)

    @app.put("/test-case-steps/{step_id}", response_model=schemas.TestCaseStep)
    def update_test_case_step_endpoint(
        step_id: int,
        step: schemas.TestCaseStepUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_step = crud.get_test_case_step(db, step_id=step_id)
        if db_step is None:
            raise HTTPException(status_code=404, detail="Test case step not found")
        
        test_case = crud.get_test_case(db, test_case_id=db_step.test_case_id)
        if not rbac.has_permission(current_user, "write", test_case.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.update_test_case_step(db, step_id=step_id, step=step)

    @app.delete("/test-case-steps/{step_id}")
    def delete_test_case_step_endpoint(
        step_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_step = crud.get_test_case_step(db, step_id=step_id)
        if db_step is None:
            raise HTTPException(status_code=404, detail="Test case step not found")
        
        test_case = crud.get_test_case(db, test_case_id=db_step.test_case_id)
        if not rbac.has_permission(current_user, "delete", test_case.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        crud.delete_test_case_step(db, step_id=step_id)
        return {"message": "Test case step deleted successfully"}

    # Test Mindmaps Endpoints
    @app.post("/test-mindmaps/", response_model=schemas.TestMindmap)
    def create_test_mindmap(
        mindmap: schemas.TestMindmapCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", mindmap.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.create_test_mindmap(db=db, mindmap=mindmap.model_dump())

    @app.get("/test-mindmaps/", response_model=List[schemas.TestMindmap])
    def read_test_mindmaps(
        project_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.get_test_mindmaps(db, project_id=project_id, skip=skip, limit=limit)

    @app.get("/test-mindmaps/{mindmap_id}", response_model=schemas.TestMindmap)
    def read_test_mindmap(
        mindmap_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        mindmap = crud.get_test_mindmap(db, mindmap_id=mindmap_id)
        if mindmap is None:
            raise HTTPException(status_code=404, detail="Test mindmap not found")
        
        if not rbac.has_permission(current_user, "read", mindmap.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return mindmap

    @app.put("/test-mindmaps/{mindmap_id}", response_model=schemas.TestMindmap)
    def update_test_mindmap(
        mindmap_id: int,
        mindmap: schemas.TestMindmapUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_mindmap = crud.get_test_mindmap(db, mindmap_id=mindmap_id)
        if db_mindmap is None:
            raise HTTPException(status_code=404, detail="Test mindmap not found")
        
        if not rbac.has_permission(current_user, "write", db_mindmap.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.update_test_mindmap(db, mindmap_id=mindmap_id, mindmap=mindmap.model_dump(exclude_unset=True))

    @app.delete("/test-mindmaps/{mindmap_id}")
    def delete_test_mindmap(
        mindmap_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_mindmap = crud.get_test_mindmap(db, mindmap_id=mindmap_id)
        if db_mindmap is None:
            raise HTTPException(status_code=404, detail="Test mindmap not found")
        
        if not rbac.has_permission(current_user, "delete", db_mindmap.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        crud.delete_test_mindmap(db, mindmap_id=mindmap_id)
        return {"message": "Test mindmap deleted successfully"}

    # Impact Analysis Endpoints
    @app.post("/impact-analyses/", response_model=schemas.ImpactAnalysis)
    def create_impact_analysis(
        analysis: schemas.ImpactAnalysisCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", analysis.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.create_impact_analysis(db=db, analysis=analysis.model_dump())

    @app.get("/impact-analyses/", response_model=List[schemas.ImpactAnalysis])
    def read_impact_analyses(
        project_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.get_impact_analyses(db, project_id=project_id, skip=skip, limit=limit)

    @app.get("/impact-analyses/{analysis_id}", response_model=schemas.ImpactAnalysis)
    def read_impact_analysis(
        analysis_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        analysis = crud.get_impact_analysis(db, analysis_id=analysis_id)
        if analysis is None:
            raise HTTPException(status_code=404, detail="Impact analysis not found")
        
        if not rbac.has_permission(current_user, "read", analysis.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return analysis

    @app.put("/impact-analyses/{analysis_id}", response_model=schemas.ImpactAnalysis)
    def update_impact_analysis(
        analysis_id: int,
        analysis: schemas.ImpactAnalysisUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_analysis = crud.get_impact_analysis(db, analysis_id=analysis_id)
        if db_analysis is None:
            raise HTTPException(status_code=404, detail="Impact analysis not found")
        
        if not rbac.has_permission(current_user, "write", db_analysis.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.update_impact_analysis(db, analysis_id=analysis_id, analysis=analysis.model_dump(exclude_unset=True))

    @app.delete("/impact-analyses/{analysis_id}")
    def delete_impact_analysis(
        analysis_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_analysis = crud.get_impact_analysis(db, analysis_id=analysis_id)
        if db_analysis is None:
            raise HTTPException(status_code=404, detail="Impact analysis not found")
        
        if not rbac.has_permission(current_user, "delete", db_analysis.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        crud.delete_impact_analysis(db, analysis_id=analysis_id)
        return {"message": "Impact analysis deleted successfully"}

    @app.post("/impact-analyses/generate")
    def generate_impact_analysis(
        test_case_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if not test_case:
            raise HTTPException(status_code=404, detail="Test case not found")
        
        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not rbac.has_permission(current_user, "read", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Generate impact analysis (simplified version)
        analysis = crud.create_impact_analysis(db, analysis={
            "title": f"Impact Analysis for Test Case {test_case_id}",
            "project_id": test_suite.project_id,
            "created_by": current_user.id,
            "affected_test_cases": [test_case_id]
        })
        return analysis

    # Section Management Endpoints (different from test-case-sections)
    @app.get("/sections/")
    def get_sections(
        test_suite_id: int = None,
        parent_section_id: int = None,
        project_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        query = db.query(models.TestCaseSection)
        
        if test_suite_id:
            query = query.filter(models.TestCaseSection.test_suite_id == test_suite_id)
        if parent_section_id:
            query = query.filter(models.TestCaseSection.parent_section_id == parent_section_id)
        if project_id:
            query = query.join(models.TestSuite).filter(models.TestSuite.project_id == project_id)
        
        sections = query.offset(skip).limit(limit).all()
        return [
            {
                "id": s.id,
                "name": s.name,
                "description": s.description,
                "test_suite_id": s.test_suite_id,
                "parent_section_id": s.parent_section_id,
                "order_index": s.order_index,
                "is_active": s.is_active,
                "created_at": s.created_at,
                "updated_at": s.updated_at
            }
            for s in sections
        ]

    @app.get("/sections/{section_id}", response_model=schemas.TestCaseSection)
    def get_section(
        section_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        section = db.query(models.TestCaseSection).filter(models.TestCaseSection.id == section_id).first()
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")
        return section

    @app.get("/sections/{section_id}/tree")
    def get_section_tree(
        section_id: int,
        include_test_cases: bool = True,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Get the root section
        root_section = db.query(models.TestCaseSection).filter(models.TestCaseSection.id == section_id).first()
        if not root_section:
            raise HTTPException(status_code=404, detail="Section not found")
        
        def build_section_tree(section, parent_id=None):
            # Get subsections
            subsections = db.query(models.TestCaseSection).filter(
                models.TestCaseSection.parent_section_id == section.id
            ).all()
            
            section_data = {
                "id": section.id,
                "name": section.name,
                "description": section.description,
                "test_suite_id": section.test_suite_id,
                "parent_section_id": section.parent_section_id,
                "created_at": section.created_at,
                "updated_at": section.updated_at,
                "subsections": []
            }
            
            # Add test cases if requested
            if include_test_cases:
                test_cases = db.query(models.TestCase).filter(
                    models.TestCase.section_id == section.id
                ).all()
                section_data["test_cases"] = [
                    {
                        "id": tc.id,
                        "title": tc.title,
                        "description": tc.description,
                        "priority": tc.priority,
                        "status": tc.status,
                        "created_at": tc.created_at,
                        "updated_at": tc.updated_at
                    }
                    for tc in test_cases
                ]
            
            # Recursively build subsections
            for subsection in subsections:
                section_data["subsections"].append(build_section_tree(subsection, section.id))
            
            return section_data
        
        return build_section_tree(root_section)

    @app.get("/sections/{section_id}/details")
    def get_section_details(
        section_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        section = db.query(models.TestCaseSection).filter(models.TestCaseSection.id == section_id).first()
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")
        
        # Get test suite for permission check
        test_suite = db.query(models.TestSuite).filter(models.TestSuite.id == section.test_suite_id).first()
        if not rbac.has_permission(current_user, "read", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Get test case count
        test_case_count = db.query(models.TestCase).filter(models.TestCase.section_id == section_id).count()
        
        # Get subsection count
        subsection_count = db.query(models.TestCaseSection).filter(
            models.TestCaseSection.parent_section_id == section_id
        ).count()
        
        return {
            "id": section.id,
            "name": section.name,
            "description": section.description,
            "test_suite_id": section.test_suite_id,
            "parent_section_id": section.parent_section_id,
            "order_index": section.order_index,
            "is_active": section.is_active,
            "test_case_count": test_case_count,
            "subsection_count": subsection_count,
            "created_at": section.created_at,
            "updated_at": section.updated_at
        }

    @app.post("/sections/", response_model=schemas.TestCaseSection)
    def create_section(
        section: schemas.TestCaseSectionCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_suite = db.query(models.TestSuite).filter(models.TestSuite.id == section.test_suite_id).first()
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found")
        
        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.create_test_case_section(db=db, section=section)

    @app.put("/sections/{section_id}", response_model=schemas.TestCaseSection)
    def update_section(
        section_id: int,
        section: schemas.TestCaseSectionUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_section = db.query(models.TestCaseSection).filter(models.TestCaseSection.id == section_id).first()
        if not db_section:
            raise HTTPException(status_code=404, detail="Section not found")
        
        test_suite = db.query(models.TestSuite).filter(models.TestSuite.id == db_section.test_suite_id).first()
        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.update_test_case_section(db, section_id=section_id, section=section)

    @app.delete("/sections/{section_id}")
    def delete_section(
        section_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_section = db.query(models.TestCaseSection).filter(models.TestCaseSection.id == section_id).first()
        if not db_section:
            raise HTTPException(status_code=404, detail="Section not found")
        
        test_suite = db.query(models.TestSuite).filter(models.TestSuite.id == db_section.test_suite_id).first()
        if not rbac.has_permission(current_user, "delete", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        crud.delete_test_case_section(db, section_id=section_id)
        return {"message": "Section deleted successfully"}

    @app.get("/test-runs/{test_run_id}/statistics", response_model=schemas.TestRunStatistics)
    def get_test_run_statistics(
        test_run_id: int, 
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        from ..models import ResultStatus
        
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

    # Test Result Endpoints
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
            print(f"Failed to create audit trail for test result creation: {e}")
        
        return db_test_result

    @app.get("/test-results", response_model=List[schemas.TestResultWithDetails])
    def read_test_results(test_run_id: int = None, test_case_id: int = None, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: schemas.User = Depends(get_current_active_user)):
        test_results = crud.get_test_results(db, test_run_id=test_run_id, test_case_id=test_case_id, skip=skip, limit=limit)
        return test_results

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

    @app.delete("/test-results/{test_result_id}")
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

    # Pause/Resume Execution Endpoints
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
                print(f"Failed to create audit trail for test result time reset: {e}")
            
            return {
                "message": "Test result time reset successfully",
                "test_result_id": test_result_id
            }
            
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to reset test result time: {str(e)}")

    @app.get("/test-cases/{test_case_id}/execution-history")
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

    # User Preferences
    @app.get("/user/preferences/items-per-page")
    def get_items_per_page_preference(
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db)
    ):
        # Get user's preference for items per page, default to 10
        # For now, return a default value. In a real implementation, this would be stored in a user preferences table
        return {"items_per_page": 10}

    @app.put("/user/preferences/items-per-page")
    def update_items_per_page_preference(
        request: dict,
        current_user: models.User = Depends(get_current_user),
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
