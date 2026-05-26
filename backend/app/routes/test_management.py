"""
Test management routes for test suites, sections, cases, runs, results, and steps.
"""

from fastapi import Depends, File, Form, HTTPException, Path, Query, UploadFile
from sqlalchemy.orm import Session, joinedload, selectinload
from typing import List, Optional
from sqlalchemy import desc, case, func, cast, Date
from datetime import datetime, timedelta, timezone
import logging
import re

from .. import crud, schemas, auth, rbac, models
from ..database import get_db
from ..auth import get_current_active_user, get_current_user
from ..models import TestCase, TestResult, TestRun, User, TestCaseRevision, ResultStatus

logger = logging.getLogger(__name__)


COMPLETED_RESULT_STATUSES = {"pass", "fail", "skip", "block"}


def _enum_value(value: object) -> str:
    return getattr(value, "value", value) or ""


def _section_is_descendant_of(db: Session, candidate_id: int, ancestor_id: int) -> bool:
    """Return True if `candidate_id` is the same as `ancestor_id` or sits below it
    in the section tree. Used to block parent updates that would create a cycle."""
    if candidate_id == ancestor_id:
        return True
    current_id: Optional[int] = candidate_id
    # Walk up to 64 levels — far past any realistic project nesting; guards against
    # any pre-existing cycle in the data so the check still terminates.
    for _ in range(64):
        row = (
            db.query(models.TestCaseSection.parent_section_id)
            .filter(models.TestCaseSection.id == current_id)
            .first()
        )
        if not row or row[0] is None:
            return False
        if row[0] == ancestor_id:
            return True
        current_id = row[0]
    return False


_REFERENCE_TOKEN_PATTERN = re.compile(r"^[a-z][a-z0-9]*-\d+$", flags=re.IGNORECASE)


def _reference_tokens(value: Optional[str]) -> set[str]:
    """Extract requirement-id-like tokens (LETTER+DIGITS pattern) from a reference string.

    Only returns tokens that match the canonical requirement-id shape (e.g. REQ-123,
    USR-7), to avoid pulling in incidental hyphen+digit fragments like 'node-12'.
    """
    raw_value = value or ""
    candidates: set[str] = set()
    for token in re.split(r"[\s,;|]+", raw_value):
        cleaned = token.strip("()[]{}\"'.,").lower()
        if cleaned and _REFERENCE_TOKEN_PATTERN.match(cleaned):
            candidates.add(cleaned)
    return candidates


def _validate_test_run_scope(
    db: Session,
    *,
    project_id: int,
    test_plan_id: Optional[int],
    milestone_id: Optional[int],
) -> None:
    """Ensure optional test-run links belong to the same project."""
    linked_plan = None
    if test_plan_id is not None:
        linked_plan = db.query(models.TestPlan).filter(models.TestPlan.id == test_plan_id).first()
        if linked_plan is None:
            raise HTTPException(status_code=404, detail="Test plan not found")
        if linked_plan.project_id != project_id:
            raise HTTPException(status_code=400, detail="Test plan does not belong to this project")

    if milestone_id is not None:
        milestone = db.query(models.Milestone).filter(models.Milestone.id == milestone_id).first()
        if milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")
        if milestone.project_id != project_id:
            raise HTTPException(status_code=400, detail="Milestone does not belong to this project")

    if linked_plan is not None and linked_plan.milestone_id is not None and milestone_id is not None:
        if linked_plan.milestone_id != milestone_id:
            raise HTTPException(status_code=400, detail="Test plan is linked to a different milestone")


