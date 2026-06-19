"""
Requirements, defects, test plans, and milestones routes for test planning and quality management.
"""

import io
import logging
import re
import zipfile

from fastapi import Depends, File, Form, HTTPException, Path, Query, Response, UploadFile
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from typing import Dict, List, Optional
from datetime import datetime, timezone

from .. import crud, schemas, auth, rbac, models
from ..feature_guard import require_project_feature
from ..database import get_db
from ..auth import get_current_active_user
from ..services.milestone_service import enrich_milestone, enrich_milestones, get_project_milestone_stats
from ..services.atlassian_document_service import fetch_requirement_source
from ..services.tracker_import_service import fetch_requirement_from_tracker
from ..services import feature_file_service
from ..services import notification_engine
from ..services import watch_service
from ..services.doc_conversion_service import markdown_to_html, next_requirement_id
from ..crud import (
    create_requirement, get_requirements, get_requirement, update_requirement, delete_requirement,
    create_defect, get_defects, get_defect, update_defect, delete_defect,
    create_test_plan, get_test_plans, get_test_plan, update_test_plan, delete_test_plan,
    create_milestone, get_milestones, get_milestone, update_milestone, delete_milestone
)

logger = logging.getLogger(__name__)


FAILED_RESULT_STATUSES = {"fail", "failed"}


def _explain_defect_integrity_error(error: IntegrityError) -> str:
    """Translate database-level constraint violations into user-facing messages.

    Different backends phrase these differently (SQLite: ``UNIQUE constraint failed:
    defects.defect_id``, Postgres: ``duplicate key value violates unique constraint
    "defects_defect_id_key"``, MySQL: ``Duplicate entry 'X' for key 'defects.defect_id'``).
    We match on column references rather than a fixed phrase so the message is
    consistent across drivers.
    """
    raw = str(getattr(error, "orig", error)).lower()
    if "defect_id" in raw:
        return "Defect ID already exists. Please use a unique ID."
    if "foreign key" in raw or "violates foreign key" in raw:
        return "One of the linked records (project, test case, test run, requirement, or user) does not exist."
    if "not null" in raw or "null value" in raw:
        return "A required field is missing."
    if "unique" in raw or "duplicate" in raw:
        return "This defect conflicts with an existing record."
    return "Could not save defect due to a database constraint."
BLOCKED_RESULT_STATUSES = {"block", "blocked"}


def _is_auto_project_defect_id(value: str, project_id: int) -> bool:
    return re.fullmatch(rf"P{project_id}-DEF-\d+", value.strip(), flags=re.IGNORECASE) is not None


def _next_project_defect_id(db: Session, project_id: int) -> str:
    prefix = f"P{project_id}-DEF-"
    existing_ids = [
        row[0] for row in db.query(models.Defect.defect_id)
        .filter(models.Defect.defect_id.ilike(f"{prefix}%"))
        .all()
    ]
    highest = 0
    for defect_id in existing_ids:
        suffix = str(defect_id or "")[len(prefix):]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"{prefix}{highest + 1:03d}"


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


def _get_test_case_project_id(test_case: models.TestCase) -> Optional[int]:
    if test_case.project_id is not None:
        return test_case.project_id
    if test_case.test_suite:
        return test_case.test_suite.project_id
    return None


def _validate_defect_links(
    db: Session,
    project_id: int,
    test_case_id: Optional[int],
    test_run_id: Optional[int],
    requirement_id: Optional[int],
    assigned_to: Optional[int],
) -> None:
    _validate_requirement_project(db, requirement_id, project_id)

    if test_case_id is not None:
        test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if test_case is None:
            raise HTTPException(status_code=404, detail="Test case not found")
        if _get_test_case_project_id(test_case) != project_id:
            raise HTTPException(status_code=400, detail="Test case does not belong to this project")

    if test_run_id is not None:
        test_run = crud.get_test_run(db, test_run_id=test_run_id)
        if test_run is None:
            raise HTTPException(status_code=404, detail="Test run not found")
        if test_run.project_id != project_id:
            raise HTTPException(status_code=400, detail="Test run does not belong to this project")

    if test_case_id is not None and test_run_id is not None:
        linked_result = db.query(models.TestResult.id).filter(
            models.TestResult.test_case_id == test_case_id,
            models.TestResult.test_run_id == test_run_id,
        ).first()
        if linked_result is None:
            raise HTTPException(status_code=400, detail="Test case is not linked to this test run")

    if assigned_to is not None:
        assigned_user = db.query(models.User).filter(models.User.id == assigned_to).first()
        if assigned_user is None:
            raise HTTPException(status_code=404, detail="Assigned user not found")
        # Defect assignee must be able to read the project — admins/managers and
        # project owners/assignees pass; everyone else is rejected so we don't
        # quietly assign work to users who can't see the defect.
        if not rbac.has_permission(assigned_user, "read", project_id, db):
            raise HTTPException(
                status_code=400,
                detail="Assigned user does not have access to this project",
            )


def notify_defect_assignee(
    db: Session,
    defect: "models.Defect",
    assigned_by: Optional[schemas.User],
    previous_assigned_to: Optional[int] = None,
    batch: Optional[notification_engine.NotificationBatch] = None,
) -> None:
    """Send an in-app notification when a defect is newly assigned to a user.

    Mirrors ``_notify_test_run_assignee`` so a defect assignee learns about work
    the same way a test-run assignee does. No-op when the assignee is unchanged,
    on self-assignment, or when the defect is unassigned. When a ``batch`` is
    supplied the intent is added to it (the caller flushes once, de-duplicating
    against any colliding notification); otherwise it is emitted immediately.
    Notification delivery never blocks the write path.
    """
    assignee_id = defect.assigned_to
    if not assignee_id or assignee_id == previous_assigned_to:
        return
    if assigned_by is not None and assignee_id == assigned_by.id:
        return
    try:
        assignee = db.query(models.User).filter(
            models.User.id == assignee_id, models.User.is_active == True
        ).first()
        if not assignee:
            return
        actor = notification_engine.actor_display_name(assigned_by)
        label = defect.defect_id or defect.title or f"#{defect.id}"
        target = batch or notification_engine.NotificationBatch()
        target.add(
            category=notification_engine.ASSIGNMENT,
            user_ids=[assignee.id],
            actor_id=assigned_by.id if assigned_by else None,
            title="Defect assigned",
            message=f"{actor} assigned defect {label} to you.",
            related_entity_type="defect",
            related_entity_id=defect.id,
        )
        if batch is None:
            target.flush(db)
    except Exception:
        logger.exception(
            "Failed to create defect assignment notification",
            extra={"defect_id": getattr(defect, "id", None), "assignee_id": assignee_id},
        )


# Defect statuses that represent a resolution — these earn the celebratory SUCCESS
# styling instead of the neutral INFO used for ordinary status transitions.
_DEFECT_RESOLVED_STATUSES = {models.DefectStatus.FIXED, models.DefectStatus.CLOSED}

# Defect fields whose change is worth telling watchers about (noise like external
# sync bookkeeping is deliberately excluded). Used to diff the watch broadcast.
_DEFECT_WATCH_FIELDS = {
    "title", "description", "status", "severity", "priority", "assigned_to",
    "resolution", "root_cause", "steps_to_reproduce", "expected_result",
    "actual_result", "environment", "fix_version", "found_in_version",
}

# Test-plan fields whose change is worth telling watchers about.
_TEST_PLAN_WATCH_FIELDS = {
    "title", "description", "status", "assigned_to", "milestone_id",
    "target_start_date", "target_end_date", "test_objectives",
    "scope_inclusions", "scope_exclusions", "entry_criteria", "exit_criteria",
    "test_environment", "risks_assumptions",
}


def _defect_status_label(status) -> str:
    """Human-readable status (``in_progress`` -> ``in progress``) for messages."""
    raw = getattr(status, "value", status) or ""
    return str(raw).replace("_", " ")


def _changed_field_labels(before: dict, after, rename: Optional[dict] = None) -> list[str]:
    """Human-readable names of the fields whose value actually changed.

    ``before`` is a snapshot ``{field: old_value}`` captured before the write;
    ``after`` is the refreshed ORM row. Enums compare by identity correctly, so a
    no-op edit yields an empty list and the watch broadcast is suppressed upstream.
    """
    rename = rename or {}
    labels: list[str] = []
    for key, old in before.items():
        if old != getattr(after, key, None):
            labels.append(rename.get(key, key).replace("_", " "))
    return labels


def notify_defect_status_change(
    db: Session,
    defect: "models.Defect",
    changed_by: Optional[schemas.User],
    previous_status,
    batch: Optional[notification_engine.NotificationBatch] = None,
) -> None:
    """Notify the reporter and current assignee when a defect's status changes.

    Emits the engine's STATUS category — with SUCCESS styling when the defect was
    just resolved (fixed/closed), INFO otherwise — so both the person who filed the
    bug and the person who owns it learn it moved. No-op when the status is
    unchanged. The actor is never notified of their own change (the engine excludes
    them and drops deactivated recipients centrally). When a ``batch`` is supplied
    the intent is added to it so a save that *also* reassigns the defect de-duplicates
    via the ladder — the new assignee's ASSIGNMENT outranks this STATUS row, while the
    reporter still receives STATUS; otherwise it is emitted immediately.
    """
    new_status = defect.status
    if new_status == previous_status:
        return
    try:
        actor_id = changed_by.id if changed_by else None
        # Reporter + assignee; the engine de-dupes, excludes the actor, and filters
        # deactivated accounts, so a no-op for empty input is the only guard needed.
        recipients = [uid for uid in (defect.reported_by, defect.assigned_to) if uid]
        if not recipients:
            return
        actor = notification_engine.actor_display_name(changed_by)
        label = defect.defect_id or defect.title or f"#{defect.id}"
        resolved = new_status in _DEFECT_RESOLVED_STATUSES
        if resolved:
            title = "Defect resolved"
        elif new_status == models.DefectStatus.REOPENED:
            title = "Defect reopened"
        else:
            title = "Defect status changed"
        message = (
            f"{actor} changed defect {label} status from "
            f"{_defect_status_label(previous_status)} to {_defect_status_label(new_status)}."
        )
        target = batch or notification_engine.NotificationBatch()
        target.add(
            category=notification_engine.STATUS,
            user_ids=recipients,
            actor_id=actor_id,
            title=title,
            message=message,
            type_override=models.NotificationType.SUCCESS if resolved else None,
            related_entity_type="defect",
            related_entity_id=defect.id,
        )
        if batch is None:
            target.flush(db)
    except Exception:
        logger.exception(
            "Failed to create defect status-change notification",
            extra={"defect_id": getattr(defect, "id", None)},
        )


