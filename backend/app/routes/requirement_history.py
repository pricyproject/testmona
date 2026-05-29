"""Requirement version history, comments/review threads, and coverage badges."""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from typing import Dict, List, Optional, Set

from fastapi import Depends, HTTPException, Path, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .. import crud, models, rbac, schemas
from ..auth import get_current_active_user
from ..crud import safe_commit
from ..database import get_db

logger = logging.getLogger(__name__)

FAILED_RESULT_STATUSES = {"fail", "failed"}
BLOCKED_RESULT_STATUSES = {"block", "blocked"}

# Matches @username tokens; usernames are alphanumerics plus _ . -
_MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]+)")


def _project_member_users(db: Session, project_id: int) -> Dict[str, models.User]:
    """Map lowercase username -> User for everyone with access to the project
    (the owner plus assigned members). Used to resolve @mentions safely so we
    never notify users outside the project."""
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    user_ids: Set[int] = set()
    if project and project.owner_id:
        user_ids.add(project.owner_id)
    for (uid,) in (
        db.query(models.ProjectAssignment.user_id)
        .filter(models.ProjectAssignment.project_id == project_id)
        .all()
    ):
        user_ids.add(uid)
    if not user_ids:
        return {}
    users = db.query(models.User).filter(models.User.id.in_(user_ids)).all()
    return {u.username.lower(): u for u in users}


def _resolve_mentions(body: str, members: Dict[str, models.User]) -> Set[int]:
    """Resolve @mention tokens in the body to project-member user ids."""
    resolved: Set[int] = set()
    for token in _MENTION_RE.findall(body or ""):
        candidate = token.lower()
        # Tolerate trailing punctuation that ran into the token (e.g. "@bob.").
        user = members.get(candidate) or members.get(candidate.rstrip(".-"))
        if user is not None:
            resolved.add(user.id)
    return resolved


def _notify_comment(
    db: Session,
    requirement: models.Requirement,
    comment: models.RequirementComment,
    actor: schemas.User,
    parent_author_id: Optional[int],
) -> None:
    """Best-effort notifications for a new comment: @mentioned members and the
    author of the comment being replied to. Never raises into the request."""
    try:
        members = _project_member_users(db, requirement.project_id)
        # recipient_id -> reason ("mention" wins over "reply" if both apply)
        recipients: Dict[int, str] = {}
        for uid in _resolve_mentions(comment.body, members):
            recipients[uid] = "mention"
        if parent_author_id and parent_author_id != actor.id and parent_author_id not in recipients:
            recipients[parent_author_id] = "reply"

        if not recipients:
            return

        actor_name = actor.full_name or actor.username
        snippet = (comment.body or "").strip()
        if len(snippet) > 140:
            snippet = snippet[:140].rstrip() + "…"

        for uid, reason in recipients.items():
            if reason == "mention":
                title = "You were mentioned"
                message = f'{actor_name} mentioned you on {requirement.requirement_id}: "{snippet}"'
            else:
                title = "New reply to your comment"
                message = f'{actor_name} replied on {requirement.requirement_id}: "{snippet}"'
            crud.create_notification(
                db,
                schemas.NotificationCreate(
                    user_id=uid,
                    title=title,
                    message=message,
                    type=models.NotificationType.INFO,
                    related_entity_type="requirement",
                    related_entity_id=requirement.id,
                ),
            )
    except Exception:
        logger.exception("Failed to create comment notifications for requirement %s", requirement.id)


def _get_requirement_or_404(db: Session, requirement_id: int) -> models.Requirement:
    requirement = db.query(models.Requirement).filter(models.Requirement.id == requirement_id).first()
    if requirement is None:
        raise HTTPException(status_code=404, detail="Requirement not found")
    return requirement


def _author(user: Optional[models.User]) -> Optional[schemas.RequirementVersionAuthor]:
    if user is None:
        return None
    return schemas.RequirementVersionAuthor(id=user.id, username=user.username, full_name=user.full_name)


def _coverage_status(linked: int, active: int, failed: int, blocked: int) -> str:
    if linked == 0:
        return "uncovered"
    if failed > 0:
        return "failing"
    if blocked > 0:
        return "blocked"
    if active == linked:
        return "covered"
    return "partial"


