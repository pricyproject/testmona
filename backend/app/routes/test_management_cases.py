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
from ..services import notification_engine, watch_service
from .test_management_helpers import *

logger = logging.getLogger(__name__)


def register_case_routes(app):
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
            logger.warning(f"Failed to create audit trail for test case section creation: {e}")
        
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
            logger.warning(f"Failed to create audit trail for test case section update: {e}")
        
        return db_section

    @app.delete("/test-case-sections/{section_id}", response_model=schemas.MessageResponse)
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
            logger.warning(f"Failed to create audit trail for test case section deletion: {e}")
        
        return {"message": "Test case section deleted successfully"}

    @app.post("/test-cases", response_model=schemas.TestCaseWithRelations,
              dependencies=[Depends(require_project_feature("test_cases"))])
    def create_test_case(
        test_case: schemas.TestCaseCreate, 
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Validate that the test suite exists
        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found")
        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to create test cases in this project")

        # Ensure default priority and test type definitions exist for this project.
        crud.ensure_default_priority_and_test_type_definitions(db, test_suite.project_id, current_user.id)

        if test_case.section_id is not None:
            section = crud.get_test_case_section(db, section_id=test_case.section_id)
            if not section:
                raise HTTPException(status_code=404, detail="Section not found")
            if section.test_suite_id != test_case.test_suite_id:
                raise HTTPException(
                    status_code=400,
                    detail="Section must belong to the selected test suite",
                )
        
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
            logger.warning(f"Failed to create audit trail for test case creation: {e}")

        # The author auto-watches the new test case for later change alerts.
        watch_service.auto_watch(
            db, entity_type=watch_service.TEST_CASE, entity_id=db_test_case.id,
            user_ids=[db_test_case.created_by],
        )

        return db_test_case

    @app.get("/test-cases", response_model=List[schemas.TestCaseWithRelations],
             dependencies=[Depends(require_project_feature("test_cases"))])
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
            suite_ids = {case.test_suite_id for case in test_cases if case.test_suite_id}
            suites = db.query(models.TestSuite).filter(models.TestSuite.id.in_(suite_ids)).all() if suite_ids else []
            suite_map = {s.id: s for s in suites}
            authorized_cases = []
            for case in test_cases:
                test_suite = suite_map.get(case.test_suite_id)
                if test_suite and rbac.has_permission(current_user, "read", test_suite.project_id, db):
                    authorized_cases.append(case)
            test_cases = authorized_cases

        return test_cases

    @app.get("/test-cases/count", response_model=schemas.CountResponse)
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
                models.TestSuite.project_id == project_id,
                ((models.TestCase.is_deleted.is_(None)) | (models.TestCase.is_deleted.is_(False))),
            )
            if test_suite_id:
                query = query.filter(models.TestCase.test_suite_id == test_suite_id)
            if section_id:
                query = query.filter(models.TestCase.section_id == section_id)
            count = query.count()
        else:
            accessible_project_ids = [project.id for project in rbac.get_accessible_projects(current_user, db)]
            if not accessible_project_ids:
                return {"count": 0}

            query = db.query(models.TestCase).join(models.TestSuite).filter(
                models.TestSuite.project_id.in_(accessible_project_ids),
                ((models.TestCase.is_deleted.is_(None)) | (models.TestCase.is_deleted.is_(False))),
            )
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
        update_fields = test_case.model_dump(exclude_unset=True)
        target_test_suite_id = update_fields.get("test_suite_id", original_test_case.test_suite_id)

        if test_case.test_suite_id is not None:
            new_test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
            if not new_test_suite:
                raise HTTPException(status_code=404, detail="Test suite not found")
            if not rbac.has_permission(current_user, "write", new_test_suite.project_id, db):
                raise HTTPException(status_code=403, detail="Not authorized to move test case to this project")

        if "section_id" in update_fields and update_fields["section_id"] is not None:
            section = crud.get_test_case_section(db, section_id=update_fields["section_id"])
            if not section:
                raise HTTPException(status_code=404, detail="Section not found")
            if section.test_suite_id != target_test_suite_id:
                raise HTTPException(
                    status_code=400,
                    detail="Section must belong to the selected test suite",
                )
        elif (
            "test_suite_id" in update_fields
            and update_fields["test_suite_id"] != original_test_case.test_suite_id
            and original_test_case.section_id is not None
        ):
            raise HTTPException(
                status_code=400,
                detail="section_id must be provided or cleared when moving a test case to another suite",
            )

        # A case can only iterate over a dataset from its own project.
        if "dataset_id" in update_fields and update_fields["dataset_id"] is not None:
            target_project_id = original_project_id
            if test_case.test_suite_id is not None:
                target_project_id = new_test_suite.project_id
            dataset = crud.get_test_dataset(db, dataset_id=update_fields["dataset_id"])
            if dataset is None:
                raise HTTPException(status_code=404, detail="Dataset not found")
            if dataset.project_id != target_project_id:
                raise HTTPException(
                    status_code=400,
                    detail="Dataset must belong to the same project as the test case",
                )

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

        # Diff once: drives both the revision history and the watcher broadcast.
        def _normalize(value):
            if value is None:
                return ''
            if hasattr(value, 'value'):
                return str(value.value)
            return str(value)

        changed_fields = [
            field
            for field, new_value in update_fields.items()
            if field in original_data
            and _normalize(original_data.get(field)) != _normalize(new_value)
        ]

        try:
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

        # Alert watchers about the change (informational; deep-links to the case).
        if changed_fields:
            batch = notification_engine.NotificationBatch()
            watch_service.notify_watchers_of_change(
                db,
                entity_type=watch_service.TEST_CASE,
                entity_id=db_test_case.id,
                label=db_test_case.title or f"#{db_test_case.id}",
                action="updated",
                actor_id=current_user.id,
                changed_fields=[f.replace("_", " ") for f in changed_fields],
                batch=batch,
            )
            batch.flush(db)

        return db_test_case

    @app.delete("/test-cases/{test_case_id}", response_model=schemas.MessageResponse)
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

        # Watches reference the case by loose id (no FK); clear them too.
        watch_service.clear_watches(db, watch_service.TEST_CASE, test_case_id)

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

    # ------------------------- Test case watch subscriptions -------------------

    def _get_watchable_test_case(db: Session, test_case_id: int, current_user):
        test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if test_case is None or getattr(test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")
        suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")
        if not rbac.has_permission(current_user, "read", suite.project_id, db):
            raise HTTPException(status_code=403, detail="Not authorized to access this project")
        return test_case

    @app.get("/test-cases/{test_case_id}/watch", response_model=schemas.WatchStatus)
    def get_test_case_watch(
        test_case_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        test_case = _get_watchable_test_case(db, test_case_id, current_user)
        return schemas.WatchStatus(
            watching=watch_service.is_watching(db, current_user.id, watch_service.TEST_CASE, test_case.id),
            watcher_count=watch_service.count_watchers(db, watch_service.TEST_CASE, test_case.id),
        )

    @app.post("/test-cases/{test_case_id}/watch", response_model=schemas.WatchStatus)
    def watch_test_case(
        test_case_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        test_case = _get_watchable_test_case(db, test_case_id, current_user)
        watch_service.add_watch(db, current_user.id, watch_service.TEST_CASE, test_case.id)
        return schemas.WatchStatus(
            watching=True,
            watcher_count=watch_service.count_watchers(db, watch_service.TEST_CASE, test_case.id),
        )

    @app.delete("/test-cases/{test_case_id}/watch", response_model=schemas.WatchStatus)
    def unwatch_test_case(
        test_case_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        test_case = _get_watchable_test_case(db, test_case_id, current_user)
        watch_service.remove_watch(db, current_user.id, watch_service.TEST_CASE, test_case.id)
        return schemas.WatchStatus(
            watching=False,
            watcher_count=watch_service.count_watchers(db, watch_service.TEST_CASE, test_case.id),
        )

    @app.get("/test-cases/{test_case_id}/revisions")
    def get_test_case_revisions(
        test_case_id: int,
        db: Session = Depends(get_db),
        current_user: models.User = Depends(get_current_active_user)
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
        user_role = str(getattr(current_user.role, "value", current_user.role)).upper()
        if user_role not in ["ADMIN", "MANAGER"]:
            raise HTTPException(
                status_code=403,
                detail="Only administrators and managers can restore revision history"
            )

        db_test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if not db_test_case or getattr(db_test_case, "is_deleted", False):
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
