"""
Requirements, defects, test plans, and milestones routes for test planning and quality management.
"""

import logging
import re

from fastapi import Depends, HTTPException, Query
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from datetime import datetime, timezone

from .. import crud, schemas, auth, rbac, models
from ..database import get_db
from ..auth import get_current_active_user
from ..services.milestone_service import enrich_milestone, enrich_milestones, get_project_milestone_stats
from ..services.atlassian_document_service import fetch_requirement_source
from ..crud import (
    create_requirement, get_requirements, get_requirement, update_requirement, delete_requirement,
    create_defect, get_defects, get_defect, update_defect, delete_defect,
    create_test_plan, get_test_plans, get_test_plan, update_test_plan, delete_test_plan,
    create_milestone, get_milestones, get_milestone, update_milestone, delete_milestone
)

logger = logging.getLogger(__name__)


FAILED_RESULT_STATUSES = {"fail", "failed"}
BLOCKED_RESULT_STATUSES = {"block", "blocked"}


def _get_reference_tokens(value: Optional[str]) -> list[str]:
    raw_value = value or ""
    tokens = [
        token.strip("()[]{}\"'.,").lower()
        for token in re.split(r"[\s,;|]+", raw_value)
        if token.strip("()[]{}\"'.,")
    ]
    tokens.extend(token.lower() for token in re.findall(r"[a-z]+-\d+", raw_value, flags=re.IGNORECASE))
    return list(dict.fromkeys(tokens))


def _add_requirement_reference(value: Optional[str], requirement_key: str) -> str:
    existing = (value or "").strip()
    if requirement_key.lower() in _get_reference_tokens(existing):
        return existing
    return f"{existing}, {requirement_key}" if existing else requirement_key