def notify_requirement_assignee(
    db: Session,
    requirement: "models.Requirement",
    assigned_by: Optional[schemas.User],
    previous_assigned_to: Optional[int] = None,
    batch: Optional[notification_engine.NotificationBatch] = None,
) -> None:
    """Send an in-app notification when a requirement is newly assigned to a user.

    Mirrors ``notify_defect_assignee`` so a requirement assignee learns about work
    the same way defect and test-run assignees do — and the alert lands in their
    Work Inbox via the engine's ASSIGNMENT category. No-op when the assignee is
    unchanged, on self-assignment, or when the requirement is unassigned. When a
    ``batch`` is supplied the intent is added to it (so a save that both reassigns
    and edits a watched requirement yields one row, not two); otherwise it is
    emitted immediately.
    """
    assignee_id = requirement.assigned_to
    if not assignee_id or assignee_id == previous_assigned_to:
        return
    if assigned_by is not None and assignee_id == assigned_by.id:
        return
    try:
        assignee = db.query(models.User).filter(
            models.User.id == assignee_id, models.User.is_active == True
        ).first()
        if not assignee:
            return
        actor = notification_engine.actor_display_name(assigned_by)
        label = requirement.requirement_id or requirement.title or f"#{requirement.id}"
        target = batch or notification_engine.NotificationBatch()
        target.add(
            category=notification_engine.ASSIGNMENT,
            user_ids=[assignee.id],
            actor_id=assigned_by.id if assigned_by else None,
            title="Requirement assigned",
            message=f"{actor} assigned requirement {label} to you.",
            related_entity_type="requirement",
            related_entity_id=requirement.id,
        )
        if batch is None:
            target.flush(db)
    except Exception:
        logger.exception(
            "Failed to create requirement assignment notification",
            extra={"requirement_id": getattr(requirement, "id", None), "assignee_id": assignee_id},
        )


def notify_test_plan_assignee(
    db: Session,
    test_plan: "models.TestPlan",
    assigned_by: Optional[schemas.User],
    previous_assigned_to: Optional[int] = None,
    batch: Optional[notification_engine.NotificationBatch] = None,
) -> None:
    """Send an in-app notification when a test plan is newly assigned to a user.

    The twin of ``notify_requirement_assignee``/``notify_defect_assignee`` so a
    test-plan owner learns about work the same way, landing in their Work Inbox via
    the engine's ASSIGNMENT category. No-op when the assignee is unchanged, on
    self-assignment, or when the plan is unassigned. When a ``batch`` is supplied
    the intent is added to it (flushed once by the caller); otherwise it is emitted
    immediately.
    """
    assignee_id = test_plan.assigned_to
    if not assignee_id or assignee_id == previous_assigned_to:
        return
    if assigned_by is not None and assignee_id == assigned_by.id:
        return
    try:
        assignee = db.query(models.User).filter(
            models.User.id == assignee_id, models.User.is_active == True
        ).first()
        if not assignee:
            return
        actor = notification_engine.actor_display_name(assigned_by)
        label = test_plan.title or f"#{test_plan.id}"
        target = batch or notification_engine.NotificationBatch()
        target.add(
            category=notification_engine.ASSIGNMENT,
            user_ids=[assignee.id],
            actor_id=assigned_by.id if assigned_by else None,
            title="Test plan assigned",
            message=f"{actor} assigned test plan {label} to you.",
            related_entity_type="test_plan",
            related_entity_id=test_plan.id,
        )
        if batch is None:
            target.flush(db)
    except Exception:
        logger.exception(
            "Failed to create test plan assignment notification",
            extra={"test_plan_id": getattr(test_plan, "id", None), "assignee_id": assignee_id},
        )


def notify_milestone_owner_assigned(
    db: Session,
    milestone: "models.Milestone",
    assigned_by: Optional[schemas.User],
    previous_owner_id: Optional[int] = None,
    batch: Optional[notification_engine.NotificationBatch] = None,
) -> None:
    """Send an in-app notification when a milestone owner is newly assigned.

    The twin of ``notify_test_plan_assignee``/``notify_requirement_assignee`` so a
    milestone owner learns about ownership the same way, landing in their Work Inbox
    via the engine's ASSIGNMENT category. This is the owner-*change* event; it is a
    distinct concern from the run-completion STATUS notice (``_notify_milestone_owner``)
    and never collides with it. No-op when the owner is unchanged, on self-assignment,
    or when the milestone is unowned. When a ``batch`` is supplied the intent is added
    to it (flushed once by the caller); otherwise it is emitted immediately.
    """
    owner_id = milestone.owner_id
    if not owner_id or owner_id == previous_owner_id:
        return
    if assigned_by is not None and owner_id == assigned_by.id:
        return
    try:
        owner = db.query(models.User).filter(
            models.User.id == owner_id, models.User.is_active == True
        ).first()
        if not owner:
            return
        actor = notification_engine.actor_display_name(assigned_by)
        label = milestone.title or f"#{milestone.id}"
        target = batch or notification_engine.NotificationBatch()
        target.add(
            category=notification_engine.ASSIGNMENT,
            user_ids=[owner.id],
            actor_id=assigned_by.id if assigned_by else None,
            title="Milestone assigned",
            message=f"{actor} made you owner of milestone {label}.",
            related_entity_type="milestone",
            related_entity_id=milestone.id,
        )
        if batch is None:
            target.flush(db)
    except Exception:
        logger.exception(
            "Failed to create milestone owner notification",
            extra={"milestone_id": getattr(milestone, "id", None), "owner_id": owner_id},
        )


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


def _get_test_plan_or_404(db: Session, test_plan_id: int):
    test_plan = db.query(models.TestPlan).filter(models.TestPlan.id == test_plan_id).first()
    if test_plan is None:
        raise HTTPException(status_code=404, detail="Test plan not found")
    return test_plan


def _linked_test_plan_requirement_ids(db: Session, test_plan_id: int) -> set[int]:
    rows = db.query(models.requirement_test_plan_links.c.requirement_id).filter(
        models.requirement_test_plan_links.c.test_plan_id == test_plan_id,
    ).all()
    return {row[0] for row in rows}


