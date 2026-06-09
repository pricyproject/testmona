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


def register_section_step_routes(app):
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

        # Snapshot the existing steps so we record a revision only when the step
        # content actually changes. The editor re-POSTs steps on every save, so
        # an unconditional revision here would spawn empty/duplicate entries.
        def _steps_signature(items):
            return [
                (
                    (getattr(step, "action", "") or "").strip(),
                    (getattr(step, "expected_result", "") or "").strip(),
                    (getattr(step, "step_type", "") or "").strip(),
                )
                for step in sorted(items, key=lambda s: (getattr(s, "step_number", 0) or 0))
            ]

        before_signature = _steps_signature(crud.get_test_case_steps(db, test_case_id=test_case_id))

        if steps:
            crud.update_test_case(db, test_case_id, schemas.TestCaseUpdate(is_multistep=True))

        created_steps = crud.create_test_case_steps(db, test_case_id=test_case_id, steps=steps)

        # Multistep steps live in their own table, so changes here don't flow
        # through the test-case PUT revision logic; record one explicitly.
        if _steps_signature(created_steps) != before_signature:
            try:
                updated_case = crud.get_test_case(db, test_case_id=test_case_id)
                revision_data = {
                    "test_case_id": test_case_id,
                    "title": updated_case.title,
                    "description": updated_case.description,
                    "test_type": updated_case.test_type,
                    "preconditions": updated_case.preconditions,
                    "steps": updated_case.steps,
                    "expected_result": updated_case.expected_result,
                    "priority": updated_case.priority,
                    "tags": updated_case.tags,
                    "changed_fields": {"steps": "updated"},
                    "change_reason": "Updated test steps",
                    "created_by": current_user.id,
                }
                crud.create_test_case_revision(db, schemas.TestCaseRevisionCreate(**revision_data))
            except Exception:
                logger.exception("Failed to create revision for test case steps %s", test_case_id)

        return created_steps

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

    @app.get("/sections/")
    def get_sections(
        test_suite_id: Optional[int] = Query(None, ge=1),
        parent_section_id: Optional[int] = Query(None, ge=1),
        project_id: Optional[int] = Query(None, ge=1),
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=1000),
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