def register_requirement_history_routes(app) -> None:
    # --------------------------- Version history ---------------------------

    @app.get("/requirements/{requirement_id}/versions", response_model=List[schemas.RequirementVersionView])
    def list_requirement_versions(
        requirement_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        requirement = _get_requirement_or_404(db, requirement_id)
        if not rbac.has_permission(current_user, "read", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        versions = (
            db.query(models.RequirementVersion)
            .options(joinedload(models.RequirementVersion.author))
            .filter(models.RequirementVersion.requirement_id == requirement_id)
            .order_by(models.RequirementVersion.version_number.desc())
            .all()
        )
        return [
            schemas.RequirementVersionView(
                id=v.id,
                requirement_id=v.requirement_id,
                version_number=v.version_number,
                action=v.action,
                title=v.title,
                description=v.description,
                acceptance_criteria=v.acceptance_criteria,
                status=v.status,
                priority=v.priority,
                tags=v.tags,
                estimated_effort=v.estimated_effort,
                change_note=v.change_note,
                created_at=v.created_at,
                author=_author(v.author),
            )
            for v in versions
        ]

    @app.post("/requirements/{requirement_id}/versions/{version_id}/restore", response_model=schemas.Requirement)
    def restore_requirement_version(
        payload: schemas.RequirementVersionRestore,
        requirement_id: int = Path(..., ge=1),
        version_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        requirement = _get_requirement_or_404(db, requirement_id)
        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        version = (
            db.query(models.RequirementVersion)
            .filter(
                models.RequirementVersion.id == version_id,
                models.RequirementVersion.requirement_id == requirement_id,
            )
            .first()
        )
        if version is None:
            raise HTTPException(status_code=404, detail="Version not found")

        return crud.restore_requirement_version(
            db, requirement, version, actor_id=current_user.id, change_note=payload.change_note
        )

    # --------------------------- Comments / review -------------------------

    @app.get("/requirements/{requirement_id}/comments", response_model=List[schemas.RequirementCommentView])
    def list_requirement_comments(
        requirement_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        requirement = _get_requirement_or_404(db, requirement_id)
        if not rbac.has_permission(current_user, "read", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        comments = (
            db.query(models.RequirementComment)
            .options(joinedload(models.RequirementComment.author))
            .filter(models.RequirementComment.requirement_id == requirement_id)
            .order_by(models.RequirementComment.created_at.asc())
            .all()
        )

        children: Dict[int, List[models.RequirementComment]] = defaultdict(list)
        roots: List[models.RequirementComment] = []
        for comment in comments:
            if comment.parent_id:
                children[comment.parent_id].append(comment)
            else:
                roots.append(comment)

        def serialize(comment: models.RequirementComment) -> schemas.RequirementCommentView:
            return schemas.RequirementCommentView(
                id=comment.id,
                requirement_id=comment.requirement_id,
                parent_id=comment.parent_id,
                body=comment.body,
                is_resolved=comment.is_resolved,
                created_at=comment.created_at,
                updated_at=comment.updated_at,
                author=_author(comment.author),
                replies=[serialize(reply) for reply in children.get(comment.id, [])],
            )

        return [serialize(root) for root in roots]

    @app.post("/requirements/{requirement_id}/comments", response_model=schemas.RequirementCommentView, status_code=201)
    def create_requirement_comment(
        payload: schemas.RequirementCommentCreate,
        requirement_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        requirement = _get_requirement_or_404(db, requirement_id)
        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        parent_author_id: Optional[int] = None
        parent_id: Optional[int] = None
        if payload.parent_id is not None:
            parent = (
                db.query(models.RequirementComment)
                .filter(
                    models.RequirementComment.id == payload.parent_id,
                    models.RequirementComment.requirement_id == requirement_id,
                )
                .first()
            )
            if parent is None:
                raise HTTPException(status_code=400, detail="Parent comment not found")
            parent_author_id = parent.user_id
            parent_id = parent.parent_id or parent.id

        comment = models.RequirementComment(
            requirement_id=requirement_id,
            parent_id=parent_id,
            user_id=current_user.id,
            body=payload.body,
        )
        db.add(comment)
        safe_commit(db)
        db.refresh(comment)

        _notify_comment(db, requirement, comment, current_user, parent_author_id)
        return schemas.RequirementCommentView(
            id=comment.id,
            requirement_id=comment.requirement_id,
            parent_id=comment.parent_id,
            body=comment.body,
            is_resolved=comment.is_resolved,
            created_at=comment.created_at,
            updated_at=comment.updated_at,
            author=_author(current_user),
            replies=[],
        )

    @app.patch("/requirements/comments/{comment_id}", response_model=schemas.RequirementCommentView)
    def update_requirement_comment(
        payload: schemas.RequirementCommentUpdate,
        comment_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        comment = (
            db.query(models.RequirementComment)
            .options(joinedload(models.RequirementComment.author), joinedload(models.RequirementComment.requirement))
            .filter(models.RequirementComment.id == comment_id)
            .first()
        )
        if comment is None:
            raise HTTPException(status_code=404, detail="Comment not found")
        if not rbac.has_permission(current_user, "write", comment.requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Editing the body is restricted to the author; resolving a thread is a
        # review action any project writer may take.
        if payload.body is not None:
            if comment.user_id != current_user.id:
                raise HTTPException(status_code=403, detail="You can only edit your own comments")
            comment.body = payload.body
        if payload.is_resolved is not None:
            comment.is_resolved = payload.is_resolved

        safe_commit(db)
        db.refresh(comment)
        return schemas.RequirementCommentView(
            id=comment.id,
            requirement_id=comment.requirement_id,
            parent_id=comment.parent_id,
            body=comment.body,
            is_resolved=comment.is_resolved,
            created_at=comment.created_at,
            updated_at=comment.updated_at,
            author=_author(comment.author),
            replies=[],
        )

    @app.delete("/requirements/comments/{comment_id}", status_code=204)
    def delete_requirement_comment(
        comment_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        comment = (
            db.query(models.RequirementComment)
            .options(joinedload(models.RequirementComment.requirement))
            .filter(models.RequirementComment.id == comment_id)
            .first()
        )
        if comment is None:
            raise HTTPException(status_code=404, detail="Comment not found")
        project_id = comment.requirement.project_id
        # Authors can delete their own; project admins can moderate any.
        if comment.user_id != current_user.id and not rbac.has_permission(current_user, "manage", project_id, db):
            raise HTTPException(status_code=403, detail="You can only delete your own comments")
        if not rbac.has_permission(current_user, "write", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        db.delete(comment)
        safe_commit(db)
        return

    # --------------------------- Coverage badges ---------------------------

    @app.get("/requirements/coverage", response_model=schemas.RequirementCoverageList)
    def requirement_coverage(
        project_id: int = Query(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        requirement_ids = [
            row[0]
            for row in db.query(models.Requirement.id)
            .filter(models.Requirement.project_id == project_id)
            .all()
        ]
        if not requirement_ids:
            return schemas.RequirementCoverageList(items=[])

        # Test cases that still exist in this project (non-deleted).
        valid_tc_ids: Set[int] = {
            row[0]
            for row in db.query(models.TestCase.id)
            .join(models.TestSuite)
            .filter(
                models.TestSuite.project_id == project_id,
                models.TestCase.is_deleted == False,  # noqa: E712
            )
            .all()
        }

        # requirement_id -> {test_case_id}, from both the association table and
        # the traceability matrix (the two structured link sources).
        links: Dict[int, Set[int]] = defaultdict(set)
        for rid, tcid in (
            db.query(
                models.requirement_test_case_links.c.requirement_id,
                models.requirement_test_case_links.c.test_case_id,
            )
            .filter(models.requirement_test_case_links.c.requirement_id.in_(requirement_ids))
            .all()
        ):
            if tcid in valid_tc_ids:
                links[rid].add(tcid)
        for rid, tcid in (
            db.query(models.TraceabilityMatrix.requirement_id, models.TraceabilityMatrix.test_case_id)
            .filter(models.TraceabilityMatrix.requirement_id.in_(requirement_ids))
            .all()
        ):
            if tcid in valid_tc_ids:
                links[rid].add(tcid)

        all_tc_ids: Set[int] = set().union(*links.values()) if links else set()

        status_by_tc: Dict[int, str] = {}
        failed_by_tc: Dict[int, int] = defaultdict(int)
        blocked_by_tc: Dict[int, int] = defaultdict(int)
        if all_tc_ids:
            status_by_tc = {
                row[0]: row[1]
                for row in db.query(models.TestCase.id, models.TestCase.status)
                .filter(models.TestCase.id.in_(all_tc_ids))
                .all()
            }
            for tcid, status, count in (
                db.query(
                    models.TestResult.test_case_id,
                    models.TestResult.status,
                    func.count(models.TestResult.id),
                )
                .filter(models.TestResult.test_case_id.in_(all_tc_ids))
                .group_by(models.TestResult.test_case_id, models.TestResult.status)
                .all()
            ):
                normalized = (status or "").lower()
                if normalized in FAILED_RESULT_STATUSES:
                    failed_by_tc[tcid] += count
                elif normalized in BLOCKED_RESULT_STATUSES:
                    blocked_by_tc[tcid] += count

        items: List[schemas.RequirementCoverageItem] = []
        for rid in requirement_ids:
            tc_ids = links.get(rid, set())
            linked = len(tc_ids)
            active = sum(1 for tc in tc_ids if status_by_tc.get(tc) == "active")
            failed = sum(failed_by_tc.get(tc, 0) for tc in tc_ids)
            blocked = sum(blocked_by_tc.get(tc, 0) for tc in tc_ids)
            items.append(
                schemas.RequirementCoverageItem(
                    requirement_id=rid,
                    linked_count=linked,
                    active_count=active,
                    failed_related_runs=failed,
                    blocked_related_runs=blocked,
                    status=_coverage_status(linked, active, failed, blocked),
                )
            )
        return schemas.RequirementCoverageList(items=items)