def _get_test_case_linked_requirements(db: Session, test_case: TestCase, project_id: int) -> List[schemas.TestCaseLinkedRequirement]:
    requirement_ids = {
        row[0]
        for row in db.query(models.requirement_test_case_links.c.requirement_id).filter(
            models.requirement_test_case_links.c.test_case_id == test_case.id,
        ).all()
        if row[0] is not None
    }
    requirement_ids.update(
        row[0]
        for row in db.query(models.TraceabilityMatrix.requirement_id).filter(
            models.TraceabilityMatrix.test_case_id == test_case.id,
        ).all()
        if row[0] is not None
    )

    reference_tokens = _reference_tokens(test_case.reference)

    query = db.query(models.Requirement).filter(models.Requirement.project_id == project_id)
    if requirement_ids and reference_tokens:
        query = query.filter(
            models.Requirement.id.in_(requirement_ids)
            | func.lower(models.Requirement.requirement_id).in_(reference_tokens)
        )
    elif requirement_ids:
        query = query.filter(models.Requirement.id.in_(requirement_ids))
    elif reference_tokens:
        query = query.filter(func.lower(models.Requirement.requirement_id).in_(reference_tokens))
    else:
        return []

    requirements = query.order_by(models.Requirement.requirement_id.asc()).all()

    seen: set[int] = set()
    results: List[schemas.TestCaseLinkedRequirement] = []
    for requirement in requirements:
        if requirement.id in seen:
            continue
        seen.add(requirement.id)
        results.append(
            schemas.TestCaseLinkedRequirement(
                id=requirement.id,
                requirement_id=requirement.requirement_id,
                title=requirement.title,
                status=_enum_value(requirement.status),
                priority=_enum_value(requirement.priority),
                description=requirement.description,
                acceptance_criteria=requirement.acceptance_criteria,
            )
        )
    return results


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
        except Exception:
            logger.exception("Failed to create audit trail for test suite creation")

        return db_test_suite

    @app.get("/test-suites", response_model=List[schemas.TestSuite])
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

        # Project-less listings still have to be filtered per user, but at least the
        # earlier path now hits the DB once with proper scoping.
        if project_id is None:
            test_suites = [
                suite for suite in test_suites
                if rbac.has_permission(current_user, "read", suite.project_id, db)
            ]

        suite_ids = [suite.id for suite in test_suites]
        counts = crud.get_test_case_counts_by_suite(db, suite_ids)
        for suite in test_suites:
            suite.test_case_count = counts.get(suite.id, 0)

        return test_suites

    @app.get("/test-suites/{test_suite_id}", response_model=schemas.TestSuite)
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

    @app.post("/test-suites/{test_suite_id}/test-runs", response_model=schemas.TestSuiteRun)
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
        except Exception:
            logger.exception("Failed to create audit trail for suite test run creation")

        return db_test_run

    @app.put("/test-suites/{test_suite_id}", response_model=schemas.TestSuite)
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
        except Exception:
            logger.exception("Failed to create audit trail for test suite update")

        return db_test_suite

    @app.delete("/test-suites/{test_suite_id}")
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
        except Exception:
            logger.exception("Failed to create audit trail for test suite deletion")

        return {"message": "Test suite deleted successfully"}

    # Test Case Section Endpoints
    @app.post("/test-case-sections", response_model=schemas.TestCaseSection)
    def create_test_case_section_endpoint(
        section: schemas.TestCaseSectionCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if section.test_suite_id is None or section.test_suite_id <= 0:
            raise HTTPException(status_code=400, detail="Invalid test_suite_id")

        test_suite = crud.get_test_suite(db, test_suite_id=section.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found")
        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # If a parent section is provided, it must belong to the same test suite
        if section.parent_section_id:
            parent = crud.get_test_case_section(db, section_id=section.parent_section_id)
            if not parent:
                raise HTTPException(status_code=404, detail="Parent section not found")
            if parent.test_suite_id != section.test_suite_id:
                raise HTTPException(
                    status_code=400,
                    detail="Parent section must belong to the same test suite",
                )

        db_section = crud.create_test_case_section(db=db, section=section)

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
        test_suite_id: Optional[int] = Query(None, ge=1),
        parent_section_id: Optional[int] = Query(None, ge=1),
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Scope by test suite when provided; otherwise require generic read access only
        if test_suite_id is not None:
            test_suite = crud.get_test_suite(db, test_suite_id=test_suite_id)
            if not test_suite:
                raise HTTPException(status_code=404, detail="Test suite not found")
            if not rbac.has_permission(current_user, "read", test_suite.project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
        else:
            if not rbac.has_permission(current_user, "read"):
                raise HTTPException(status_code=403, detail="Insufficient permissions")

        sections = crud.get_test_case_sections(
            db,
            test_suite_id=test_suite_id,
            parent_section_id=parent_section_id,
            skip=skip,
            limit=limit,
        )
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
                "updated_at": s.updated_at,
            }
            for s in sections
        ]

    @app.get("/test-case-sections/{section_id}", response_model=schemas.TestCaseSection)
    def read_test_case_section(
        section_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_section = crud.get_test_case_section(db, section_id=section_id)
        if db_section is None:
            raise HTTPException(status_code=404, detail="Test case section not found")

        test_suite = crud.get_test_suite(db, test_suite_id=db_section.test_suite_id) if db_section.test_suite_id else None
        if test_suite and not rbac.has_permission(current_user, "read", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return db_section

    @app.put("/test-case-sections/{section_id}", response_model=schemas.TestCaseSection)
    def update_test_case_section_endpoint(
        section: schemas.TestCaseSectionUpdate,
        section_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        existing = crud.get_test_case_section(db, section_id=section_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Test case section not found")

        test_suite = crud.get_test_suite(db, test_suite_id=existing.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite for section not found")
        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        update_fields = section.model_dump(exclude_unset=True)
        # Block cycles: a section cannot have itself or any of its descendants as a parent
        if "parent_section_id" in update_fields:
            new_parent_id = update_fields["parent_section_id"]
            if new_parent_id is not None:
                if new_parent_id == section_id:
                    raise HTTPException(status_code=400, detail="A section cannot be its own parent")
                parent = crud.get_test_case_section(db, section_id=new_parent_id)
                if not parent:
                    raise HTTPException(status_code=404, detail="Parent section not found")
                if parent.test_suite_id != existing.test_suite_id:
                    raise HTTPException(
                        status_code=400,
                        detail="Parent section must belong to the same test suite",
                    )
                if _section_is_descendant_of(db, parent.id, section_id):
                    raise HTTPException(
                        status_code=400,
                        detail="Cannot move a section into one of its own descendants",
                    )

        db_section = crud.update_test_case_section(db, section_id=section_id, section=section)
        if db_section is None:
            raise HTTPException(status_code=404, detail="Test case section not found")

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
        section_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_section = crud.get_test_case_section(db, section_id=section_id)
        if db_section is None:
            raise HTTPException(status_code=404, detail="Test case section not found")

        test_suite = (
            crud.get_test_suite(db, test_suite_id=db_section.test_suite_id)
            if db_section.test_suite_id
            else None
        )
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite for section not found")
        if not rbac.has_permission(current_user, "delete", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Refuse delete when test cases or subsections still reference this section
        child_count = db.query(models.TestCaseSection).filter(
            models.TestCaseSection.parent_section_id == section_id
        ).count()
        case_count = db.query(models.TestCase).filter(
            models.TestCase.section_id == section_id,
            ((models.TestCase.is_deleted.is_(None)) | (models.TestCase.is_deleted.is_(False))),
        ).count()
        if child_count or case_count:
            raise HTTPException(
                status_code=409,
                detail="Section is not empty. Move or delete its subsections and test cases first.",
            )

        section_id_val = db_section.id
        section_name = db_section.name
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
        project_id: Optional[int] = Query(None, ge=1),
        test_suite_id: Optional[int] = Query(None, ge=1),
        section_id: Optional[int] = Query(None, ge=1),
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        sort_by: str = Query("id", pattern="^(id|title|created_at|updated_at)$"),
        sort_order: str = Query("asc", pattern="^(asc|desc)$"),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # When the caller scopes by test_suite_id, derive the project for a single
        # RBAC check rather than scanning per-row at the end.
        scoped_project_id = project_id
        if scoped_project_id is None and test_suite_id is not None:
            ts = crud.get_test_suite(db, test_suite_id=test_suite_id)
            if not ts:
                raise HTTPException(status_code=404, detail="Test suite not found")
            scoped_project_id = ts.project_id

        if scoped_project_id is not None:
            if not rbac.has_permission(current_user, "read", scoped_project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to access this project")

            query = db.query(models.TestCase).options(
                joinedload(models.TestCase.test_suite).joinedload(models.TestSuite.project),
                joinedload(models.TestCase.section),
                joinedload(models.TestCase.creator),
                selectinload(models.TestCase.custom_field_values)
            ).join(models.TestSuite).filter(
                models.TestSuite.project_id == scoped_project_id,
                ((models.TestCase.is_deleted.is_(None)) | (models.TestCase.is_deleted.is_(False))),
            )
            if test_suite_id is not None:
                query = query.filter(models.TestCase.test_suite_id == test_suite_id)
            if section_id is not None:
                query = query.filter(models.TestCase.section_id == section_id)

            sort_columns = {
                "id": models.TestCase.id,
                "title": models.TestCase.title,
                "created_at": models.TestCase.created_at,
                "updated_at": models.TestCase.updated_at,
            }
            col = sort_columns.get(sort_by, models.TestCase.id)
            query = query.order_by(col.desc() if sort_order == "desc" else col.asc())

            test_cases = query.offset(skip).limit(limit).all()
        else:
            # No scoping → fall back to per-row RBAC filter. Honour the same sort/limit.
            test_cases = crud.get_test_cases(
                db,
                test_suite_id=test_suite_id,
                section_id=section_id,
                skip=skip,
                limit=limit,
            )
            authorized_cases = []
            for case in test_cases:
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
    def read_test_case(
        test_case_id: int,
        include_linked_requirements: bool = Query(False),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        db_test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if db_test_case is None or getattr(db_test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")

        test_suite = crud.get_test_suite(db, test_suite_id=db_test_case.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")

        if not rbac.has_permission(current_user, "read", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to access this test case")

        if include_linked_requirements:
            db_test_case.linked_requirements = _get_test_case_linked_requirements(db, db_test_case, test_suite.project_id)

        return db_test_case

    @app.put("/test-cases/{test_case_id}", response_model=schemas.TestCaseWithRelations)
    def update_test_case(
        test_case_id: int,
        test_case: schemas.TestCaseUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        original_test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if not original_test_case or getattr(original_test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")

        test_suite = crud.get_test_suite(db, test_suite_id=original_test_case.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")

        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to update this test case")

        original_project_id = test_suite.project_id

        if test_case.test_suite_id is not None:
            new_test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
            if not new_test_suite:
                raise HTTPException(status_code=404, detail="Test suite not found")
            if not rbac.has_permission(current_user, "write", new_test_suite.project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to move test case to this project")

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
            'test_suite_id': original_test_case.test_suite_id,
        }

        db_test_case = crud.update_test_case(db, test_case_id=test_case_id, test_case=test_case)
        if db_test_case is None:
            raise HTTPException(status_code=404, detail="Test case not found")

        try:
            def _normalize(value):
                if value is None:
                    return ''
                if hasattr(value, 'value'):
                    return str(value.value)
                return str(value)

            changed_fields = []
            update_data = test_case.model_dump(exclude_unset=True)

            for field, new_value in update_data.items():
                if field not in original_data:
                    continue
                if _normalize(original_data.get(field)) != _normalize(new_value):
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
                    "created_by": current_user.id,
                }

                crud.create_test_case_revision(db, schemas.TestCaseRevisionCreate(**revision_data))
        except Exception:
            logger.exception("Failed to create revision for test case %s", test_case_id)

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_CASE.value,
                entity_id=db_test_case.id,
                project_id=original_project_id,
                description=f"Test case updated: {db_test_case.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception:
            logger.exception("Failed to create audit trail for test case update %s", test_case_id)

        return db_test_case

    @app.delete("/test-cases/{test_case_id}")
    def delete_test_case(
        test_case_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if db_test_case is None or getattr(db_test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")

        suite = crud.get_test_suite(db, test_suite_id=db_test_case.test_suite_id)
        if not suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")

        if not rbac.has_permission(current_user, "delete", suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to delete this test case")

        project_id = suite.project_id
        test_case_title = db_test_case.title

        crud.delete_test_case(db, test_case_id=test_case_id)

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
        except Exception:
            logger.exception("Failed to create audit trail for test case deletion %s", test_case_id)

        return {"message": "Test case deleted successfully"}

    @app.get("/test-cases/{test_case_id}/revisions")
    def get_test_case_revisions(
        test_case_id: int,
        db: Session = Depends(get_db),
        current_user: models.User = Depends(get_current_user)
    ):
        """Get revision history for a test case (admin and manager only, scoped to project access)"""
        from sqlalchemy.orm import joinedload

        user_role_value = getattr(current_user.role, "value", current_user.role)
        if str(user_role_value).upper() not in ["ADMIN", "MANAGER"]:
            raise HTTPException(
                status_code=403,
                detail="Only administrators and managers can view revision history"
            )

        test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if test_case is None or getattr(test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")

        suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")

        if not rbac.has_permission(current_user, "read", suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to view revision history for this test case")

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

        _validate_test_run_scope(
            db,
            project_id=test_run.project_id,
            test_plan_id=test_run.test_plan_id,
            milestone_id=test_run.milestone_id,
        )
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
        _validate_test_run_scope(
            db,
            project_id=db_test_run.project_id,
            test_plan_id=changed_fields.get("test_plan_id", db_test_run.test_plan_id),
            milestone_id=changed_fields.get("milestone_id", db_test_run.milestone_id),
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
        project_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Single query for every section in the project, grouped in Python.
        # This replaces the previous O(N) per-suite + O(M) per-section query pattern.
        test_suites = (
            db.query(models.TestSuite)
            .filter(models.TestSuite.project_id == project_id)
            .order_by(models.TestSuite.name.asc())
            .all()
        )
        suite_ids = [s.id for s in test_suites]

        sections_by_suite: dict[int, list[models.TestCaseSection]] = {sid: [] for sid in suite_ids}
        all_sections: list[models.TestCaseSection] = []
        if suite_ids:
            all_sections = (
                db.query(models.TestCaseSection)
                .filter(models.TestCaseSection.test_suite_id.in_(suite_ids))
                .order_by(
                    models.TestCaseSection.order_index.asc().nullslast(),
                    models.TestCaseSection.name.asc(),
                )
                .all()
            )
            for sec in all_sections:
                sections_by_suite.setdefault(sec.test_suite_id, []).append(sec)

        section_ids = [s.id for s in all_sections]
        counts_by_section: dict[int, int] = {sid: 0 for sid in section_ids}
        if section_ids:
            tc_counts = (
                db.query(models.TestCase.section_id, func.count(models.TestCase.id))
                .filter(models.TestCase.section_id.in_(section_ids))
                .group_by(models.TestCase.section_id)
                .all()
            )
            for sid, cnt in tc_counts:
                counts_by_section[sid] = int(cnt or 0)

        children_by_parent: dict[Optional[int], list[models.TestCaseSection]] = {}
        for sec in all_sections:
            children_by_parent.setdefault(sec.parent_section_id, []).append(sec)

        def build_node(section: models.TestCaseSection) -> dict:
            return {
                "id": section.id,
                "name": section.name,
                "description": section.description,
                "test_suite_id": section.test_suite_id,
                "parent_section_id": section.parent_section_id,
                "order_index": section.order_index,
                "test_case_count": counts_by_section.get(section.id, 0),
                "subsections": [build_node(child) for child in children_by_parent.get(section.id, [])],
            }

        hierarchy = []
        for suite in test_suites:
            roots = [s for s in sections_by_suite.get(suite.id, []) if s.parent_section_id is None]
            hierarchy.append({
                "test_suite": {
                    "id": suite.id,
                    "name": suite.name,
                    "description": suite.description,
                },
                "sections": [build_node(section) for section in roots],
            })

        return {"project_id": project_id, "hierarchy": hierarchy}

    # Test Case Steps Endpoints
    @app.get("/test-cases/{test_case_id}/steps", response_model=List[schemas.TestCaseStep])
    def get_test_case_steps_endpoint(
        test_case_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if test_case is None or getattr(test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")

        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")
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
        if test_case is None or getattr(test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")

        suite_project_id = test_case.project_id
        if suite_project_id is None:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")
        if not rbac.has_permission(current_user, "read", suite_project_id, db):
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
        if test_case is None or getattr(test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")

        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")
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
        test_suite_id: Optional[int] = Query(None, ge=1),
        parent_section_id: Optional[int] = Query(None, ge=1),
        project_id: Optional[int] = Query(None, ge=1),
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Enforce project-scoped read access when scoping is possible
        scoped_project_id: Optional[int] = project_id
        if scoped_project_id is None and test_suite_id is not None:
            test_suite = crud.get_test_suite(db, test_suite_id=test_suite_id)
            if not test_suite:
                raise HTTPException(status_code=404, detail="Test suite not found")
            scoped_project_id = test_suite.project_id

        if scoped_project_id is not None:
            if not rbac.has_permission(current_user, "read", scoped_project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
        else:
            if not rbac.has_permission(current_user, "read"):
                raise HTTPException(status_code=403, detail="Insufficient permissions")

        query = db.query(models.TestCaseSection)

        if test_suite_id is not None:
            query = query.filter(models.TestCaseSection.test_suite_id == test_suite_id)
        if parent_section_id is not None:
            query = query.filter(models.TestCaseSection.parent_section_id == parent_section_id)
        if project_id is not None:
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
        section_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        section = db.query(models.TestCaseSection).filter(models.TestCaseSection.id == section_id).first()
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")
        test_suite = (
            crud.get_test_suite(db, test_suite_id=section.test_suite_id)
            if section.test_suite_id
            else None
        )
        if test_suite and not rbac.has_permission(current_user, "read", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return section

    @app.get("/sections/{section_id}/tree")
    def get_section_tree(
        section_id: int = Path(..., ge=1),
        include_test_cases: bool = True,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Get the root section
        root_section = db.query(models.TestCaseSection).filter(models.TestCaseSection.id == section_id).first()
        if not root_section:
            raise HTTPException(status_code=404, detail="Section not found")
        test_suite = (
            crud.get_test_suite(db, test_suite_id=root_section.test_suite_id)
            if root_section.test_suite_id
            else None
        )
        if test_suite and not rbac.has_permission(current_user, "read", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
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
        section_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        section = db.query(models.TestCaseSection).filter(models.TestCaseSection.id == section_id).first()
        if not section:
            raise HTTPException(status_code=404, detail="Section not found")

        test_suite = db.query(models.TestSuite).filter(models.TestSuite.id == section.test_suite_id).first()
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite for section not found")
        if not rbac.has_permission(current_user, "read", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        project = db.query(models.Project).filter(models.Project.id == test_suite.project_id).first()

        parent_section_data = None
        if section.parent_section_id is not None:
            parent = (
                db.query(models.TestCaseSection)
                .filter(models.TestCaseSection.id == section.parent_section_id)
                .first()
            )
            if parent is not None:
                parent_section_data = {"id": parent.id, "name": parent.name}

        subsections = (
            db.query(models.TestCaseSection)
            .filter(models.TestCaseSection.parent_section_id == section_id)
            .order_by(
                models.TestCaseSection.order_index.asc().nullslast(),
                models.TestCaseSection.name.asc(),
            )
            .all()
        )
        subsection_ids = [s.id for s in subsections]
        subsection_counts: dict[int, int] = {sid: 0 for sid in subsection_ids}
        if subsection_ids:
            rows = (
                db.query(models.TestCase.section_id, func.count(models.TestCase.id))
                .filter(models.TestCase.section_id.in_(subsection_ids))
                .group_by(models.TestCase.section_id)
                .all()
            )
            for sid, cnt in rows:
                subsection_counts[sid] = int(cnt or 0)

        test_cases = (
            db.query(models.TestCase)
            .filter(models.TestCase.section_id == section_id)
            .filter((models.TestCase.is_deleted.is_(None)) | (models.TestCase.is_deleted.is_(False)))
            .order_by(models.TestCase.title.asc())
            .all()
        )

        test_case_ids = [tc.id for tc in test_cases]
        latest_results: dict[int, models.TestResult] = {}
        if test_case_ids:
            latest_ids_sub = (
                db.query(
                    models.TestResult.test_case_id,
                    func.max(models.TestResult.id).label("latest_id"),
                )
                .filter(models.TestResult.test_case_id.in_(test_case_ids))
                .group_by(models.TestResult.test_case_id)
                .subquery()
            )
            latest_rows = (
                db.query(models.TestResult)
                .join(
                    latest_ids_sub,
                    models.TestResult.id == latest_ids_sub.c.latest_id,
                )
                .all()
            )
            for row in latest_rows:
                latest_results[row.test_case_id] = row

        def _normalize_result_status(value) -> str:
            if value is None:
                return ""
            return (value.value if hasattr(value, "value") else str(value)).lower()

        def _result_dict(result: Optional[models.TestResult]) -> Optional[dict]:
            if result is None:
                return None
            return {
                "id": result.id,
                "status": _normalize_result_status(result.status),
                "executed_at": result.executed_at or result.created_at,
            }

        total_test_cases = len(test_cases)
        executed_count = sum(1 for tc in test_cases if tc.id in latest_results)
        passed_count = sum(
            1
            for tc in test_cases
            if _normalize_result_status(latest_results.get(tc.id) and latest_results[tc.id].status) in ("pass", "passed")
        )
        failed_count = sum(
            1
            for tc in test_cases
            if _normalize_result_status(latest_results.get(tc.id) and latest_results[tc.id].status) in ("fail", "failed")
        )
        pass_rate = round((passed_count / executed_count) * 100, 1) if executed_count else 0.0

        def _status_value(value) -> Optional[str]:
            if value is None:
                return None
            return value.value if hasattr(value, "value") else str(value)

        return {
            "section": {
                "id": section.id,
                "name": section.name,
                "description": section.description,
                "created_at": section.created_at,
                "updated_at": section.updated_at,
            },
            "project": {
                "id": project.id if project else test_suite.project_id,
                "name": project.name if project else None,
                "description": project.description if project else None,
            },
            "test_suite": {
                "id": test_suite.id,
                "name": test_suite.name,
                "description": test_suite.description,
            },
            "parent_section": parent_section_data,
            "subsections": [
                {
                    "id": sub.id,
                    "name": sub.name,
                    "description": sub.description,
                    "test_case_count": subsection_counts.get(sub.id, 0),
                }
                for sub in subsections
            ],
            "test_cases": [
                {
                    "id": tc.id,
                    "title": tc.title,
                    "description": tc.description,
                    "priority": _status_value(tc.priority),
                    "status": _status_value(tc.status),
                    "created_at": tc.created_at,
                    "updated_at": tc.updated_at,
                    "latest_result": _result_dict(latest_results.get(tc.id)),
                }
                for tc in test_cases
            ],
            "statistics": {
                "total_test_cases": total_test_cases,
                "executed_test_cases": executed_count,
                "passed_test_cases": passed_count,
                "failed_test_cases": failed_count,
                "pass_rate": pass_rate,
                "subsections_count": len(subsections),
            },
        }

    @app.post("/sections/", response_model=schemas.TestCaseSection)
    def create_section(
        section: schemas.TestCaseSectionCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if section.test_suite_id is None or section.test_suite_id <= 0:
            raise HTTPException(status_code=400, detail="Invalid test_suite_id")

        test_suite = db.query(models.TestSuite).filter(models.TestSuite.id == section.test_suite_id).first()
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found")

        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        if section.parent_section_id:
            parent = crud.get_test_case_section(db, section_id=section.parent_section_id)
            if not parent:
                raise HTTPException(status_code=404, detail="Parent section not found")
            if parent.test_suite_id != section.test_suite_id:
                raise HTTPException(
                    status_code=400,
                    detail="Parent section must belong to the same test suite",
                )

        return crud.create_test_case_section(db=db, section=section)

    @app.put("/sections/{section_id}", response_model=schemas.TestCaseSection)
    def update_section(
        section: schemas.TestCaseSectionUpdate,
        section_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_section = db.query(models.TestCaseSection).filter(models.TestCaseSection.id == section_id).first()
        if not db_section:
            raise HTTPException(status_code=404, detail="Section not found")

        test_suite = db.query(models.TestSuite).filter(models.TestSuite.id == db_section.test_suite_id).first()
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite for section not found")
        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        update_fields = section.model_dump(exclude_unset=True)
        if "parent_section_id" in update_fields:
            new_parent_id = update_fields["parent_section_id"]
            if new_parent_id is not None:
                if new_parent_id == section_id:
                    raise HTTPException(status_code=400, detail="A section cannot be its own parent")
                parent = crud.get_test_case_section(db, section_id=new_parent_id)
                if not parent:
                    raise HTTPException(status_code=404, detail="Parent section not found")
                if parent.test_suite_id != db_section.test_suite_id:
                    raise HTTPException(
                        status_code=400,
                        detail="Parent section must belong to the same test suite",
                    )
                if _section_is_descendant_of(db, parent.id, section_id):
                    raise HTTPException(
                        status_code=400,
                        detail="Cannot move a section into one of its own descendants",
                    )

        return crud.update_test_case_section(db, section_id=section_id, section=section)

    @app.delete("/sections/{section_id}")
    def delete_section(
        section_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_section = db.query(models.TestCaseSection).filter(models.TestCaseSection.id == section_id).first()
        if not db_section:
            raise HTTPException(status_code=404, detail="Section not found")

        test_suite = db.query(models.TestSuite).filter(models.TestSuite.id == db_section.test_suite_id).first()
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite for section not found")
        if not rbac.has_permission(current_user, "delete", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        child_count = db.query(models.TestCaseSection).filter(
            models.TestCaseSection.parent_section_id == section_id
        ).count()
        case_count = db.query(models.TestCase).filter(
            models.TestCase.section_id == section_id,
            ((models.TestCase.is_deleted.is_(None)) | (models.TestCase.is_deleted.is_(False))),
        ).count()
        if child_count or case_count:
            raise HTTPException(
                status_code=409,
                detail="Section is not empty. Move or delete its subsections and test cases first.",
            )

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
