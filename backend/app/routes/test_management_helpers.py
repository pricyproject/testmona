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
from ..feature_guard import require_project_feature
from ..database import get_db
from ..auth import get_current_active_user, get_current_user
from ..models import TestCase, TestResult, TestRun, User, TestCaseRevision, ResultStatus, canonical_result_status
from ..services import notification_engine

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
    environment_id: Optional[int] = None,
) -> None:
    """Ensure optional test-run links belong to the same project."""
    linked_plan = None
    if test_plan_id is not None:
        linked_plan = db.query(models.TestPlan).filter(models.TestPlan.id == test_plan_id).first()
        if linked_plan is None:
            raise HTTPException(status_code=404, detail="Test plan not found")
        if linked_plan.project_id != project_id:
            raise HTTPException(status_code=400, detail="Test plan does not belong to this project")

    if environment_id is not None:
        environment = db.query(models.ExecutionEnvironment).filter(
            models.ExecutionEnvironment.id == environment_id
        ).first()
        if environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        if environment.project_id != project_id:
            raise HTTPException(status_code=400, detail="Environment does not belong to this project")

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
            "not_started_tests": 0,
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
        "not_started": "not_started_tests",
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

    actor_name = notification_engine.actor_display_name(assigned_by)
    notification_engine.emit(
        db,
        category=notification_engine.ASSIGNMENT,
        user_ids=[assignee.id],
        actor_id=assigned_by.id if assigned_by else None,
        title="Test run assigned",
        message=f"{actor_name} assigned test run {test_run.name} to you.",
        related_entity_type="test_run",
        related_entity_id=test_run.id,
    )


def _notify_milestone_owner(db: Session, test_run: TestRun, completed_by: User) -> None:
    """Notify the milestone owner when a test run completes."""
    if not test_run.milestone_id:
        return

    try:
        milestone = db.query(models.Milestone).filter(models.Milestone.id == test_run.milestone_id).first()
        if not milestone or not milestone.owner_id:
            return

        owner = db.query(models.User).filter(models.User.id == milestone.owner_id).first()
        if not owner:
            return

        actor_name = notification_engine.actor_display_name(completed_by)
        notification_engine.emit(
            db,
            category=notification_engine.STATUS,
            user_ids=[owner.id],
            actor_id=completed_by.id if completed_by else None,
            title="Test run completed",
            message=f"{actor_name} completed test run {test_run.name} for milestone {milestone.name}.",
            type_override=models.NotificationType.SUCCESS,
            related_entity_type="test_run",
            related_entity_id=test_run.id,
        )
    except Exception:
        logger.exception("Failed to create milestone owner notification", extra={"test_run_id": test_run.id, "milestone_id": test_run.milestone_id})


__all__ = [
    "COMPLETED_RESULT_STATUSES",
    "_attach_test_run_progress",
    "_enum_value",
    "_get_test_case_linked_requirements",
    "_is_completed_result_status",
    "_normalize_status_value",
    "_notify_milestone_owner",
    "_notify_test_run_assignee",
    "_reference_tokens",
    "_section_is_descendant_of",
    "_validate_test_run_assignee",
    "_validate_test_run_scope",
]