def _requirement_to_test_plan_response(requirement, linked: bool = False):
    return schemas.TestPlanLinkedRequirement(
        id=requirement.id,
        requirement_id=requirement.requirement_id,
        title=requirement.title,
        status=_enum_value(requirement.status),
        priority=_enum_value(requirement.priority),
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
    @app.post("/requirements", response_model=schemas.Requirement,
              dependencies=[Depends(require_project_feature("requirements"))])
    def create_requirement_endpoint(
        requirement: schemas.RequirementCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Authorship comes from the authenticated user, never the client payload
        # (prevents spoofing and invalid-foreign-key failures).
        requirement.created_by = current_user.id

        # The human-facing key (REQ-NNN) is derived from the project sequence on
        # insert — the client no longer supplies or can collide on it.
        requirement.requirement_id = None

        # Validate optional references so bad input fails clearly (not as a 500).
        if requirement.parent_requirement_id is not None:
            parent = get_requirement(db, requirement_id=requirement.parent_requirement_id)
            if parent is None:
                raise HTTPException(status_code=400, detail="Parent requirement not found")
            if parent.project_id != requirement.project_id:
                raise HTTPException(
                    status_code=400,
                    detail="Parent requirement must belong to the same project",
                )
        if requirement.assigned_to is not None:
            assignee = db.query(models.User).filter(models.User.id == requirement.assigned_to).first()
            if assignee is None:
                raise HTTPException(status_code=400, detail="Assigned user not found")
        if requirement.folder_id is not None:
            folder = crud.get_requirement_folder(db, requirement.folder_id)
            if folder is None or folder.project_id != requirement.project_id:
                raise HTTPException(status_code=400, detail="Folder not found in this project")

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
                logger.warning(f"Failed to create audit trail for requirement creation: {e}")

            notify_requirement_assignee(db, db_requirement, current_user)

            return db_requirement
        except IntegrityError as e:
            db.rollback()
            if "requirements.requirement_id" in str(e):
                raise HTTPException(status_code=400, detail="Requirement ID already exists. Please use a unique ID.")
            raise HTTPException(status_code=400, detail="Failed to create requirement due to a database constraint violation.")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.get("/requirements", response_model=List[schemas.Requirement],
             dependencies=[Depends(require_project_feature("requirements"))])
    def read_requirements(
        project_id: int,
        skip: int = 0,
        limit: int = 100,
        milestone_id: Optional[int] = Query(None, ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        if milestone_id is not None:
            milestone = db.query(models.Milestone).filter(models.Milestone.id == milestone_id).first()
            if milestone is None:
                raise HTTPException(status_code=404, detail="Milestone not found")
            if milestone.project_id != project_id:
                raise HTTPException(status_code=400, detail="Milestone does not belong to this project")

        return get_requirements(db, project_id=project_id, skip=skip, limit=limit, milestone_id=milestone_id)

    # ── Requirement folders / categories ────────────────────────────────────
    # Registered before the dynamic ``/requirements/{requirement_id}`` routes so
    # the literal ``/requirements/folders`` path is never parsed as an int id.
    @app.get("/requirements/folders", response_model=List[schemas.RequirementFolder])
    def list_requirement_folders(
        project_id: int = Query(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return crud.get_requirement_folders(db, project_id)

    @app.post("/requirements/folders", response_model=schemas.RequirementFolder)
    def create_requirement_folder_endpoint(
        folder: schemas.RequirementFolderCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if not rbac.has_permission(current_user, "write", folder.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if db.query(models.Project).filter(models.Project.id == folder.project_id).first() is None:
            raise HTTPException(status_code=404, detail="Project not found")
        if folder.parent_folder_id is not None:
            parent = crud.get_requirement_folder(db, folder.parent_folder_id)
            if parent is None or parent.project_id != folder.project_id:
                raise HTTPException(status_code=400, detail="Parent folder not found in this project")
        parent_filter = (
            models.RequirementFolder.parent_folder_id.is_(None)
            if folder.parent_folder_id is None
            else models.RequirementFolder.parent_folder_id == folder.parent_folder_id
        )
        duplicate = db.query(models.RequirementFolder.id).filter(
            models.RequirementFolder.project_id == folder.project_id,
            parent_filter,
            func.lower(models.RequirementFolder.name) == folder.name.strip().lower(),
        ).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="A folder with this name already exists here.")
        return crud.create_requirement_folder(db, folder)

    @app.put("/requirements/folders/{folder_id}", response_model=schemas.RequirementFolder)
    def update_requirement_folder_endpoint(
        payload: schemas.RequirementFolderUpdate,
        folder_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        db_folder = crud.get_requirement_folder(db, folder_id)
        if db_folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        if not rbac.has_permission(current_user, "write", db_folder.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if "parent_folder_id" in payload.model_fields_set and payload.parent_folder_id is not None:
            parent = crud.get_requirement_folder(db, payload.parent_folder_id)
            if parent is None or parent.project_id != db_folder.project_id:
                raise HTTPException(status_code=400, detail="Parent folder not found in this project")
            if payload.parent_folder_id in crud._requirement_folder_descendant_ids(db, folder_id):
                raise HTTPException(status_code=400, detail="Cannot move a folder into itself or its own descendant.")
        # Reject duplicate sibling names after applying the requested rename/move.
        effective_name = (payload.name.strip() if payload.name else db_folder.name)
        effective_parent = (
            payload.parent_folder_id
            if "parent_folder_id" in payload.model_fields_set
            else db_folder.parent_folder_id
        )
        sibling_parent_filter = (
            models.RequirementFolder.parent_folder_id.is_(None)
            if effective_parent is None
            else models.RequirementFolder.parent_folder_id == effective_parent
        )
        duplicate = db.query(models.RequirementFolder.id).filter(
            models.RequirementFolder.project_id == db_folder.project_id,
            models.RequirementFolder.id != folder_id,
            sibling_parent_filter,
            func.lower(models.RequirementFolder.name) == effective_name.lower(),
        ).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="A folder with this name already exists here.")
        return crud.update_requirement_folder(db, folder_id, payload)

    @app.delete("/requirements/folders/{folder_id}", response_model=schemas.MessageResponse)
    def delete_requirement_folder_endpoint(
        folder_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        db_folder = crud.get_requirement_folder(db, folder_id)
        if db_folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        if not rbac.has_permission(current_user, "manage_projects", db_folder.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        crud.delete_requirement_folder(db, folder_id)
        return {"status": "deleted"}

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

    @app.post("/requirements/import-from-tracker", response_model=schemas.RequirementExternalDocumentResponse)
    def import_requirement_from_tracker(
        request: schemas.RequirementTrackerImportRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", request.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            return fetch_requirement_from_tracker(
                db=db,
                project_id=request.project_id,
                source=request.source,
                url=request.url,
            )
        except PermissionError as e:
            logger.warning("Tracker import permission error for project %s: %s", request.project_id, e)
            raise HTTPException(status_code=403, detail=str(e))
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except TimeoutError as e:
            logger.warning("Tracker import timed out for project %s: %s", request.project_id, e)
            raise HTTPException(status_code=504, detail=str(e))
        except ConnectionError as e:
            logger.warning("Tracker import connection error for project %s: %s", request.project_id, e)
            raise HTTPException(status_code=502, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception:
            logger.exception("Unexpected error importing tracker item for project %s", request.project_id)
            raise HTTPException(status_code=502, detail="Unable to import from the external tracker.")

    # ── Gherkin .feature import / export ─────────────────────────────────────
    # Literal paths registered before the dynamic ``/requirements/{requirement_id}``
    # routes so they are never parsed as a requirement id.
    @app.get(
        "/requirements/export-feature-files",
        dependencies=[Depends(require_project_feature("requirements"))],
    )
    def export_feature_files(
        project_id: int = Query(..., ge=1),
        ids: Optional[str] = Query(None, description="Comma-separated requirement ids; all if omitted"),
        folder_id: Optional[int] = Query(None, ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Export requirements' Gherkin as ``.feature`` files (a zip, or a single
        file when only one requirement matches)."""
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        query = db.query(models.Requirement).filter(models.Requirement.project_id == project_id)
        if folder_id is not None:
            query = query.filter(models.Requirement.folder_id == folder_id)
        if ids:
            try:
                id_list = [int(x) for x in ids.split(",") if x.strip()]
            except ValueError:
                raise HTTPException(status_code=400, detail="ids must be a comma-separated list of integers")
            if id_list:
                query = query.filter(models.Requirement.id.in_(id_list))

        requirements = query.order_by(models.Requirement.requirement_id).all()
        if not requirements:
            raise HTTPException(status_code=404, detail="No requirements found to export")

        files: list[tuple[str, str]] = []
        used: set[str] = set()
        for req in requirements:
            content = feature_file_service.build_feature_file(
                title=req.title or "Untitled",
                description=req.description,
                acceptance_criteria=req.acceptance_criteria,
                requirement_key=req.requirement_id,
                tags=req.tags,
                status=getattr(req.status, "value", req.status),
                priority=getattr(req.priority, "value", req.priority),
            )
            name = feature_file_service.feature_filename(req.requirement_id, req.title or "")
            base = name
            n = 2
            while name in used:
                name = f"{base[:-len('.feature')]}-{n}.feature"
                n += 1
            used.add(name)
            files.append((name, content))

        if len(files) == 1:
            name, content = files[0]
            return Response(
                content=content.encode("utf-8"),
                media_type="text/plain",
                headers={"Content-Disposition": f'attachment; filename="{name}"'},
            )

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, content in files:
                zf.writestr(name, content)
        archive = f"requirements-project-{project_id}-features.zip"
        return Response(
            content=buffer.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{archive}"'},
        )

    @app.post(
        "/requirements/import-feature-files",
        response_model=schemas.FeatureFileImportResult,
        dependencies=[Depends(require_project_feature("requirements"))],
    )
    async def import_feature_files(
        project_id: int = Form(...),
        folder_id: Optional[int] = Form(None),
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Create requirements from uploaded Gherkin ``.feature`` files (a single
        file or a ``.zip`` bundle). Each ``Feature:`` becomes one requirement."""
        max_bytes = 5 * 1024 * 1024
        if not rbac.has_permission(current_user, "write", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if folder_id is not None:
            folder = crud.get_requirement_folder(db, folder_id)
            if folder is None or folder.project_id != project_id:
                raise HTTPException(status_code=400, detail="Folder not found in this project")

        raw = await file.read()
        if len(raw) > max_bytes:
            raise HTTPException(status_code=413, detail="File is too large (max 5 MB)")
        filename = file.filename or "import.feature"

        # Collect (source_name, text) documents from a .feature file or zip bundle.
        documents: list[tuple[str, str]] = []
        if filename.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                    for info in zf.infolist():
                        if info.is_dir() or not info.filename.lower().endswith(".feature"):
                            continue
                        documents.append((info.filename, zf.read(info).decode("utf-8", "replace")))
            except zipfile.BadZipFile:
                raise HTTPException(status_code=400, detail="The uploaded zip archive is invalid")
        elif filename.lower().endswith((".feature", ".txt")):
            documents.append((filename, raw.decode("utf-8", "replace")))
        else:
            raise HTTPException(status_code=400, detail="Only .feature files and .zip bundles can be imported")

        if not documents:
            raise HTTPException(status_code=400, detail="No .feature files found in the upload")

        created: list[models.Requirement] = []
        skipped: list[str] = []
        try:
            for source_name, text in documents:
                stem = source_name.rsplit("/", 1)[-1].rsplit(".", 1)[0] or "Imported Feature"
                parsed = feature_file_service.parse_feature_documents(text, fallback_title=stem)
                if not parsed:
                    skipped.append(f"{source_name}: no scenarios found")
                    continue
                for feat in parsed:
                    if not feat.scenarios.strip():
                        skipped.append(f'{source_name}: "{feat.title}" had no scenarios')
                        continue
                    description_html = markdown_to_html(feat.description) if feat.description else None
                    tags = ", ".join(t.lstrip("@") for t in feat.tags) or None
                    req_create = schemas.RequirementCreate(
                        title=feat.title or stem,
                        description=description_html,
                        acceptance_criteria=feat.scenarios,
                        requirement_id=next_requirement_id(db, project_id),
                        folder_id=folder_id,
                        tags=tags,
                        project_id=project_id,
                        created_by=current_user.id,
                    )
                    created.append(crud.create_requirement(db=db, requirement=req_create))
        except HTTPException:
            db.rollback()
            raise
        except Exception as exc:
            db.rollback()
            logger.exception("Feature-file import failed for project %s: %s", project_id, exc)
            raise HTTPException(status_code=500, detail="Could not import the feature files")

        if not created:
            raise HTTPException(
                status_code=400,
                detail="; ".join(skipped) or "No requirements were created from the upload",
            )

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit = get_audit_service(db)
            for req in created:
                audit.create_audit_trail(AuditTrailCreate(
                    user_id=current_user.id,
                    action=AuditAction.CREATE.value,
                    entity_type=EntityType.REQUIREMENT.value,
                    entity_id=req.id,
                    project_id=project_id,
                    description=f"Requirement imported from feature file: {req.title or 'Untitled'}",
                ))
        except Exception:
            logger.exception("Failed to audit feature-file import for project %s", project_id)

        return schemas.FeatureFileImportResult(created=created, skipped=skipped)

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

        # Validate optional references that the update is explicitly changing.
        update_fields = requirement.model_fields_set
        if "parent_requirement_id" in update_fields and requirement.parent_requirement_id is not None:
            if requirement.parent_requirement_id == requirement_id:
                raise HTTPException(status_code=400, detail="A requirement cannot be its own parent")
            parent = get_requirement(db, requirement_id=requirement.parent_requirement_id)
            if parent is None:
                raise HTTPException(status_code=400, detail="Parent requirement not found")
            if parent.project_id != db_requirement.project_id:
                raise HTTPException(
                    status_code=400,
                    detail="Parent requirement must belong to the same project",
                )
            # Walk the ancestor chain to reject parent cycles (A -> B -> A).
            ancestor = parent
            seen: set[int] = set()
            while ancestor is not None and ancestor.id not in seen:
                if ancestor.id == requirement_id:
                    raise HTTPException(status_code=400, detail="Parent assignment would create a cycle")
                seen.add(ancestor.id)
                ancestor = (
                    get_requirement(db, requirement_id=ancestor.parent_requirement_id)
                    if ancestor.parent_requirement_id
                    else None
                )
        if "assigned_to" in update_fields and requirement.assigned_to is not None:
            assignee = db.query(models.User).filter(models.User.id == requirement.assigned_to).first()
            if assignee is None:
                raise HTTPException(status_code=400, detail="Assigned user not found")
        if "folder_id" in update_fields and requirement.folder_id is not None:
            folder = crud.get_requirement_folder(db, requirement.folder_id)
            if folder is None or folder.project_id != db_requirement.project_id:
                raise HTTPException(status_code=400, detail="Folder not found in this project")

        # Capture the prior assignee before the update so we only notify on a real
        # change (and never re-notify when other fields are edited).
        prior_assigned_to = db_requirement.assigned_to

        try:
            # One batch for the whole save: the watch broadcast queued inside
            # update_requirement and the assignment notice below are flushed once
            # so an assignee who also watches the requirement gets a single row.
            batch = notification_engine.NotificationBatch()
            db_requirement = update_requirement(
                db, requirement_id=requirement_id, requirement=requirement, actor_id=current_user.id, batch=batch
            )

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
                logger.warning(f"Failed to create audit trail for requirement update: {e}")

            if "assigned_to" in update_fields:
                notify_requirement_assignee(
                    db, db_requirement, current_user, previous_assigned_to=prior_assigned_to, batch=batch
                )

            batch.flush(db)
            return db_requirement
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post(
        "/requirements/{requirement_id}/request-review",
        response_model=schemas.RequirementReviewRequestResult,
    )
    def request_requirement_review_endpoint(
        requirement_id: int,
        review_request: schemas.RequirementReviewRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Ask teammates to review a requirement.

        Emits the engine's REVIEW notification (Work Inbox "Reviews") to each named
        reviewer. The requester is never notified of their own request, and every
        reviewer must exist, be active, and have access to the requirement's
        project — so a review request can never leak a requirement to someone who
        can't open it.
        """
        db_requirement = get_requirement(db, requirement_id=requirement_id)
        if db_requirement is None:
            raise HTTPException(status_code=404, detail="Requirement not found")

        if not rbac.has_permission(current_user, "write", db_requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        reviewers = (
            db.query(models.User)
            .filter(
                models.User.id.in_(review_request.reviewer_ids),
                models.User.is_active == True,  # noqa: E712
            )
            .all()
        )
        found_by_id = {u.id: u for u in reviewers}
        missing = [uid for uid in review_request.reviewer_ids if uid not in found_by_id]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Reviewer(s) not found or inactive: {missing}",
            )
        no_access = [
            uid
            for uid in review_request.reviewer_ids
            if not rbac.has_permission(found_by_id[uid], "read", db_requirement.project_id, db)
        ]
        if no_access:
            raise HTTPException(
                status_code=400,
                detail=f"Reviewer(s) do not have access to this project: {no_access}",
            )

        actor_name = notification_engine.actor_display_name(current_user)
        label = db_requirement.requirement_id or db_requirement.title or f"#{db_requirement.id}"
        note = review_request.note
        note_clause = f' Note: "{note}".' if note else ""
        batch = notification_engine.NotificationBatch()
        batch.add(
            category=notification_engine.REVIEW,
            user_ids=review_request.reviewer_ids,
            actor_id=current_user.id,
            title="Review requested",
            message=f"{actor_name} requested your review of requirement {label}.{note_clause}",
            related_entity_type="requirement",
            related_entity_id=db_requirement.id,
        )
        rows = batch.flush(db)
        notified_ids = [r.user_id for r in rows]
        return schemas.RequirementReviewRequestResult(
            message=f"Requested review from {len(notified_ids)} reviewer(s)",
            requirement_id=db_requirement.id,
            notified_count=len(notified_ids),
            reviewer_ids=notified_ids,
        )

    @app.delete("/requirements/{requirement_id}", response_model=schemas.MessageResponse)
    def delete_requirement_endpoint(
        requirement_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_requirement = get_requirement(db, requirement_id=requirement_id)
        if db_requirement is None:
            raise HTTPException(status_code=404, detail="Requirement not found")

        if not rbac.has_permission(current_user, "manage_projects", db_requirement.project_id, db):
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
            logger.warning(f"Failed to create audit trail for requirement deletion: {e}")
        
        return {"message": "Requirement deleted successfully"}

    # Defects Endpoints
    @app.post("/defects", response_model=schemas.Defect,
              dependencies=[Depends(require_project_feature("defects"))])
    def create_defect_endpoint(
        defect: schemas.DefectCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        if not defect.title.strip():
            raise HTTPException(status_code=400, detail="Title is required")

        _validate_defect_links(
            db,
            project_id=defect.project_id,
            test_case_id=defect.test_case_id,
            test_run_id=defect.test_run_id,
            requirement_id=defect.requirement_id,
            assigned_to=defect.assigned_to,
        )
        defect = defect.model_copy(update={
            "reported_by": current_user.id,
            # Derived from the project sequence on insert (P{pid}-DEF-NNN).
            "defect_id": None,
            "title": defect.title.strip(),
        })
        try:
            db_defect = create_defect(db=db, defect=defect)
        except IntegrityError as e:
            db.rollback()
            logger.warning("IntegrityError creating defect: %s", e)
            raise HTTPException(status_code=400, detail=_explain_defect_integrity_error(e))
        
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
            logger.warning(f"Failed to create audit trail for defect creation: {e}")

        # The reporter and (any) assignee auto-watch the new defect so they receive
        # later change alerts without having to click the watch button.
        watch_service.auto_watch(
            db, entity_type=watch_service.DEFECT, entity_id=db_defect.id,
            user_ids=[db_defect.reported_by, db_defect.assigned_to],
        )

        # Tell the assignee they have a new defect (no-op when self/unassigned).
        notify_defect_assignee(db, db_defect, current_user)

        return db_defect

    @app.get("/defects", response_model=List[schemas.Defect],
             dependencies=[Depends(require_project_feature("defects"))])
    def read_defects(
        project_id: int,
        skip: int = 0,
        limit: int = 100,
        search: Optional[str] = None,
        status: Optional[str] = None,
        milestone_id: Optional[int] = Query(None, ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        if milestone_id is not None:
            milestone = db.query(models.Milestone).filter(models.Milestone.id == milestone_id).first()
            if milestone is None:
                raise HTTPException(status_code=404, detail="Milestone not found")
            if milestone.project_id != project_id:
                raise HTTPException(status_code=400, detail="Milestone does not belong to this project")

        return get_defects(
            db,
            project_id=project_id,
            skip=skip,
            limit=limit,
            search=search,
            status=status,
            milestone_id=milestone_id,
        )

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

    @app.get("/defects/{defect_id}/detail", response_model=schemas.DefectDetail)
    def read_defect_detail(
        defect_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        defect = get_defect(db, defect_id=defect_id)
        if defect is None:
            raise HTTPException(status_code=404, detail="Defect not found")

        if not rbac.has_permission(current_user, "read", defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        def user_summary(user_id: Optional[int]) -> Optional[dict]:
            if not user_id:
                return None
            user = crud.get_user(db, user_id=user_id)
            if not user:
                return None
            return {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "full_name": user.full_name,
            }

        test_case_summary = None
        if defect.test_case_id:
            test_case = crud.get_test_case(db, test_case_id=defect.test_case_id)
            if test_case and test_case.project_id == defect.project_id:
                test_case_summary = {
                    "id": test_case.id,
                    "key": f"TC-{test_case.id}",
                    "title": test_case.title,
                    "status": test_case.status,
                }

        test_run_summary = None
        if defect.test_run_id:
            test_run = crud.get_test_run(db, test_run_id=defect.test_run_id)
            if test_run and test_run.project_id == defect.project_id:
                test_run_summary = {
                    "id": test_run.id,
                    "name": test_run.name,
                    "status": test_run.status,
                }

        requirement_summary = None
        if defect.requirement_id:
            requirement = get_requirement(db, requirement_id=defect.requirement_id)
            if requirement and requirement.project_id == defect.project_id:
                requirement_summary = {
                    "id": requirement.id,
                    "key": requirement.requirement_id,
                    "title": requirement.title,
                    "status": getattr(requirement.status, "value", requirement.status),
                }

        result_links = (
            db.query(models.TestResultDefectLink)
            .options(joinedload(models.TestResultDefectLink.defect))
            .filter(models.TestResultDefectLink.defect_id == defect_id)
            .order_by(models.TestResultDefectLink.created_at.desc())
            .all()
        )

        return {
            "defect": defect,
            "reporter": user_summary(defect.reported_by),
            "assignee": user_summary(defect.assigned_to),
            "test_case": test_case_summary,
            "test_run": test_run_summary,
            "requirement": requirement_summary,
            "result_links": result_links,
            "can_edit": rbac.can(current_user, "write", defect.project_id, db),
            "can_delete": rbac.can(current_user, "delete", defect.project_id, db),
        }

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

        # Captured before the update so we only notify on an actual re-assignment
        # or status transition.
        prior_assigned_to = db_defect.assigned_to
        prior_status = db_defect.status

        update_data = defect.model_dump(exclude_unset=True)
        if "defect_id" in update_data and not str(update_data["defect_id"] or "").strip():
            raise HTTPException(status_code=400, detail="Defect ID is required")
        if "title" in update_data and not str(update_data["title"] or "").strip():
            raise HTTPException(status_code=400, detail="Defect title is required")
        normalized_update = {}
        if "defect_id" in update_data:
            normalized_update["defect_id"] = str(update_data["defect_id"]).strip()
        if "title" in update_data:
            normalized_update["title"] = str(update_data["title"]).strip()
        if normalized_update:
            defect = defect.model_copy(update=normalized_update)

        effective_test_case_id = update_data.get("test_case_id", db_defect.test_case_id)
        effective_test_run_id = update_data.get("test_run_id", db_defect.test_run_id)
        effective_requirement_id = update_data.get("requirement_id", db_defect.requirement_id)
        effective_assigned_to = update_data.get("assigned_to", db_defect.assigned_to)
        _validate_defect_links(
            db,
            project_id=db_defect.project_id,
            test_case_id=effective_test_case_id,
            test_run_id=effective_test_run_id,
            requirement_id=effective_requirement_id,
            assigned_to=effective_assigned_to,
        )
        # Snapshot the watched fields before the write so we can tell watchers what
        # actually changed (and suppress the broadcast on a no-op edit).
        watch_before = {
            k: getattr(db_defect, k) for k in update_data if k in _DEFECT_WATCH_FIELDS
        }
        try:
            db_defect = update_defect(db, defect_id=defect_id, defect=defect)
        except IntegrityError as e:
            db.rollback()
            logger.warning("IntegrityError updating defect %s: %s", defect_id, e)
            raise HTTPException(status_code=400, detail=_explain_defect_integrity_error(e))
        
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
            logger.warning(f"Failed to create audit trail for defect update: {e}")

        # A newly-assigned user starts watching the defect (so they keep getting
        # change alerts), without re-subscribing anyone who has explicitly unwatched.
        if db_defect.assigned_to and db_defect.assigned_to != prior_assigned_to:
            watch_service.auto_watch(
                db, entity_type=watch_service.DEFECT, entity_id=db_defect.id,
                user_ids=[db_defect.assigned_to],
            )

        # One batch for the whole save so a single request that both reassigns and
        # changes status de-duplicates via the ladder: the new assignee's ASSIGNMENT
        # outranks the STATUS row, which in turn outranks the watch_change broadcast,
        # while the reporter still receives STATUS. Each notify is a no-op when its
        # field did not actually change.
        batch = notification_engine.NotificationBatch()
        notify_defect_assignee(db, db_defect, current_user, previous_assigned_to=prior_assigned_to, batch=batch)
        notify_defect_status_change(db, db_defect, current_user, previous_status=prior_status, batch=batch)
        changed = _changed_field_labels(watch_before, db_defect)
        if changed:
            watch_service.notify_watchers_of_change(
                db,
                entity_type=watch_service.DEFECT,
                entity_id=db_defect.id,
                label=db_defect.defect_id or db_defect.title or f"#{db_defect.id}",
                action="updated",
                actor_id=current_user.id,
                changed_fields=changed,
                batch=batch,
            )
        batch.flush(db)

        return db_defect

    @app.delete("/defects/{defect_id}", response_model=schemas.MessageResponse)
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

        # Watches reference the defect by loose id (no FK); clear them so the row
        # is removed by the delete commit below, not orphaned.
        watch_service.clear_watches(db, watch_service.DEFECT, defect_id)

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
            logger.warning(f"Failed to create audit trail for defect deletion: {e}")
        
        return {"message": "Defect deleted successfully"}

    @app.get(
        "/defects/{defect_id}/result-links",
        response_model=List[schemas.TestResultDefectLink],
    )
    def read_defect_result_links(
        defect_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        defect = get_defect(db, defect_id=defect_id)
        if defect is None:
            raise HTTPException(status_code=404, detail="Defect not found")

        if not rbac.has_permission(current_user, "read", defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return (
            db.query(models.TestResultDefectLink)
            .options(joinedload(models.TestResultDefectLink.defect))
            .filter(models.TestResultDefectLink.defect_id == defect_id)
            .order_by(models.TestResultDefectLink.created_at.desc())
            .all()
        )

    # --------------------------- Defect watch subscriptions ---------------------

    @app.get("/defects/{defect_id}/watch", response_model=schemas.WatchStatus)
    def get_defect_watch(
        defect_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        defect = get_defect(db, defect_id=defect_id)
        if defect is None:
            raise HTTPException(status_code=404, detail="Defect not found")
        if not rbac.has_permission(current_user, "read", defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return schemas.WatchStatus(
            watching=watch_service.is_watching(db, current_user.id, watch_service.DEFECT, defect.id),
            watcher_count=watch_service.count_watchers(db, watch_service.DEFECT, defect.id),
        )

    @app.post("/defects/{defect_id}/watch", response_model=schemas.WatchStatus)
    def watch_defect(
        defect_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        defect = get_defect(db, defect_id=defect_id)
        if defect is None:
            raise HTTPException(status_code=404, detail="Defect not found")
        if not rbac.has_permission(current_user, "read", defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        watch_service.add_watch(db, current_user.id, watch_service.DEFECT, defect.id)
        return schemas.WatchStatus(
            watching=True,
            watcher_count=watch_service.count_watchers(db, watch_service.DEFECT, defect.id),
        )

    @app.delete("/defects/{defect_id}/watch", response_model=schemas.WatchStatus)
    def unwatch_defect(
        defect_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        defect = get_defect(db, defect_id=defect_id)
        if defect is None:
            raise HTTPException(status_code=404, detail="Defect not found")
        if not rbac.has_permission(current_user, "read", defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        watch_service.remove_watch(db, current_user.id, watch_service.DEFECT, defect.id)
        return schemas.WatchStatus(
            watching=False,
            watcher_count=watch_service.count_watchers(db, watch_service.DEFECT, defect.id),
        )

    # Test Result <-> Defect Link Endpoints

    def _resolve_test_result_project(db: Session, test_result):
        """Return the project id that owns a test result (via its test run)."""
        if test_result is None or test_result.test_run_id is None:
            return None
        test_run = crud.get_test_run(db, test_run_id=test_result.test_run_id)
        return test_run.project_id if test_run else None

    def _iso_or_none(value):
        return value.isoformat() if value is not None and hasattr(value, "isoformat") else value

    def _normalize_result_status(value) -> str:
        if value is None:
            return ""
        if hasattr(value, "value"):
            return str(value.value).strip().lower()
        return str(value).strip().lower()

    def _build_test_result_snapshot(db: Session, test_result) -> Dict:
        """Freeze the result context at the moment a defect is linked."""
        test_case = crud.get_test_case(db, test_case_id=test_result.test_case_id)
        test_run = crud.get_test_run(db, test_run_id=test_result.test_run_id)
        executor = None
        if test_result.executed_by:
            executor = crud.get_user(db, user_id=test_result.executed_by)

        return {
            "version": 1,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "test_result": {
                "id": test_result.id,
                "status": _normalize_result_status(test_result.status),
                "actual_result": test_result.actual_result,
                "comments": test_result.comments,
                "execution_time": test_result.execution_time,
                "execution_started_at": _iso_or_none(test_result.execution_started_at),
                "executed_at": _iso_or_none(test_result.executed_at),
                "defect_link": test_result.defect_link,
                "custom_link": test_result.custom_link,
                "retest_needed": bool(test_result.retest_needed),
            },
            "test_case": {
                "id": test_case.id if test_case else test_result.test_case_id,
                "title": test_case.title if test_case else None,
                "priority": getattr(test_case.priority, "value", test_case.priority) if test_case else None,
                "status": getattr(test_case.status, "value", test_case.status) if test_case else None,
                "test_suite_id": test_case.test_suite_id if test_case else None,
                "section_id": test_case.section_id if test_case else None,
                "is_multistep": bool(test_case.is_multistep) if test_case else False,
            },
            "test_run": {
                "id": test_run.id if test_run else test_result.test_run_id,
                "name": test_run.name if test_run else None,
                "status": getattr(test_run.status, "value", test_run.status) if test_run else None,
                "test_plan_id": test_run.test_plan_id if test_run else None,
                "milestone_id": test_run.milestone_id if test_run else None,
                "environment_id": test_run.environment_id if test_run else None,
            },
            "executor": {
                "id": executor.id if executor else test_result.executed_by,
                "username": executor.username if executor else None,
                "email": executor.email if executor else None,
                "full_name": executor.full_name if executor else None,
            } if test_result.executed_by else None,
        }

    def _build_failing_step_snapshot(db: Session, test_result, failing_step) -> Optional[Dict]:
        if failing_step is None:
            return None

        # Prefer the status the client is asserting for the step. The schema
        # already constrains failing_step.status to failed/blocked, so when it
        # is present we can trust it even if the persisted test_result.status
        # has not yet been updated (e.g. the user marks the test failed and
        # reports a defect in the same interaction).
        effective_status = _normalize_result_status(failing_step.status) or _normalize_result_status(test_result.status)
        if effective_status not in FAILED_RESULT_STATUSES | BLOCKED_RESULT_STATUSES:
            raise HTTPException(
                status_code=400,
                detail="Failing step details can only be attached to failed or blocked test results",
            )

        query = db.query(models.TestCaseStep).filter(
            models.TestCaseStep.test_case_id == test_result.test_case_id,
        )
        if failing_step.step_id is not None:
            query = query.filter(models.TestCaseStep.id == failing_step.step_id)
        else:
            query = query.filter(models.TestCaseStep.step_number == failing_step.step_number)

        step = query.first()
        if not step:
            raise HTTPException(status_code=404, detail="Failing step not found for this test case")
        if failing_step.step_number is not None and step.step_number != failing_step.step_number:
            raise HTTPException(status_code=400, detail="Failing step ID and step number do not match")

        return {
            "version": 1,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "step_id": step.id,
            "step_number": step.step_number,
            "step_type": step.step_type,
            "action": step.action,
            "expected_result": step.expected_result,
            "status": effective_status,
            "actual_result": failing_step.actual_result,
            "notes": failing_step.notes,
        }

    @app.get(
        "/test-results/{test_result_id}/defect-links",
        response_model=List[schemas.TestResultDefectLink],
    )
    def read_test_result_defect_links(
        test_result_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")

        project_id = _resolve_test_result_project(db, test_result)
        if project_id is not None and not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return crud.get_test_result_defect_links(db, test_result_id)

    @app.post(
        "/test-results/{test_result_id}/defect-links",
        response_model=schemas.TestResultDefectLink,
    )
    def create_test_result_defect_link(
        test_result_id: int,
        payload: schemas.TestResultDefectLinkCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")

        project_id = _resolve_test_result_project(db, test_result)
        if project_id is None:
            raise HTTPException(status_code=400, detail="Test result is not associated with a project")
        if not rbac.has_permission(current_user, "write", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Validate the failing step (and everything else we can check) BEFORE
        # creating any defect rows. Otherwise a validation failure here would
        # commit a defect with no link and leave an orphan in the database.
        failing_step_snapshot = _build_failing_step_snapshot(db, test_result, payload.failing_step)

        if payload.new_defect is not None:
            new_defect = payload.new_defect
            if new_defect.project_id != project_id:
                raise HTTPException(
                    status_code=400,
                    detail="New defect must belong to the same project as the test result",
                )
            if not (new_defect.defect_id or "").strip() or not (new_defect.title or "").strip():
                raise HTTPException(status_code=400, detail="Defect ID and title are required")
            _validate_defect_links(
                db,
                project_id=project_id,
                test_case_id=new_defect.test_case_id,
                test_run_id=new_defect.test_run_id,
                requirement_id=new_defect.requirement_id,
                assigned_to=new_defect.assigned_to,
            )
            new_defect = new_defect.model_copy(update={
                "reported_by": current_user.id,
                "defect_id": new_defect.defect_id.strip(),
                "title": new_defect.title.strip(),
            })
            if _is_auto_project_defect_id(new_defect.defect_id, project_id):
                duplicate = db.query(models.Defect.id).filter(
                    models.Defect.defect_id == new_defect.defect_id
                ).first()
                if duplicate:
                    new_defect = new_defect.model_copy(update={
                        "defect_id": _next_project_defect_id(db, project_id),
                    })
            try:
                defect = create_defect(db=db, defect=new_defect)
            except IntegrityError as e:
                db.rollback()
                raw_error = str(e.orig)
                if (
                    ("defect_id" in raw_error or "UNIQUE constraint failed" in raw_error)
                    and _is_auto_project_defect_id(new_defect.defect_id, project_id)
                ):
                    new_defect = new_defect.model_copy(update={
                        "defect_id": _next_project_defect_id(db, project_id),
                    })
                    try:
                        defect = create_defect(db=db, defect=new_defect)
                    except IntegrityError as retry_error:
                        db.rollback()
                        raise HTTPException(status_code=400, detail=_explain_defect_integrity_error(retry_error))
                elif "defect_id" in raw_error or "UNIQUE constraint failed" in raw_error:
                    raise HTTPException(status_code=400, detail="Defect ID already exists. Please use a unique ID.")
                else:
                    raise
        else:
            defect = get_defect(db, defect_id=payload.defect_id)
            if defect is None:
                raise HTTPException(status_code=404, detail="Defect not found")
            if defect.project_id != project_id:
                raise HTTPException(status_code=400, detail="Defect belongs to a different project")

        # When the user is reporting a defect at the moment they mark the test
        # as failed/blocked, the persisted status may still be stale. Sync it
        # so the snapshot and future reads reflect the same reality the link
        # is being created for. Done after defect creation so any rollback in
        # the create path doesn't undo this change.
        if failing_step_snapshot and _normalize_result_status(test_result.status) != failing_step_snapshot["status"]:
            test_result.status = failing_step_snapshot["status"]
            db.flush()

        link_type = getattr(payload.link_type, "value", None) or str(payload.link_type)
        result_snapshot = _build_test_result_snapshot(db, test_result)
        link = crud.link_defect_to_test_result(
            db,
            test_result_id=test_result_id,
            defect_id=defect.id,
            link_type=link_type,
            created_by=current_user.id,
            result_snapshot=result_snapshot,
            failing_step_snapshot=failing_step_snapshot,
        )

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_service.create_audit_trail(AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_RESULT.value,
                entity_id=test_result_id,
                project_id=project_id,
                description=f"Defect {defect.defect_id} linked to test result ({link_type})",
            ))
        except Exception as e:
            logger.warning(f"Failed to create audit trail for defect link: {e}")

        return crud.get_test_result_defect_link(db, link.id)

    @app.delete("/test-results/{test_result_id}/defect-links/{link_id}", response_model=schemas.MessageResponse)
    def delete_test_result_defect_link(
        test_result_id: int,
        link_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        link = crud.get_test_result_defect_link(db, link_id)
        if link is None or link.test_result_id != test_result_id:
            raise HTTPException(status_code=404, detail="Defect link not found")

        test_result = crud.get_test_result(db, test_result_id=test_result_id)
        project_id = _resolve_test_result_project(db, test_result)
        if project_id is not None and not rbac.has_permission(current_user, "write", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        crud.unlink_defect_from_test_result(db, link_id)
        return {"message": "Defect link removed"}

    @app.put(
        "/test-results/{test_result_id}/defect-links/{link_id}/snapshot",
        response_model=schemas.TestResultDefectLink,
    )
    def update_test_result_defect_link_snapshot(
        payload: schemas.TestResultDefectLinkSnapshotUpdate,
        test_result_id: int = Path(..., ge=1),
        link_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        link = crud.get_test_result_defect_link(db, link_id)
        if link is None or link.test_result_id != test_result_id:
            raise HTTPException(status_code=404, detail="Defect link not found")

        test_result = crud.get_test_result(db, test_result_id=test_result_id)
        if test_result is None:
            raise HTTPException(status_code=404, detail="Test result not found")

        project_id = _resolve_test_result_project(db, test_result)
        if project_id is None:
            raise HTTPException(status_code=400, detail="Test result is not associated with a project")
        if not rbac.has_permission(current_user, "write", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        if payload.failing_step is not None and payload.clear_failing_step:
            raise HTTPException(status_code=400, detail="Provide failing_step or clear_failing_step, not both")

        link.result_snapshot = _build_test_result_snapshot(db, test_result)
        if payload.clear_failing_step:
            link.failing_step_snapshot = None
        elif payload.failing_step is not None:
            link.failing_step_snapshot = _build_failing_step_snapshot(db, test_result, payload.failing_step)
        link.snapshot_created_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(link)

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_service.create_audit_trail(AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_RESULT.value,
                entity_id=test_result_id,
                project_id=project_id,
                description=f"Defect link snapshot corrected for link {link_id}",
            ))
        except Exception as e:
            logger.warning(f"Failed to create audit trail for defect link snapshot correction: {e}")

        return crud.get_test_result_defect_link(db, link_id)

    @app.get(
        "/test-runs/{test_run_id}/defect-coverage",
        response_model=schemas.TestRunDefectCoverage,
    )
    def read_test_run_defect_coverage(
        test_run_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        test_run = crud.get_test_run(db, test_run_id=test_run_id)
        if test_run is None:
            raise HTTPException(status_code=404, detail="Test run not found")
        if not rbac.has_permission(current_user, "read", test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return crud.get_test_run_defect_coverage(db, test_run_id)

    @app.get(
        "/test-runs/{test_run_id}/flakiness",
        response_model=Dict[int, schemas.FlakinessEntry],
    )
    def read_test_run_flakiness(
        test_run_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        test_run = crud.get_test_run(db, test_run_id=test_run_id)
        if test_run is None:
            raise HTTPException(status_code=404, detail="Test run not found")
        if not rbac.has_permission(current_user, "read", test_run.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return crud.get_test_run_flakiness(db, test_run_id)

    # Test Plans Endpoints
    @app.post("/test-plans", response_model=schemas.TestPlan,
              dependencies=[Depends(require_project_feature("test_plans"))])
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

        # Validate the assignee (if any) exists before persisting.
        if test_plan.assigned_to is not None:
            assignee = db.query(models.User).filter(models.User.id == test_plan.assigned_to).first()
            if assignee is None:
                raise HTTPException(status_code=400, detail="Assigned user not found")

        # Always set created_by from the authenticated user (security: ignore client-supplied value)
        test_plan_data = test_plan.model_copy(update={"created_by": current_user.id})
        db_test_plan = create_test_plan(db=db, test_plan=test_plan_data)

        # The creator and (any) assignee auto-watch the new plan for later changes.
        watch_service.auto_watch(
            db, entity_type=watch_service.TEST_PLAN, entity_id=db_test_plan.id,
            user_ids=[db_test_plan.created_by, db_test_plan.assigned_to],
        )

        notify_test_plan_assignee(db, db_test_plan, current_user)

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
            logger.warning(f"Failed to create audit trail for test plan creation: {e}")
        
        return db_test_plan

    @app.get("/test-plans", dependencies=[Depends(require_project_feature("test_plans"))])
    def read_test_plans(
        project_id: int = Query(..., ge=1, description="Project to list test plans for"),
        milestone_id: Optional[int] = Query(None, ge=1),
        status: Optional[str] = Query(None, max_length=32),
        search: Optional[str] = Query(None, max_length=255),
        sort_by: Optional[str] = Query("created_at", max_length=32),
        sort_order: Optional[str] = Query("desc", pattern="^(asc|desc)$"),
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
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

        from ..services.test_plan_service import compute_plan_executions

        # Derived execution rollups (run counts + truth-from-runs status) for the
        # whole page in two batched queries.
        plan_ids = [tp.id for tp in test_plans]
        executions = compute_plan_executions(db, plan_ids)

        return [
            {
                "id": tp.id,
                "title": tp.title,
                "description": tp.description,
                "project_id": tp.project_id,
                "milestone_id": tp.milestone_id,
                "milestone_title": tp.milestone.title if tp.milestone else None,
                "created_by": tp.created_by,
                "assigned_to": tp.assigned_to,
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
                "test_run_count": executions.get(tp.id, {}).get("run_count", 0),
                "created_at": tp.created_at,
                "updated_at": tp.updated_at,
                **{
                    key: executions.get(tp.id, {}).get(key)
                    for key in (
                        "execution_status",
                        "execution_progress",
                        "pass_rate",
                        "result_count",
                        "passed_count",
                        "failed_count",
                        "blocked_count",
                        "skipped_count",
                        "not_started_count",
                        "executed_count",
                    )
                },
            }
            for tp in test_plans
        ]

    @app.get("/test-plans/{test_plan_id}")
    def read_test_plan_endpoint(
        test_plan_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_plan = get_test_plan(db, test_plan_id=test_plan_id)
        if test_plan is None:
            raise HTTPException(status_code=404, detail="Test plan not found")

        if not rbac.has_permission(current_user, "read", test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        from ..services.test_plan_service import compute_plan_execution

        execution = compute_plan_execution(db, test_plan.id)
        requirement_count = len(test_plan.requirements)

        return {
            "id": test_plan.id,
            "title": test_plan.title,
            "description": test_plan.description,
            "project_id": test_plan.project_id,
            "milestone_id": test_plan.milestone_id,
            "milestone_title": test_plan.milestone.title if test_plan.milestone else None,
            "created_by": test_plan.created_by,
            "assigned_to": test_plan.assigned_to,
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
            "test_run_count": execution.get("run_count", 0),
            "requirement_count": requirement_count,
            "created_at": test_plan.created_at,
            "updated_at": test_plan.updated_at,
            **{
                key: execution.get(key)
                for key in (
                    "execution_status",
                    "execution_progress",
                    "pass_rate",
                    "result_count",
                    "passed_count",
                    "failed_count",
                    "blocked_count",
                    "skipped_count",
                    "not_started_count",
                    "executed_count",
                )
            },
        }

    @app.put("/test-plans/{test_plan_id}", response_model=schemas.TestPlan)
    def update_test_plan_endpoint(
        test_plan: schemas.TestPlanUpdate,
        test_plan_id: int = Path(..., ge=1),
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

        update_fields = test_plan.model_dump(exclude_unset=True)
        # Validate the (possibly new) assignee, and capture the prior one so we only
        # notify on a real change (and never re-notify when other fields are edited).
        if "assigned_to" in update_fields and test_plan.assigned_to is not None:
            assignee = db.query(models.User).filter(models.User.id == test_plan.assigned_to).first()
            if assignee is None:
                raise HTTPException(status_code=400, detail="Assigned user not found")
        prior_assigned_to = db_test_plan.assigned_to
        # Snapshot watched fields before the write to diff the watcher broadcast.
        watch_before = {
            k: getattr(db_test_plan, k) for k in update_fields if k in _TEST_PLAN_WATCH_FIELDS
        }

        db_test_plan = update_test_plan(db, test_plan_id=test_plan_id, test_plan=test_plan)

        # A newly-assigned user starts watching (without re-subscribing an unwatcher).
        if db_test_plan.assigned_to and db_test_plan.assigned_to != prior_assigned_to:
            watch_service.auto_watch(
                db, entity_type=watch_service.TEST_PLAN, entity_id=db_test_plan.id,
                user_ids=[db_test_plan.assigned_to],
            )

        # One batch: the assignment notice and the watch broadcast de-dupe via the
        # ladder so a newly-assigned watcher gets a single ASSIGNMENT row.
        batch = notification_engine.NotificationBatch()
        if "assigned_to" in update_fields:
            notify_test_plan_assignee(
                db, db_test_plan, current_user, previous_assigned_to=prior_assigned_to, batch=batch
            )
        changed = _changed_field_labels(watch_before, db_test_plan, rename={"milestone_id": "milestone"})
        if changed:
            watch_service.notify_watchers_of_change(
                db,
                entity_type=watch_service.TEST_PLAN,
                entity_id=db_test_plan.id,
                label=db_test_plan.title or f"#{db_test_plan.id}",
                action="updated",
                actor_id=current_user.id,
                changed_fields=changed,
                batch=batch,
            )
        batch.flush(db)

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
            logger.warning(f"Failed to create audit trail for test plan update: {e}")
        
        return db_test_plan

    @app.delete("/test-plans/{test_plan_id}", response_model=schemas.MessageResponse)
    def delete_test_plan_endpoint(
        test_plan_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_test_plan = get_test_plan(db, test_plan_id=test_plan_id)
        if db_test_plan is None:
            raise HTTPException(status_code=404, detail="Test plan not found")

        if not rbac.has_permission(current_user, "manage_projects", db_test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Store data for audit trail before deletion
        plan_id = db_test_plan.id
        plan_title = db_test_plan.title
        project_id = db_test_plan.project_id

        # Watches reference the plan by loose id (no FK); clear them so the rows are
        # removed by the delete commit below, not orphaned.
        watch_service.clear_watches(db, watch_service.TEST_PLAN, plan_id)

        # Nullify test_plan_id on linked test runs so they are not orphaned.
        # delete_test_plan() commits, which finalises both the update and the delete
        # atomically (single SQLAlchemy session, single transaction).
        from ..models import TestRun as _TR
        db.query(_TR).filter(_TR.test_plan_id == plan_id).update(
            {"test_plan_id": None}, synchronize_session=False
        )

        delete_test_plan(db, test_plan_id=test_plan_id)

        # Best-effort audit trail; failures must not break the user-visible operation
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
        except Exception:
            logger.exception("Failed to create audit trail for test plan deletion")

        return {"message": "Test plan deleted successfully"}

    # ------------------------- Test plan watch subscriptions -------------------

    @app.get("/test-plans/{test_plan_id}/watch", response_model=schemas.WatchStatus)
    def get_test_plan_watch(
        test_plan_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        test_plan = _get_test_plan_or_404(db, test_plan_id)
        if not rbac.has_permission(current_user, "read", test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return schemas.WatchStatus(
            watching=watch_service.is_watching(db, current_user.id, watch_service.TEST_PLAN, test_plan.id),
            watcher_count=watch_service.count_watchers(db, watch_service.TEST_PLAN, test_plan.id),
        )

    @app.post("/test-plans/{test_plan_id}/watch", response_model=schemas.WatchStatus)
    def watch_test_plan(
        test_plan_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        test_plan = _get_test_plan_or_404(db, test_plan_id)
        if not rbac.has_permission(current_user, "read", test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        watch_service.add_watch(db, current_user.id, watch_service.TEST_PLAN, test_plan.id)
        return schemas.WatchStatus(
            watching=True,
            watcher_count=watch_service.count_watchers(db, watch_service.TEST_PLAN, test_plan.id),
        )

    @app.delete("/test-plans/{test_plan_id}/watch", response_model=schemas.WatchStatus)
    def unwatch_test_plan(
        test_plan_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        test_plan = _get_test_plan_or_404(db, test_plan_id)
        if not rbac.has_permission(current_user, "read", test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        watch_service.remove_watch(db, current_user.id, watch_service.TEST_PLAN, test_plan.id)
        return schemas.WatchStatus(
            watching=False,
            watcher_count=watch_service.count_watchers(db, watch_service.TEST_PLAN, test_plan.id),
        )

    @app.get("/test-plans/{test_plan_id}/requirements", response_model=schemas.TestPlanLinkedRequirementList)
    def search_test_plan_requirements(
        test_plan_id: int = Path(..., ge=1),
        search: Optional[str] = Query(None, max_length=100),
        linked: Optional[bool] = Query(None),
        skip: int = Query(0, ge=0),
        limit: int = Query(25, ge=1, le=500),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_plan = _get_test_plan_or_404(db, test_plan_id)
        if not rbac.has_permission(current_user, "read", test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        linked_requirement_ids = _linked_test_plan_requirement_ids(db, test_plan.id)
        query = db.query(models.Requirement).filter(
            models.Requirement.project_id == test_plan.project_id,
        )

        if linked is True:
            if not linked_requirement_ids:
                return schemas.TestPlanLinkedRequirementList(items=[], total=0, skip=skip, limit=limit)
            query = query.filter(models.Requirement.id.in_(linked_requirement_ids))
        elif linked is False and linked_requirement_ids:
            query = query.filter(models.Requirement.id.notin_(linked_requirement_ids))

        if search and search.strip():
            term = f"%{search.strip()}%"
            query = query.filter(or_(
                models.Requirement.title.ilike(term),
                models.Requirement.requirement_id.ilike(term),
            ))

        total = query.count()
        requirements = query.order_by(models.Requirement.created_at.desc()).offset(skip).limit(limit).all()
        return schemas.TestPlanLinkedRequirementList(
            items=[
                _requirement_to_test_plan_response(requirement, linked=requirement.id in linked_requirement_ids)
                for requirement in requirements
            ],
            total=total,
            skip=skip,
            limit=limit,
        )

    @app.post("/test-plans/{test_plan_id}/requirements/bulk", response_model=schemas.TestPlanLinkedRequirementBulkResponse)
    def bulk_update_test_plan_requirements(
        request: schemas.TestPlanLinkedRequirementBulkRequest,
        test_plan_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_plan = _get_test_plan_or_404(db, test_plan_id)
        if not rbac.has_permission(current_user, "write", test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        unique_requirement_ids = list(dict.fromkeys(request.requirement_ids))
        requirements = db.query(models.Requirement).filter(
            models.Requirement.id.in_(unique_requirement_ids)
        ).all()
        requirements_by_id = {requirement.id: requirement for requirement in requirements}
        missing_ids = [rid for rid in unique_requirement_ids if rid not in requirements_by_id]
        if missing_ids:
            raise HTTPException(status_code=404, detail=f"Requirement(s) not found: {missing_ids}")
        wrong_project_ids = [
            requirement.id
            for requirement in requirements
            if requirement.project_id != test_plan.project_id
        ]
        if wrong_project_ids:
            raise HTTPException(status_code=400, detail=f"Requirement(s) do not belong to this test plan's project: {wrong_project_ids}")

        linked_requirement_ids = _linked_test_plan_requirement_ids(db, test_plan.id)
        linked_count = 0
        unlinked_count = 0
        skipped_count = 0

        try:
            if request.action == "link":
                for requirement_id in unique_requirement_ids:
                    if requirement_id in linked_requirement_ids:
                        skipped_count += 1
                        continue
                    db.execute(models.requirement_test_plan_links.insert().values(
                        requirement_id=requirement_id,
                        test_plan_id=test_plan.id,
                    ))
                    linked_count += 1
            else:
                for requirement_id in unique_requirement_ids:
                    if requirement_id not in linked_requirement_ids:
                        skipped_count += 1
                        continue
                    db.execute(models.requirement_test_plan_links.delete().where(
                        models.requirement_test_plan_links.c.requirement_id == requirement_id,
                        models.requirement_test_plan_links.c.test_plan_id == test_plan.id,
                    ))
                    unlinked_count += 1
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="Failed to update requirement links")

        refreshed_ids = _linked_test_plan_requirement_ids(db, test_plan.id)
        return schemas.TestPlanLinkedRequirementBulkResponse(
            linked_count=linked_count,
            unlinked_count=unlinked_count,
            skipped_count=skipped_count,
            items=[
                _requirement_to_test_plan_response(requirements_by_id[rid], linked=rid in refreshed_ids)
                for rid in unique_requirement_ids
            ],
        )

    # Milestones Endpoints
    @app.post("/milestones", response_model=schemas.Milestone,
              dependencies=[Depends(require_project_feature("milestones"))])
    def create_milestone_endpoint(
        milestone: schemas.MilestoneCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if milestone.project_id <= 0:
            raise HTTPException(status_code=400, detail="Invalid project_id")
        project = crud.get_project(db, milestone.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")

        if not rbac.has_permission(current_user, "write", milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        duplicate = db.query(models.Milestone.id).filter(
            models.Milestone.project_id == milestone.project_id,
            func.lower(models.Milestone.title) == milestone.title.strip().lower(),
        ).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="Milestone title already exists in this project")

        # Validate the owner (if any) exists before persisting.
        if milestone.owner_id is not None:
            owner = db.query(models.User).filter(models.User.id == milestone.owner_id).first()
            if owner is None:
                raise HTTPException(status_code=400, detail="Owner user not found")

        milestone_data = milestone.model_copy(update={"created_by": current_user.id})
        db_milestone = create_milestone(db=db, milestone=milestone_data)

        notify_milestone_owner_assigned(db, db_milestone, current_user)

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
            logger.warning(f"Failed to create audit trail for milestone creation: {e}")

        return enrich_milestone(db, db_milestone)

    @app.get("/milestones", response_model=List[schemas.Milestone],
             dependencies=[Depends(require_project_feature("milestones"))])
    def read_milestones(
        project_id: int = Query(..., ge=1),
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
        milestone_id: int = Path(..., ge=1),
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
        milestone: schemas.MilestoneUpdate,
        milestone_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_milestone = get_milestone(db, milestone_id=milestone_id)
        if db_milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")

        if not rbac.has_permission(current_user, "write", db_milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        update_data = milestone.model_dump(exclude_unset=True)
        if "title" in update_data:
            duplicate = db.query(models.Milestone.id).filter(
                models.Milestone.project_id == db_milestone.project_id,
                models.Milestone.id != db_milestone.id,
                func.lower(models.Milestone.title) == str(update_data["title"]).strip().lower(),
            ).first()
            if duplicate:
                raise HTTPException(status_code=400, detail="Milestone title already exists in this project")
        # Validate the (possibly new) owner, and capture the prior one so we only
        # notify on a real change (and never re-notify when other fields are edited).
        if "owner_id" in update_data and update_data["owner_id"] is not None:
            owner = db.query(models.User).filter(models.User.id == update_data["owner_id"]).first()
            if owner is None:
                raise HTTPException(status_code=400, detail="Owner user not found")
        prior_owner_id = db_milestone.owner_id
        if update_data.get("status") == schemas.MilestoneStatus.COMPLETED:
            current_health = enrich_milestone(db, db_milestone)
            if (
                getattr(current_health, "critical_defect_count", 0) > 0
                or getattr(current_health, "failed_count", 0) > 0
                or getattr(current_health, "blocked_count", 0) > 0
                or getattr(current_health, "not_started_count", 0) > 0
            ):
                raise HTTPException(
                    status_code=409,
                    detail="Milestone cannot be completed while critical defects, failed, blocked, or not-tested results remain.",
                )
            update_data.setdefault("progress_percentage", 100)
            if not update_data.get("actual_date") and not db_milestone.actual_date:
                update_data["actual_date"] = datetime.now(timezone.utc)
        elif update_data.get("status") in {
            schemas.MilestoneStatus.PLANNED,
            schemas.MilestoneStatus.IN_PROGRESS,
            schemas.MilestoneStatus.CANCELLED,
        } and "actual_date" not in update_data:
            update_data["actual_date"] = None
        db_milestone = update_milestone(
            db,
            milestone_id=milestone_id,
            milestone=schemas.MilestoneUpdate(**update_data),
        )

        if "owner_id" in update_data:
            batch = notification_engine.NotificationBatch()
            notify_milestone_owner_assigned(
                db, db_milestone, current_user, previous_owner_id=prior_owner_id, batch=batch
            )
            batch.flush(db)

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
            logger.warning(f"Failed to create audit trail for milestone update: {e}")

        return enrich_milestone(db, db_milestone)

    @app.delete("/milestones/{milestone_id}", response_model=schemas.MessageResponse)
    def delete_milestone_endpoint(
        milestone_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_milestone = get_milestone(db, milestone_id=milestone_id)
        if db_milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")

        if not rbac.has_permission(current_user, "manage_projects", db_milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        if db_milestone.test_plans:
            raise HTTPException(
                status_code=409,
                detail="Milestone has linked test plans. Unlink or move those plans before deleting it.",
            )
        if db.query(models.TestRun.id).filter(models.TestRun.milestone_id == milestone_id).first():
            raise HTTPException(
                status_code=409,
                detail="Milestone has linked test runs. Unlink or move those runs before deleting it.",
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
            logger.warning(f"Failed to create audit trail for milestone deletion: {e}")

        return {"message": "Milestone deleted successfully"}

    @app.get("/milestones/stats/{project_id}")
    def get_milestone_stats(
        project_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return get_project_milestone_stats(db, project_id)

    # NOTE: the milestone detail page reads linked plans from the enriched
    # ``GET /milestones/{id}`` payload (``linked_test_plans``), so a separate
    # ``GET /milestones/{id}/test-plans`` endpoint was unused and divergent and
    # has been removed.

    @app.get("/milestones/{milestone_id}/runs", response_model=List[schemas.TestRun])
    def get_milestone_runs(
        milestone_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Test runs related to this milestone — direct ``milestone_id`` link
        plus indirect via test plans — with the same progress fields that
        ``GET /test-runs`` returns so the milestone detail page can render
        per-plan rollups client-side from a single fetch.
        """
        from ..models import Milestone, TestPlan, TestRun
        from .test_management import _attach_test_run_progress

        milestone = db.query(Milestone).filter(Milestone.id == milestone_id).first()
        if not milestone:
            raise HTTPException(status_code=404, detail="Milestone not found")

        if not rbac.has_permission(current_user, "read", milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        plan_ids = [row[0] for row in db.query(TestPlan.id).filter(TestPlan.milestone_id == milestone_id).all()]
        direct_runs = db.query(TestRun).filter(TestRun.milestone_id == milestone_id).all()
        plan_runs = (
            db.query(TestRun).filter(TestRun.test_plan_id.in_(plan_ids)).all()
            if plan_ids else []
        )

        # Dedupe — a run can be linked both directly and via its plan.
        seen: set = set()
        runs: List[TestRun] = []
        for run in direct_runs + plan_runs:
            if run.id not in seen:
                seen.add(run.id)
                runs.append(run)

        return _attach_test_run_progress(db, runs)