def _remove_requirement_reference(value: Optional[str], requirement_key: str) -> str:
    escaped_key = re.escape(requirement_key)
    cleaned = re.sub(rf"(^|[\s,;|]){escaped_key}(?=$|[\s,;|])", lambda match: match.group(1) if match.group(1).strip() else "", value or "", flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*([,;|])\s*", r"\1 ", cleaned)
    cleaned = re.sub(r"^[,;|\s]+|[,;|\s]+$", "", cleaned)
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def _enum_value(value):
    return getattr(value, "value", value)


def _get_requirement_or_404(db: Session, requirement_id: int):
    requirement = get_requirement(db, requirement_id=requirement_id)
    if requirement is None:
        raise HTTPException(status_code=404, detail="Requirement not found")
    return requirement


def _validate_requirement_project(db: Session, requirement_id: Optional[int], project_id: int) -> None:
    if requirement_id is None:
        return
    requirement = get_requirement(db, requirement_id=requirement_id)
    if requirement is None:
        raise HTTPException(status_code=404, detail="Requirement not found")
    if requirement.project_id != project_id:
        raise HTTPException(status_code=400, detail="Requirement does not belong to this project")


def _linked_requirement_test_plan_ids(db: Session, requirement_id: int) -> set[int]:
    rows = db.query(models.requirement_test_plan_links.c.test_plan_id).filter(
        models.requirement_test_plan_links.c.requirement_id == requirement_id,
    ).all()
    return {row[0] for row in rows}


def _test_plan_to_requirement_response(test_plan, linked: bool = False):
    return schemas.RequirementLinkedTestPlan(
        id=test_plan.id,
        title=test_plan.title,
        status=_enum_value(test_plan.status),
        milestone_id=test_plan.milestone_id,
        milestone_title=test_plan.milestone.title if test_plan.milestone else None,
        target_start_date=test_plan.target_start_date,
        target_end_date=test_plan.target_end_date,
        linked=linked,
    )


def _project_test_case_query(db: Session, project_id: int):
    return db.query(models.TestCase).join(models.TestSuite).filter(
        models.TestSuite.project_id == project_id,
        models.TestCase.is_deleted == False,
    )


def _latest_test_result(db: Session, test_case_id: int):
    return db.query(models.TestResult).filter(
        models.TestResult.test_case_id == test_case_id,
    ).order_by(
        models.TestResult.executed_at.desc(),
        models.TestResult.created_at.desc(),
    ).first()


def _test_case_to_linked_response(db: Session, test_case, link_id: Optional[int] = None, linked: bool = False):
    latest_result = _latest_test_result(db, test_case.id)
    return schemas.RequirementLinkedTestCase(
        id=test_case.id,
        title=test_case.title,
        priority=test_case.priority,
        status=test_case.status,
        test_suite_id=test_case.test_suite_id,
        section_id=test_case.section_id,
        reference=test_case.reference,
        tags=test_case.tags,
        created_at=test_case.created_at,
        updated_at=test_case.updated_at,
        suite_name=test_case.test_suite.name if test_case.test_suite else None,
        section_name=test_case.section.name if test_case.section else None,
        linked=linked,
        link_id=link_id,
        latest_run_status=latest_result.status if latest_result else None,
        latest_run_at=latest_result.executed_at if latest_result else None,
    )


def _legacy_requirement_reference_ids(db: Session, requirement) -> set[int]:
    requirement_key = requirement.requirement_id.lower()
    candidates = _project_test_case_query(db, requirement.project_id).filter(
        models.TestCase.reference.ilike(f"%{requirement.requirement_id}%"),
    ).all()
    return {
        test_case.id
        for test_case in candidates
        if requirement_key in _get_reference_tokens(test_case.reference)
    }


def _association_requirement_link_ids(db: Session, requirement) -> set[int]:
    rows = db.query(models.requirement_test_case_links.c.test_case_id).filter(
        models.requirement_test_case_links.c.requirement_id == requirement.id,
    ).all()
    if not rows:
        return set()

    test_case_ids = [row[0] for row in rows]
    project_test_case_ids = {
        row[0]
        for row in _project_test_case_query(db, requirement.project_id).filter(
            models.TestCase.id.in_(test_case_ids),
        ).with_entities(models.TestCase.id).all()
    }
    return project_test_case_ids


def _requirement_link_map(db: Session, requirement) -> dict[int, Optional[int]]:
    traceability_links = {
        entry.test_case_id: entry.id
        for entry in db.query(models.TraceabilityMatrix).filter(
            models.TraceabilityMatrix.requirement_id == requirement.id,
        ).all()
    }
    for test_case_id in _association_requirement_link_ids(db, requirement):
        traceability_links.setdefault(test_case_id, None)
    for test_case_id in _legacy_requirement_reference_ids(db, requirement):
        traceability_links.setdefault(test_case_id, None)
    return traceability_links


def _ensure_association_link(db: Session, requirement_id: int, test_case_id: int) -> None:
    existing = db.query(models.requirement_test_case_links.c.requirement_id).filter(
        models.requirement_test_case_links.c.requirement_id == requirement_id,
        models.requirement_test_case_links.c.test_case_id == test_case_id,
    ).first()
    if existing:
        return
    db.execute(
        models.requirement_test_case_links.insert().values(
            requirement_id=requirement_id,
            test_case_id=test_case_id,
        )
    )


def _delete_association_link(db: Session, requirement_id: int, test_case_id: int) -> None:
    db.execute(
        models.requirement_test_case_links.delete().where(
            models.requirement_test_case_links.c.requirement_id == requirement_id,
            models.requirement_test_case_links.c.test_case_id == test_case_id,
        )
    )


def _requirement_traceability_summary(db: Session, requirement) -> schemas.RequirementTraceabilitySummary:
    link_map = _requirement_link_map(db, requirement)
    test_case_ids = list(link_map.keys())
    if not test_case_ids:
        return schemas.RequirementTraceabilitySummary(
            linked_count=0,
            active_count=0,
            missing_coverage=1,
            failed_related_runs=0,
            blocked_related_runs=0,
        )

    test_cases = db.query(models.TestCase).join(models.TestSuite).filter(
        models.TestCase.id.in_(test_case_ids),
        models.TestSuite.project_id == requirement.project_id,
        models.TestCase.is_deleted == False,
    ).all()
    active_count = len([test_case for test_case in test_cases if test_case.status == "active"])
    failed_related_runs = db.query(models.TestResult).filter(
        models.TestResult.test_case_id.in_([test_case.id for test_case in test_cases]),
        models.TestResult.status.in_(FAILED_RESULT_STATUSES),
    ).count()
    blocked_related_runs = db.query(models.TestResult).filter(
        models.TestResult.test_case_id.in_([test_case.id for test_case in test_cases]),
        models.TestResult.status.in_(BLOCKED_RESULT_STATUSES),
    ).count()

    return schemas.RequirementTraceabilitySummary(
        linked_count=len(test_cases),
        active_count=active_count,
        missing_coverage=0 if test_cases else 1,
        failed_related_runs=failed_related_runs,
        blocked_related_runs=blocked_related_runs,
    )


def _audit_requirement_tc_link(
    db: Session,
    current_user,
    requirement,
    test_case,
    action: str,
    link_id: Optional[int] = None,
) -> None:
    try:
        from ..services.audit_service import get_audit_service
        from ..schemas_audit import AuditTrailCreate
        from ..models import AuditAction, EntityType

        audit_service = get_audit_service(db)
        action_label = "linked" if action == "link" else "unlinked"
        audit_data = AuditTrailCreate(
            user_id=current_user.id,
            action=AuditAction.CREATE.value if action == "link" else AuditAction.DELETE.value,
            entity_type=EntityType.TRACEABILITY_ENTRY.value,
            entity_id=link_id,
            project_id=requirement.project_id,
            description=f"Test case {test_case.id} {action_label} to requirement {requirement.id}",
            additional_metadata={
                "requirement_id": requirement.id,
                "requirement_key": requirement.requirement_id,
                "test_case_id": test_case.id,
                "test_case_title": test_case.title,
                "link_action": action,
            },
        )
        audit_service.create_audit_trail(audit_data)
    except Exception as e:
        logger.warning("Failed to create requirement test case link audit trail: %s", e)


def _get_valid_project_test_cases(db: Session, requirement, test_case_ids: List[int]):
    unique_ids = list(dict.fromkeys(test_case_ids))
    if not unique_ids:
        raise HTTPException(status_code=400, detail="At least one test_case_id is required")

    test_cases = _project_test_case_query(db, requirement.project_id).filter(
        models.TestCase.id.in_(unique_ids),
    ).all()
    found_ids = {test_case.id for test_case in test_cases}
    missing_ids = [test_case_id for test_case_id in unique_ids if test_case_id not in found_ids]
    if missing_ids:
        raise HTTPException(status_code=404, detail=f"Test cases not found in this project: {missing_ids}")
    return test_cases


def register_requirements_defects_plans_routes(app):
    """Register requirements, defects, test plans, and milestones routes with the FastAPI app."""
    
    # Requirements Endpoints
    @app.post("/requirements", response_model=schemas.Requirement)
    def create_requirement_endpoint(
        requirement: schemas.RequirementCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            db_requirement = create_requirement(db=db, requirement=requirement)
            
            # Create audit trail
            try:
                from ..services.audit_service import get_audit_service
                from ..schemas_audit import AuditTrailCreate
                from ..models import AuditAction, EntityType
                audit_service = get_audit_service(db)
                audit_data = AuditTrailCreate(
                    user_id=current_user.id if current_user else None,
                    action=AuditAction.CREATE.value,
                    entity_type=EntityType.REQUIREMENT.value,
                    entity_id=db_requirement.id,
                    project_id=db_requirement.project_id,
                    description=f"Requirement created: {db_requirement.title or 'Untitled'}",
                )
                audit_service.create_audit_trail(audit_data)
            except Exception as e:
                print(f"Failed to create audit trail for requirement creation: {e}")
            
            return db_requirement
        except IntegrityError as e:
            db.rollback()
            if "requirements.requirement_id" in str(e):
                raise HTTPException(status_code=400, detail="Requirement ID already exists. Please use a unique ID.")
            raise HTTPException(status_code=400, detail="Failed to create requirement due to a database constraint violation.")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.get("/requirements", response_model=List[schemas.Requirement])
    def read_requirements(
        project_id: int,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return get_requirements(db, project_id=project_id, skip=skip, limit=limit)

    @app.post("/requirements/fetch-external-document", response_model=schemas.RequirementExternalDocumentResponse)
    def fetch_external_requirement_document(
        request: schemas.RequirementExternalDocumentRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", request.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            return fetch_requirement_source(db=db, project_id=request.project_id, url=request.url)
        except PermissionError as e:
            logger.warning("Atlassian document permission error for project %s: %s", request.project_id, e)
            raise HTTPException(status_code=403, detail=str(e))
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except TimeoutError as e:
            logger.warning("Atlassian document fetch timed out for project %s: %s", request.project_id, e)
            raise HTTPException(status_code=504, detail=str(e))
        except ConnectionError as e:
            logger.warning("Atlassian document connection error for project %s: %s", request.project_id, e)
            raise HTTPException(status_code=502, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.exception("Unexpected error fetching requirement source for project %s", request.project_id)
            raise HTTPException(status_code=502, detail="Unable to fetch the external document.")

    @app.get("/requirements/{requirement_id}/test-cases", response_model=schemas.RequirementLinkedTestCaseList)
    def search_requirement_test_cases(
        requirement_id: int,
        search: Optional[str] = Query(None, max_length=100),
        linked: Optional[bool] = Query(None),
        status: Optional[str] = Query(None, max_length=20),
        priority: Optional[str] = Query(None, max_length=20),
        suite_id: Optional[int] = Query(None, ge=1),
        section_id: Optional[int] = Query(None, ge=1),
        skip: int = Query(0, ge=0),
        limit: int = Query(25, ge=1, le=100),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        requirement = _get_requirement_or_404(db, requirement_id)
        if not rbac.has_permission(current_user, "read", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        link_map = _requirement_link_map(db, requirement)
        linked_test_case_ids = list(link_map.keys())
        query = _project_test_case_query(db, requirement.project_id).options(
            joinedload(models.TestCase.test_suite),
            joinedload(models.TestCase.section),
        )

        if linked is True:
            if not linked_test_case_ids:
                return schemas.RequirementLinkedTestCaseList(
                    items=[],
                    total=0,
                    skip=skip,
                    limit=limit,
                    summary=_requirement_traceability_summary(db, requirement),
                )
            query = query.filter(models.TestCase.id.in_(linked_test_case_ids))
        elif linked is False and linked_test_case_ids:
            query = query.filter(models.TestCase.id.notin_(linked_test_case_ids))

        if status:
            query = query.filter(models.TestCase.status == status)
        if priority:
            query = query.filter(models.TestCase.priority == priority)
        if suite_id:
            query = query.filter(models.TestCase.test_suite_id == suite_id)
        if section_id:
            query = query.filter(models.TestCase.section_id == section_id)

        if search and search.strip():
            search_value = search.strip()
            search_filters = [
                models.TestCase.title.ilike(f"%{search_value}%"),
                models.TestCase.reference.ilike(f"%{search_value}%"),
                models.TestCase.tags.ilike(f"%{search_value}%"),
                cast(models.TestCase.id, String).ilike(f"%{search_value}%"),
            ]
            numeric_search = search_value.upper().replace("TC-", "")
            if numeric_search.isdigit():
                search_filters.append(models.TestCase.id == int(numeric_search))
            query = query.filter(or_(*search_filters))

        total = query.count()
        test_cases = query.order_by(models.TestCase.id.asc()).offset(skip).limit(limit).all()
        return schemas.RequirementLinkedTestCaseList(
            items=[
                _test_case_to_linked_response(
                    db,
                    test_case,
                    link_id=link_map.get(test_case.id),
                    linked=test_case.id in link_map,
                )
                for test_case in test_cases
            ],
            total=total,
            skip=skip,
            limit=limit,
            summary=_requirement_traceability_summary(db, requirement),
        )

    @app.post("/requirements/{requirement_id}/test-cases/bulk", response_model=schemas.RequirementLinkedTestCaseBulkResponse)
    def bulk_update_requirement_test_cases(
        requirement_id: int,
        request: schemas.RequirementLinkedTestCaseBulkRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        requirement = _get_requirement_or_404(db, requirement_id)
        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        test_cases = _get_valid_project_test_cases(db, requirement, request.test_case_ids)
        test_cases_by_id = {test_case.id: test_case for test_case in test_cases}
        existing_entries = db.query(models.TraceabilityMatrix).filter(
            models.TraceabilityMatrix.requirement_id == requirement.id,
            models.TraceabilityMatrix.test_case_id.in_(test_cases_by_id.keys()),
        ).all()
        existing_by_test_case_id = {entry.test_case_id: entry for entry in existing_entries}
        combined_link_map = _requirement_link_map(db, requirement)

        linked_count = 0
        unlinked_count = 0
        skipped_count = 0
        audit_events = []
        try:
            if request.action == "link":
                for test_case in test_cases:
                    if test_case.id in existing_by_test_case_id:
                        skipped_count += 1
                        test_case.reference = _add_requirement_reference(test_case.reference, requirement.requirement_id)
                        _ensure_association_link(db, requirement.id, test_case.id)
                        continue
                    entry = models.TraceabilityMatrix(
                        requirement_id=requirement.id,
                        test_case_id=test_case.id,
                        coverage_type="functional",
                        coverage_percentage=100.0,
                    )
                    db.add(entry)
                    test_case.reference = _add_requirement_reference(test_case.reference, requirement.requirement_id)
                    _ensure_association_link(db, requirement.id, test_case.id)
                    db.flush()
                    linked_count += 1
                    audit_events.append(("link", test_case, entry.id))
            else:
                for entry in existing_entries:
                    test_case = test_cases_by_id.get(entry.test_case_id)
                    if test_case:
                        test_case.reference = _remove_requirement_reference(test_case.reference, requirement.requirement_id)
                        _delete_association_link(db, requirement.id, test_case.id)
                    db.delete(entry)
                    unlinked_count += 1
                    audit_events.append(("unlink", test_case, entry.id))
                for test_case in test_cases:
                    if test_case.id not in existing_by_test_case_id and test_case.id in combined_link_map:
                        test_case.reference = _remove_requirement_reference(test_case.reference, requirement.requirement_id)
                        _delete_association_link(db, requirement.id, test_case.id)
                        unlinked_count += 1
                        audit_events.append(("unlink", test_case, None))
                skipped_count = len(test_cases) - unlinked_count

            db.commit()
        except IntegrityError:
            db.rollback()
            logger.warning("Duplicate requirement test case link detected during bulk update")
            raise HTTPException(status_code=409, detail="One or more test cases are already linked to this requirement. Refresh and try again.")
        except Exception:
            db.rollback()
            logger.exception("Failed to bulk update requirement test case links")
            raise HTTPException(status_code=500, detail="Failed to update requirement test case links")

        for action, test_case, link_id in audit_events:
            if test_case:
                _audit_requirement_tc_link(db, current_user, requirement, test_case, action, link_id)

        link_map = _requirement_link_map(db, requirement)
        refreshed_test_cases = _get_valid_project_test_cases(db, requirement, list(test_cases_by_id.keys()))
        return schemas.RequirementLinkedTestCaseBulkResponse(
            linked_count=linked_count,
            unlinked_count=unlinked_count,
            skipped_count=skipped_count,
            items=[
                _test_case_to_linked_response(
                    db,
                    test_case,
                    link_id=link_map.get(test_case.id),
                    linked=test_case.id in link_map,
                )
                for test_case in refreshed_test_cases
            ],
            summary=_requirement_traceability_summary(db, requirement),
        )

    @app.post("/requirements/{requirement_id}/test-cases", response_model=schemas.RequirementLinkedTestCase)
    def create_and_link_requirement_test_case(
        requirement_id: int,
        test_case: schemas.RequirementLinkedTestCaseCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        requirement = _get_requirement_or_404(db, requirement_id)
        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not test_suite or test_suite.project_id != requirement.project_id:
            raise HTTPException(status_code=400, detail="Test suite must belong to this requirement project")

        try:
            db_test_case = crud.create_test_case(db=db, test_case=test_case, created_by=current_user.id)
            entry = models.TraceabilityMatrix(
                requirement_id=requirement.id,
                test_case_id=db_test_case.id,
                coverage_type="functional",
                coverage_percentage=100.0,
            )
            db.add(entry)
            _ensure_association_link(db, requirement.id, db_test_case.id)
            db.commit()
            db.refresh(entry)
            db.refresh(db_test_case)
        except ValueError as e:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(e))
        except IntegrityError:
            db.rollback()
            logger.warning("Duplicate requirement test case link detected while creating a test case")
            raise HTTPException(status_code=409, detail="The requirement test case link already exists. Refresh and try again.")
        except Exception:
            db.rollback()
            logger.exception("Failed to create and link test case for requirement %s", requirement.id)
            raise HTTPException(status_code=500, detail="Failed to create and link test case")

        _audit_requirement_tc_link(db, current_user, requirement, db_test_case, "link", entry.id)
        return _test_case_to_linked_response(db, db_test_case, link_id=entry.id, linked=True)

    @app.get("/requirements/{requirement_id}/test-cases/history", response_model=schemas.RequirementLinkedTestCaseHistory)
    def get_requirement_test_case_link_history(
        requirement_id: int,
        offset: int = Query(0, ge=0),
        limit: int = Query(20, ge=1, le=100),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        requirement = _get_requirement_or_404(db, requirement_id)
        if not rbac.has_permission(current_user, "read", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        metadata_text = cast(models.AuditTrail.additional_metadata, String)
        requirement_filters = [
            models.AuditTrail.description.ilike(f"%requirement {requirement.id}%"),
            metadata_text.ilike(f'%"requirement_id": {requirement.id}%'),
            metadata_text.ilike(f'%"requirement_id":"{requirement.id}"%'),
            metadata_text.ilike(f'%"requirement_key": "{requirement.requirement_id}"%'),
            metadata_text.ilike(f'%"requirement_key":"{requirement.requirement_id}"%'),
        ]
        query = db.query(models.AuditTrail).options(
            joinedload(models.AuditTrail.user)
        ).filter(
            models.AuditTrail.project_id == requirement.project_id,
            models.AuditTrail.entity_type == models.EntityType.TRACEABILITY_ENTRY,
            models.AuditTrail.action.in_([models.AuditAction.CREATE, models.AuditAction.DELETE]),
            or_(*requirement_filters),
        )

        total = query.count()
        audit_rows = query.order_by(models.AuditTrail.created_at.desc()).offset(offset).limit(limit).all()
        requirement_history = []
        for audit_row in audit_rows:
            metadata = audit_row.additional_metadata or {}
            action = metadata.get("link_action") or ("link" if _enum_value(audit_row.action) == "create" else "unlink")
            requirement_history.append(schemas.RequirementLinkedTestCaseHistoryItem(
                id=audit_row.id,
                action=action,
                test_case_id=metadata.get("test_case_id"),
                test_case_title=metadata.get("test_case_title"),
                user_id=audit_row.user_id,
                username=audit_row.user.username if audit_row.user else None,
                full_name=audit_row.user.full_name if audit_row.user else None,
                created_at=audit_row.created_at,
                description=audit_row.description,
            ))

        return schemas.RequirementLinkedTestCaseHistory(
            items=requirement_history,
            total=total,
            limit=limit,
            offset=offset,
        )

    @app.get("/requirements/{requirement_id}/test-plans", response_model=schemas.RequirementLinkedTestPlanList)
    def search_requirement_test_plans(
        requirement_id: int,
        search: Optional[str] = Query(None, max_length=100),
        linked: Optional[bool] = Query(None),
        status: Optional[str] = Query(None, max_length=20),
        milestone_id: Optional[int] = Query(None, ge=1),
        skip: int = Query(0, ge=0),
        limit: int = Query(25, ge=1, le=100),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        requirement = _get_requirement_or_404(db, requirement_id)
        if not rbac.has_permission(current_user, "read", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        linked_plan_ids = _linked_requirement_test_plan_ids(db, requirement.id)
        query = db.query(models.TestPlan).options(joinedload(models.TestPlan.milestone)).filter(
            models.TestPlan.project_id == requirement.project_id,
        )

        if linked is True:
            if not linked_plan_ids:
                return schemas.RequirementLinkedTestPlanList(items=[], total=0, skip=skip, limit=limit)
            query = query.filter(models.TestPlan.id.in_(linked_plan_ids))
        elif linked is False and linked_plan_ids:
            query = query.filter(models.TestPlan.id.notin_(linked_plan_ids))

        if status:
            try:
                query = query.filter(models.TestPlan.status == models.TestStatus(status))
            except ValueError:
                return schemas.RequirementLinkedTestPlanList(items=[], total=0, skip=skip, limit=limit)
        if milestone_id:
            query = query.filter(models.TestPlan.milestone_id == milestone_id)
        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.filter(or_(
                models.TestPlan.title.ilike(term),
                models.TestPlan.description.ilike(term),
                models.TestPlan.test_objectives.ilike(term),
                cast(models.TestPlan.id, String).ilike(term),
            ))

        total = query.count()
        test_plans = query.order_by(models.TestPlan.created_at.desc()).offset(skip).limit(limit).all()
        return schemas.RequirementLinkedTestPlanList(
            items=[
                _test_plan_to_requirement_response(test_plan, linked=test_plan.id in linked_plan_ids)
                for test_plan in test_plans
            ],
            total=total,
            skip=skip,
            limit=limit,
        )

    @app.post("/requirements/{requirement_id}/test-plans/bulk", response_model=schemas.RequirementLinkedTestPlanBulkResponse)
    def bulk_update_requirement_test_plans(
        requirement_id: int,
        request: schemas.RequirementLinkedTestPlanBulkRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        requirement = _get_requirement_or_404(db, requirement_id)
        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        unique_plan_ids = list(dict.fromkeys(request.test_plan_ids))
        test_plans = db.query(models.TestPlan).filter(models.TestPlan.id.in_(unique_plan_ids)).all()
        test_plans_by_id = {test_plan.id: test_plan for test_plan in test_plans}
        missing_ids = [test_plan_id for test_plan_id in unique_plan_ids if test_plan_id not in test_plans_by_id]
        if missing_ids:
            raise HTTPException(status_code=404, detail=f"Test plan(s) not found: {missing_ids}")
        wrong_project_ids = [
            test_plan.id
            for test_plan in test_plans
            if test_plan.project_id != requirement.project_id
        ]
        if wrong_project_ids:
            raise HTTPException(status_code=400, detail=f"Test plan(s) do not belong to this requirement project: {wrong_project_ids}")

        linked_plan_ids = _linked_requirement_test_plan_ids(db, requirement.id)
        linked_count = 0
        unlinked_count = 0
        skipped_count = 0

        try:
            if request.action == "link":
                for test_plan_id in unique_plan_ids:
                    if test_plan_id in linked_plan_ids:
                        skipped_count += 1
                        continue
                    db.execute(models.requirement_test_plan_links.insert().values(
                        requirement_id=requirement.id,
                        test_plan_id=test_plan_id,
                    ))
                    linked_count += 1
            else:
                for test_plan_id in unique_plan_ids:
                    if test_plan_id not in linked_plan_ids:
                        skipped_count += 1
                        continue
                    db.execute(models.requirement_test_plan_links.delete().where(
                        models.requirement_test_plan_links.c.requirement_id == requirement.id,
                        models.requirement_test_plan_links.c.test_plan_id == test_plan_id,
                    ))
                    unlinked_count += 1
            db.commit()
        except IntegrityError:
            db.rollback()
            logger.warning("Duplicate requirement test plan link detected during bulk update")
            raise HTTPException(status_code=409, detail="One or more test plans are already linked to this requirement. Refresh and try again.")
        except Exception:
            db.rollback()
            logger.exception("Failed to update requirement test plan links")
            raise HTTPException(status_code=500, detail="Failed to update requirement test plan links")

        refreshed_linked_ids = _linked_requirement_test_plan_ids(db, requirement.id)
        refreshed_test_plans = db.query(models.TestPlan).options(joinedload(models.TestPlan.milestone)).filter(
            models.TestPlan.id.in_(unique_plan_ids),
        ).order_by(models.TestPlan.created_at.desc()).all()
        return schemas.RequirementLinkedTestPlanBulkResponse(
            linked_count=linked_count,
            unlinked_count=unlinked_count,
            skipped_count=skipped_count,
            items=[
                _test_plan_to_requirement_response(test_plan, linked=test_plan.id in refreshed_linked_ids)
                for test_plan in refreshed_test_plans
            ],
        )

    @app.get("/requirements/{requirement_id}/relationships", response_model=schemas.RequirementRelationshipSummary)
    def get_requirement_relationships(
        requirement_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        requirement = _get_requirement_or_404(db, requirement_id)
        if not rbac.has_permission(current_user, "read", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        link_map = _requirement_link_map(db, requirement)
        linked_test_case_ids = list(link_map.keys())
        linked_plan_ids = list(_linked_requirement_test_plan_ids(db, requirement.id))

        run_filters = []
        if linked_plan_ids:
            run_filters.append(models.TestRun.test_plan_id.in_(linked_plan_ids))
        if linked_test_case_ids:
            run_filters.append(models.TestRun.id.in_(
                db.query(models.TestResult.test_run_id).filter(models.TestResult.test_case_id.in_(linked_test_case_ids))
            ))

        test_run_query = db.query(models.TestRun).filter(models.TestRun.project_id == requirement.project_id)
        if run_filters:
            test_run_query = test_run_query.filter(or_(*run_filters))
        else:
            test_run_query = test_run_query.filter(False)

        related_test_run_ids = test_run_query.with_entities(models.TestRun.id)
        test_runs = test_run_query.order_by(models.TestRun.created_at.desc()).limit(10).all()

        defect_filters = [models.Defect.requirement_id == requirement.id]
        if linked_test_case_ids:
            defect_filters.append(models.Defect.test_case_id.in_(linked_test_case_ids))
        if run_filters:
            defect_filters.append(models.Defect.test_run_id.in_(related_test_run_ids))
        defect_query = db.query(models.Defect).filter(
            models.Defect.project_id == requirement.project_id,
            or_(*defect_filters),
        )
        defects = defect_query.order_by(models.Defect.created_at.desc()).limit(10).all()

        test_plan_query = db.query(models.TestPlan).options(joinedload(models.TestPlan.milestone)).filter(
            models.TestPlan.project_id == requirement.project_id,
        )
        if linked_plan_ids:
            test_plan_query = test_plan_query.filter(models.TestPlan.id.in_(linked_plan_ids))
        else:
            test_plan_query = test_plan_query.filter(False)
        test_plans = test_plan_query.order_by(models.TestPlan.created_at.desc()).limit(10).all()

        milestone_items = []
        seen_milestones = set()
        for test_plan in test_plans:
            if test_plan.milestone and test_plan.milestone.id not in seen_milestones:
                seen_milestones.add(test_plan.milestone.id)
                milestone_items.append({
                    "id": test_plan.milestone.id,
                    "title": test_plan.milestone.title,
                    "status": _enum_value(test_plan.milestone.status),
                    "target_date": test_plan.milestone.target_date,
                })

        coverage_query = db.query(models.CoverageReport).filter(models.CoverageReport.project_id == requirement.project_id)
        if run_filters:
            coverage_query = coverage_query.filter(or_(
                models.CoverageReport.test_run_id.in_(related_test_run_ids),
                models.CoverageReport.test_run_id.is_(None),
            ))

        return schemas.RequirementRelationshipSummary(
            test_cases=_requirement_traceability_summary(db, requirement),
            defects=schemas.RequirementRelationshipCount(
                total=defect_query.count(),
                items=[
                    {
                        "id": defect.id,
                        "defect_id": defect.defect_id,
                        "title": defect.title,
                        "status": _enum_value(defect.status),
                        "severity": _enum_value(defect.severity),
                        "priority": _enum_value(defect.priority),
                    }
                    for defect in defects
                ],
            ),
            test_plans=schemas.RequirementRelationshipCount(
                total=test_plan_query.count(),
                items=[
                    {
                        "id": test_plan.id,
                        "title": test_plan.title,
                        "status": _enum_value(test_plan.status),
                        "milestone_id": test_plan.milestone_id,
                        "milestone_title": test_plan.milestone.title if test_plan.milestone else None,
                    }
                    for test_plan in test_plans
                ],
            ),
            milestones=schemas.RequirementRelationshipCount(
                total=len(milestone_items),
                items=milestone_items,
            ),
            test_runs=schemas.RequirementRelationshipCount(
                total=test_run_query.count(),
                items=[
                    {
                        "id": test_run.id,
                        "name": test_run.name,
                        "status": test_run.status,
                        "test_plan_id": test_run.test_plan_id,
                        "milestone_id": test_run.milestone_id,
                    }
                    for test_run in test_runs
                ],
            ),
            coverage_reports=schemas.RequirementRelationshipCount(
                total=coverage_query.count(),
                items=[
                    {
                        "id": report.id,
                        "report_type": report.report_type,
                        "coverage_percentage": report.coverage_percentage,
                        "test_run_id": report.test_run_id,
                    }
                    for report in coverage_query.order_by(models.CoverageReport.generated_at.desc()).limit(10).all()
                ],
            ),
        )

    @app.get("/requirements/{requirement_id}", response_model=schemas.Requirement)
    def read_requirement(
        requirement_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        requirement = get_requirement(db, requirement_id=requirement_id)
        if requirement is None:
            raise HTTPException(status_code=404, detail="Requirement not found")

        if not rbac.has_permission(current_user, "read", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return requirement

    @app.put("/requirements/{requirement_id}", response_model=schemas.Requirement)
    def update_requirement_endpoint(
        requirement_id: int,
        requirement: schemas.RequirementUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_requirement = get_requirement(db, requirement_id=requirement_id)
        if db_requirement is None:
            raise HTTPException(status_code=404, detail="Requirement not found")

        if not rbac.has_permission(current_user, "write", db_requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            db_requirement = update_requirement(db, requirement_id=requirement_id, requirement=requirement)
            
            # Create audit trail
            try:
                from ..services.audit_service import get_audit_service
                from ..schemas_audit import AuditTrailCreate
                from ..models import AuditAction, EntityType
                audit_service = get_audit_service(db)
                audit_data = AuditTrailCreate(
                    user_id=current_user.id if current_user else None,
                    action=AuditAction.UPDATE.value,
                    entity_type=EntityType.REQUIREMENT.value,
                    entity_id=db_requirement.id,
                    project_id=db_requirement.project_id,
                    description=f"Requirement updated: {db_requirement.title or 'Untitled'}",
                )
                audit_service.create_audit_trail(audit_data)
            except Exception as e:
                print(f"Failed to create audit trail for requirement update: {e}")
            
            return db_requirement
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.delete("/requirements/{requirement_id}")
    def delete_requirement_endpoint(
        requirement_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_requirement = get_requirement(db, requirement_id=requirement_id)
        if db_requirement is None:
            raise HTTPException(status_code=404, detail="Requirement not found")

        if not rbac.has_permission(current_user, "delete", db_requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Store data for audit trail before deletion
        req_id = db_requirement.id
        req_title = db_requirement.title
        project_id = db_requirement.project_id
        
        delete_requirement(db, requirement_id=requirement_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.REQUIREMENT.value,
                entity_id=req_id,
                project_id=project_id,
                description=f"Requirement deleted: {req_title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for requirement deletion: {e}")
        
        return {"message": "Requirement deleted successfully"}

    # Defects Endpoints
    @app.post("/defects", response_model=schemas.Defect)
    def create_defect_endpoint(
        defect: schemas.DefectCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        _validate_requirement_project(db, defect.requirement_id, defect.project_id)
        defect = defect.model_copy(update={"reported_by": current_user.id})
        db_defect = create_defect(db=db, defect=defect)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.DEFECT.value,
                entity_id=db_defect.id,
                project_id=db_defect.project_id,
                description=f"Defect created: {db_defect.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for defect creation: {e}")
        
        return db_defect

    @app.get("/defects", response_model=List[schemas.Defect])
    def read_defects(
        project_id: int,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return get_defects(db, project_id=project_id, skip=skip, limit=limit)

    @app.get("/defects/{defect_id}", response_model=schemas.Defect)
    def read_defect(
        defect_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        defect = get_defect(db, defect_id=defect_id)
        if defect is None:
            raise HTTPException(status_code=404, detail="Defect not found")

        if not rbac.has_permission(current_user, "read", defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return defect

    @app.put("/defects/{defect_id}", response_model=schemas.Defect)
    def update_defect_endpoint(
        defect_id: int,
        defect: schemas.DefectUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_defect = get_defect(db, defect_id=defect_id)
        if db_defect is None:
            raise HTTPException(status_code=404, detail="Defect not found")

        if not rbac.has_permission(current_user, "write", db_defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        _validate_requirement_project(db, defect.requirement_id, db_defect.project_id)
        db_defect = update_defect(db, defect_id=defect_id, defect=defect)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.DEFECT.value,
                entity_id=db_defect.id,
                project_id=db_defect.project_id,
                description=f"Defect updated: {db_defect.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for defect update: {e}")
        
        return db_defect

    @app.delete("/defects/{defect_id}")
    def delete_defect_endpoint(
        defect_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_defect = get_defect(db, defect_id=defect_id)
        if db_defect is None:
            raise HTTPException(status_code=404, detail="Defect not found")

        if not rbac.has_permission(current_user, "delete", db_defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Store data for audit trail before deletion
        defect_id_val = db_defect.id
        defect_title = db_defect.title
        project_id = db_defect.project_id
        
        delete_defect(db, defect_id=defect_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.DEFECT.value,
                entity_id=defect_id_val,
                project_id=project_id,
                description=f"Defect deleted: {defect_title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for defect deletion: {e}")
        
        return {"message": "Defect deleted successfully"}

    # Test Plans Endpoints
    @app.post("/test-plans", response_model=schemas.TestPlan)
    def create_test_plan_endpoint(
        test_plan: schemas.TestPlanCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Validate milestone belongs to the same project
        if test_plan.milestone_id is not None:
            from ..models import Milestone as _MS
            ms = db.query(_MS).filter(_MS.id == test_plan.milestone_id).first()
            if ms is None:
                raise HTTPException(status_code=404, detail="Milestone not found")
            if ms.project_id != test_plan.project_id:
                raise HTTPException(status_code=400, detail="Milestone does not belong to this project")

        # Always set created_by from the authenticated user (security: ignore client-supplied value)
        test_plan_data = test_plan.model_copy(update={"created_by": current_user.id})
        db_test_plan = create_test_plan(db=db, test_plan=test_plan_data)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.TEST_PLAN.value,
                entity_id=db_test_plan.id,
                project_id=db_test_plan.project_id,
                description=f"Test plan created: {db_test_plan.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test plan creation: {e}")
        
        return db_test_plan

    @app.get("/test-plans")
    def read_test_plans(
        project_id: Optional[int] = None,
        milestone_id: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        sort_by: Optional[str] = "created_at",
        sort_order: Optional[str] = "desc",
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if project_id is not None and not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        test_plans = get_test_plans(
            db,
            project_id=project_id,
            milestone_id=milestone_id,
            status=status,
            search=search,
            sort_by=sort_by,
            sort_order=sort_order,
            skip=skip,
            limit=limit,
        )

        from ..models import TestRun as TR, Milestone as MS
        from sqlalchemy import func as sqlfunc

        # Build test_run counts in a single query for performance
        plan_ids = [tp.id for tp in test_plans]
        if plan_ids:
            counts_q = (
                db.query(TR.test_plan_id, sqlfunc.count(TR.id).label("cnt"))
                .filter(TR.test_plan_id.in_(plan_ids))
                .group_by(TR.test_plan_id)
                .all()
            )
            run_counts = {row.test_plan_id: row.cnt for row in counts_q}
        else:
            run_counts = {}

        return [
            {
                "id": tp.id,
                "title": tp.title,
                "description": tp.description,
                "project_id": tp.project_id,
                "milestone_id": tp.milestone_id,
                "milestone_title": tp.milestone.title if tp.milestone else None,
                "created_by": tp.created_by,
                "status": tp.status.value if tp.status else None,
                "target_start_date": tp.target_start_date,
                "target_end_date": tp.target_end_date,
                "actual_start_date": tp.actual_start_date,
                "actual_end_date": tp.actual_end_date,
                "test_objectives": tp.test_objectives,
                "scope_inclusions": tp.scope_inclusions,
                "scope_exclusions": tp.scope_exclusions,
                "test_environment": tp.test_environment,
                "entry_criteria": tp.entry_criteria,
                "exit_criteria": tp.exit_criteria,
                "risks_assumptions": tp.risks_assumptions,
                "test_run_count": run_counts.get(tp.id, 0),
                "created_at": tp.created_at,
                "updated_at": tp.updated_at,
            }
            for tp in test_plans
        ]

    @app.get("/test-plans/{test_plan_id}")
    def read_test_plan_endpoint(
        test_plan_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_plan = get_test_plan(db, test_plan_id=test_plan_id)
        if test_plan is None:
            raise HTTPException(status_code=404, detail="Test plan not found")

        if not rbac.has_permission(current_user, "read", test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        from ..models import TestRun as TR
        from sqlalchemy import func as sqlfunc

        run_count = (
            db.query(sqlfunc.count(TR.id))
            .filter(TR.test_plan_id == test_plan.id)
            .scalar()
        ) or 0

        return {
            "id": test_plan.id,
            "title": test_plan.title,
            "description": test_plan.description,
            "project_id": test_plan.project_id,
            "milestone_id": test_plan.milestone_id,
            "milestone_title": test_plan.milestone.title if test_plan.milestone else None,
            "created_by": test_plan.created_by,
            "status": test_plan.status.value if test_plan.status else None,
            "target_start_date": test_plan.target_start_date,
            "target_end_date": test_plan.target_end_date,
            "actual_start_date": test_plan.actual_start_date,
            "actual_end_date": test_plan.actual_end_date,
            "test_objectives": test_plan.test_objectives,
            "scope_inclusions": test_plan.scope_inclusions,
            "scope_exclusions": test_plan.scope_exclusions,
            "test_environment": test_plan.test_environment,
            "entry_criteria": test_plan.entry_criteria,
            "exit_criteria": test_plan.exit_criteria,
            "risks_assumptions": test_plan.risks_assumptions,
            "test_run_count": run_count,
            "created_at": test_plan.created_at,
            "updated_at": test_plan.updated_at,
        }

    @app.put("/test-plans/{test_plan_id}", response_model=schemas.TestPlan)
    def update_test_plan_endpoint(
        test_plan_id: int,
        test_plan: schemas.TestPlanUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_test_plan = get_test_plan(db, test_plan_id=test_plan_id)
        if db_test_plan is None:
            raise HTTPException(status_code=404, detail="Test plan not found")

        if not rbac.has_permission(current_user, "write", db_test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Validate milestone belongs to the same project
        if test_plan.milestone_id is not None:
            from ..models import Milestone as _MS
            ms = db.query(_MS).filter(_MS.id == test_plan.milestone_id).first()
            if ms is None:
                raise HTTPException(status_code=404, detail="Milestone not found")
            if ms.project_id != db_test_plan.project_id:
                raise HTTPException(status_code=400, detail="Milestone does not belong to this project")

        db_test_plan = update_test_plan(db, test_plan_id=test_plan_id, test_plan=test_plan)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_PLAN.value,
                entity_id=db_test_plan.id,
                project_id=db_test_plan.project_id,
                description=f"Test plan updated: {db_test_plan.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test plan update: {e}")
        
        return db_test_plan

    @app.delete("/test-plans/{test_plan_id}")
    def delete_test_plan_endpoint(
        test_plan_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_test_plan = get_test_plan(db, test_plan_id=test_plan_id)
        if db_test_plan is None:
            raise HTTPException(status_code=404, detail="Test plan not found")

        if not rbac.has_permission(current_user, "delete", db_test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Store data for audit trail before deletion
        plan_id = db_test_plan.id
        plan_title = db_test_plan.title
        project_id = db_test_plan.project_id

        # Nullify test_plan_id on linked test runs so they are not orphaned
        from ..models import TestRun as _TR
        db.query(_TR).filter(_TR.test_plan_id == plan_id).update({"test_plan_id": None})

        delete_test_plan(db, test_plan_id=test_plan_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.TEST_PLAN.value,
                entity_id=plan_id,
                project_id=project_id,
                description=f"Test plan deleted: {plan_title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test plan deletion: {e}")
        
        return {"message": "Test plan deleted successfully"}

    # Milestones Endpoints
    @app.post("/milestones", response_model=schemas.Milestone)
    def create_milestone_endpoint(
        milestone: schemas.MilestoneCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if milestone.project_id <= 0:
            raise HTTPException(status_code=400, detail="Invalid project_id")

        if not rbac.has_permission(current_user, "write", milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        milestone_data = milestone.model_copy(update={"created_by": current_user.id})
        db_milestone = create_milestone(db=db, milestone=milestone_data)

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.MILESTONE.value,
                entity_id=db_milestone.id,
                project_id=db_milestone.project_id,
                description=f"Milestone created: {db_milestone.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for milestone creation: {e}")

        return enrich_milestone(db, db_milestone)

    @app.get("/milestones", response_model=List[schemas.Milestone])
    def read_milestones(
        project_id: int,
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        milestones = get_milestones(db, project_id=project_id, skip=skip, limit=limit)
        return enrich_milestones(db, milestones)

    @app.get("/milestones/{milestone_id}", response_model=schemas.Milestone)
    def read_milestone_endpoint(
        milestone_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        milestone = get_milestone(db, milestone_id=milestone_id)
        if milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")

        if not rbac.has_permission(current_user, "read", milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return enrich_milestone(db, milestone)

    @app.put("/milestones/{milestone_id}", response_model=schemas.Milestone)
    def update_milestone_endpoint(
        milestone_id: int,
        milestone: schemas.MilestoneUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_milestone = get_milestone(db, milestone_id=milestone_id)
        if db_milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")

        if not rbac.has_permission(current_user, "write", db_milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        update_data = milestone.model_dump(exclude_unset=True)
        if update_data.get("status") == schemas.MilestoneStatus.COMPLETED:
            update_data.setdefault("progress_percentage", 100)
            if not update_data.get("actual_date") and not db_milestone.actual_date:
                update_data["actual_date"] = datetime.now(timezone.utc)
        db_milestone = update_milestone(
            db,
            milestone_id=milestone_id,
            milestone=schemas.MilestoneUpdate(**update_data),
        )

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.MILESTONE.value,
                entity_id=db_milestone.id,
                project_id=db_milestone.project_id,
                description=f"Milestone updated: {db_milestone.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for milestone update: {e}")

        return enrich_milestone(db, db_milestone)

    @app.delete("/milestones/{milestone_id}")
    def delete_milestone_endpoint(
        milestone_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_milestone = get_milestone(db, milestone_id=milestone_id)
        if db_milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")

        if not rbac.has_permission(current_user, "delete", db_milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        if db_milestone.test_plans:
            raise HTTPException(
                status_code=409,
                detail="Milestone has linked test plans. Unlink or move those plans before deleting it.",
            )

        milestone_id_val = db_milestone.id
        milestone_title = db_milestone.title
        project_id = db_milestone.project_id

        delete_milestone(db, milestone_id=milestone_id)

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.MILESTONE.value,
                entity_id=milestone_id_val,
                project_id=project_id,
                description=f"Milestone deleted: {milestone_title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for milestone deletion: {e}")

        return {"message": "Milestone deleted successfully"}

    @app.get("/milestones/stats/{project_id}")
    def get_milestone_stats(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return get_project_milestone_stats(db, project_id)

    @app.get("/milestones/{milestone_id}/test-plans")
    def get_milestone_test_plans(
        milestone_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        from ..models import Milestone, TestPlan

        milestone = db.query(Milestone).filter(Milestone.id == milestone_id).first()
        if not milestone:
            raise HTTPException(status_code=404, detail="Milestone not found")

        if not rbac.has_permission(current_user, "read", milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        test_plans = db.query(TestPlan).filter(TestPlan.milestone_id == milestone_id).all()
        return [
            {
                "id": tp.id,
                "title": tp.title,
                "description": tp.description,
                "status": tp.status.value if tp.status else None,
                "target_start_date": tp.target_start_date,
                "target_end_date": tp.target_end_date
            }
            for tp in test_plans
        ]
