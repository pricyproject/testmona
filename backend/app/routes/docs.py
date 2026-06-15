"""Doc Hub routes — Docs-as-Code documentation.

Spaces (repositories), folders, docs (canonical Markdown), version history,
the doc→requirement converter, and Markdown import/export (single file + zip
bundle).

Route ordering matters: literal paths (``/docs/spaces``, ``/docs/folders``,
``/docs/import``) are registered before the dynamic ``/docs/{doc_id}`` routes so
they are never parsed as an integer id (the documented FastAPI gotcha).
"""

from __future__ import annotations

import io
import html
import logging
import os
import re
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import yaml
from fastapi import Depends, File, Form, HTTPException, Path, Query, Request, Response, UploadFile
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from .. import crud, crud_docs, models, rbac, schemas
from ..feature_guard import require_project_feature
from ..features import is_feature_enabled
from ..auth import get_current_active_user
from ..database import get_db
from ..services import doc_conversion_service as conv
from ..services import doc_impact_service
from ..services import notification_engine
from ..services import watch_service
from ..services import doc_release_notes_service as release_notes
from ..services import feature_file_service
from .project_ai_chat import _cancel_on_disconnect
from ..services.ai_manager import AICompletionRequest, generate_ai_completion, get_ai_manager_status
from ..services.ai_prompt_service import (
    build_doc_convert_enhance_prompt,
    build_doc_impact_prompt,
    build_release_notes_prompt,
    clean_ai_text,
    extract_json_object,
    strip_html,
)
from ..services.mentions import project_member_users, resolve_mentions

logger = logging.getLogger(__name__)

def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        logger.warning("Invalid %s value; using default %s", name, default)
        return default
    if value <= 0:
        logger.warning("Non-positive %s value; using default %s", name, default)
        return default
    return value


DOC_IMPORT_MAX_BYTES = _positive_int_env("DOC_IMPORT_MAX_BYTES", 10 * 1024 * 1024)
DOC_IMPORT_MAX_FILES = _positive_int_env("DOC_IMPORT_MAX_FILES", 200)
_MARKDOWN_EXTENSIONS = (".md", ".markdown")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Coalesce repeated view events (anonymous public-link views, and grant-based
# reads by the same user) into at most one audit row per this window.
_AUDIT_VIEW_WINDOW = timedelta(minutes=30)


def _as_aware(value: Optional[datetime]) -> Optional[datetime]:
    """Treat naive DB timestamps as UTC so expiry comparisons are correct."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


# --------------------------------------------------------------------------- #
# Access helpers                                                              #
# --------------------------------------------------------------------------- #

def _can_access(user: models.User, project_id: Optional[int], permission: str, db: Session) -> bool:
    """Authorize an action on a doc/space. Global (``project_id`` None) items are
    readable by any authenticated user and writable per the user's global role;
    project items defer to the project's RBAC."""
    if project_id is None:
        if permission == "read":
            return True
        return rbac.has_global_permission(user, "manage_projects")
    return rbac.has_permission(user, permission, project_id, db)


def _require(user: models.User, project_id: Optional[int], permission: str, db: Session) -> None:
    if not _can_access(user, project_id, permission, db):
        raise HTTPException(status_code=403, detail="Insufficient permissions")


def _require_feature_enabled(db: Session, project_id: Optional[int], feature: str) -> None:
    if project_id is None:
        return
    project = crud.get_project(db, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not is_feature_enabled(project, feature):
        raise HTTPException(status_code=403, detail=f"The '{feature}' feature is disabled for this project")


def _is_admin(user: models.User) -> bool:
    return bool(getattr(user, "is_superuser", False)) or rbac.is_role(user, models.Role.ADMIN)


def _notify_doc_mentions(
    db: Session,
    doc: models.Doc,
    actor: models.User,
    previous_markdown: Optional[str],
    batch: Optional[notification_engine.NotificationBatch] = None,
) -> None:
    """Best-effort notifications for @mentions added to a doc's body.

    Only project-scoped docs notify (global docs have no member audience). We
    diff against the previous content so the frequent autosaves from the editor
    never re-notify a user who was already mentioned. When a ``batch`` is supplied
    the mention intent is added to it so it de-duplicates against the watch
    broadcast for the same save (a watcher who is mentioned gets one row, the
    mention); otherwise it is emitted immediately. Never raises into the request —
    mirrors ``_notify_comment`` in the requirements feature."""
    if doc.project_id is None:
        return
    try:
        members = project_member_users(db, doc.project_id)
        if not members:
            return
        new_ids = resolve_mentions(doc.content_markdown or "", members)
        already = resolve_mentions(previous_markdown or "", members)
        recipients = new_ids - already - {actor.id}
        if not recipients:
            return

        actor_name = notification_engine.actor_display_name(actor)
        target = batch or notification_engine.NotificationBatch()
        target.add(
            category=notification_engine.MENTION,
            user_ids=list(recipients),
            actor_id=actor.id,
            title="You were mentioned",
            message=f'{actor_name} mentioned you in "{doc.title}"',
            related_entity_type="doc",
            related_entity_id=doc.id,
        )
        if batch is None:
            target.flush(db)
    except Exception:
        logger.exception("Failed to create doc mention notifications for doc %s", doc.id)


def _notify_doc_feedback(
    db: Session,
    doc: models.Doc,
    actor: models.User,
    feedback_type: str,
    comment: Optional[str],
) -> None:
    """Notify the doc's responsible editors about actionable reader feedback."""
    if feedback_type == "helpful":
        return
    try:
        recipients = {uid for uid in (doc.created_by, doc.updated_by) if uid and uid != actor.id}
        if not recipients:
            return
        actor_name = notification_engine.actor_display_name(actor)
        labels = {
            "not_helpful": "not helpful",
            "clarification": "needs clarification",
            "outdated": "may be outdated",
        }
        feedback_label = labels.get(feedback_type, feedback_type.replace("_", " "))
        detail = f": {comment[:180]}" if comment else ""
        batch = notification_engine.NotificationBatch()
        batch.add(
            category=notification_engine.FEEDBACK,
            user_ids=list(recipients),
            actor_id=actor.id,
            title="Document feedback",
            message=f'{actor_name} marked "{doc.title}" as {feedback_label}{detail}',
            related_entity_type="doc",
            related_entity_id=doc.id,
        )
        batch.flush(db)
    except Exception:
        logger.exception("Failed to create doc feedback notifications for doc %s", doc.id)


def _get_space_or_404(db: Session, space_id: int) -> models.DocSpace:
    space = crud_docs.get_space(db, space_id)
    if space is None:
        raise HTTPException(status_code=404, detail="Doc space not found")
    return space


def _get_doc_or_404(db: Session, doc_id: int) -> models.Doc:
    doc = crud_docs.get_doc(db, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Doc not found")
    return doc


def _author(user: Optional[models.User]) -> Optional[schemas.DocVersionAuthor]:
    if user is None:
        return None
    return schemas.DocVersionAuthor(id=user.id, username=user.username, full_name=user.full_name)


def _doc_out(doc: models.Doc, user: models.User, db: Session) -> schemas.Doc:
    """Serialize a doc with the current user's capability flags."""
    out = schemas.Doc.model_validate(doc)
    visit = (
        db.query(models.DocVisit)
        .filter(models.DocVisit.doc_id == doc.id, models.DocVisit.user_id == user.id)
        .first()
    )
    out.my_last_visited_at = visit.last_visited_at if visit else None
    out.is_pinned = (
        db.query(models.DocPin.id)
        .filter(models.DocPin.doc_id == doc.id, models.DocPin.user_id == user.id)
        .first()
        is not None
    )
    out.can_edit = _can_access(user, doc.project_id, "write", db)
    out.can_delete = _can_access(user, doc.project_id, "delete", db)
    out.can_share = out.can_edit
    out.can_view_stats = _is_admin(user)
    if not out.can_view_stats:
        out.view_count = None
        out.last_viewed_at = None
    return out


def _feedback_view(feedback: models.DocFeedback) -> schemas.DocFeedbackView:
    user = getattr(feedback, "user", None)
    return schemas.DocFeedbackView(
        id=feedback.id,
        doc_id=feedback.doc_id,
        user_id=feedback.user_id,
        feedback_type=feedback.feedback_type,
        comment=feedback.comment,
        section_text=feedback.section_text,
        resolved=bool(feedback.resolved),
        created_at=feedback.created_at,
        updated_at=feedback.updated_at,
        user=schemas.DocFeedbackUser.model_validate(user) if user is not None else None,
    )


def _feedback_summary(db: Session, doc_id: int, user_id: int) -> schemas.DocFeedbackSummary:
    rows = (
        db.query(models.DocFeedback.feedback_type, func.count(models.DocFeedback.id))
        .filter(models.DocFeedback.doc_id == doc_id)
        .group_by(models.DocFeedback.feedback_type)
        .all()
    )
    counts = {key: int(value or 0) for key, value in rows}
    unresolved = (
        db.query(func.count(models.DocFeedback.id))
        .filter(
            models.DocFeedback.doc_id == doc_id,
            models.DocFeedback.resolved.is_(False),
            models.DocFeedback.feedback_type.in_(["not_helpful", "clarification", "outdated"]),
        )
        .scalar()
        or 0
    )
    mine = (
        db.query(models.DocFeedback)
        .options(joinedload(models.DocFeedback.user))
        .filter(models.DocFeedback.doc_id == doc_id, models.DocFeedback.user_id == user_id)
        .first()
    )
    return schemas.DocFeedbackSummary(
        doc_id=doc_id,
        helpful=counts.get("helpful", 0),
        not_helpful=counts.get("not_helpful", 0),
        clarification=counts.get("clarification", 0),
        outdated=counts.get("outdated", 0),
        unresolved=unresolved,
        my_feedback=_feedback_view(mine) if mine else None,
    )


def _apply_feedback_payload(feedback: models.DocFeedback, payload: schemas.DocFeedbackCreate) -> None:
    feedback.feedback_type = payload.feedback_type
    feedback.comment = payload.comment
    feedback.section_text = payload.section_text
    feedback.resolved = False


def _record_visit(db: Session, doc: models.Doc, user: models.User) -> None:
    now = _utcnow()
    visit = (
        db.query(models.DocVisit)
        .filter(models.DocVisit.doc_id == doc.id, models.DocVisit.user_id == user.id)
        .first()
    )
    # Coalesce repeated reads by the same user into at most one counted view per
    # window, so re-navigating to the doc (or loading it before editing) doesn't
    # inflate view_count / visit_count. `last_visited_at` is always refreshed so
    # unread tracking stays accurate.
    last = _as_aware(visit.last_visited_at) if visit is not None else None
    counts_view = last is None or last <= now - _AUDIT_VIEW_WINDOW
    if counts_view:
        doc.view_count = (doc.view_count or 0) + 1
        doc.last_viewed_at = now
    if visit is None:
        visit = models.DocVisit(doc_id=doc.id, user_id=user.id, visit_count=1, first_visited_at=now, last_visited_at=now)
        db.add(visit)
    else:
        if counts_view:
            visit.visit_count = (visit.visit_count or 0) + 1
        visit.last_visited_at = now
    try:
        crud.safe_commit(db)
        db.refresh(doc)
    except Exception as exc:
        db.rollback()
        logger.warning("Could not record doc visit for doc %s/user %s: %s", doc.id, user.id, exc)


def _validate_folder_in_space(db: Session, folder_id: Optional[int], space_id: int) -> None:
    """A doc's (or sub-folder's) folder must belong to the same space."""
    if folder_id is None:
        return
    folder = crud_docs.get_folder(db, folder_id)
    if folder is None or folder.space_id != space_id:
        raise HTTPException(status_code=400, detail="Folder does not belong to this space")


def _validate_folder_parent(
    db: Session,
    folder: models.DocFolder,
    parent_folder_id: Optional[int],
) -> None:
    if parent_folder_id is None:
        return
    if parent_folder_id == folder.id:
        raise HTTPException(status_code=400, detail="Folder cannot be its own parent")
    parent = crud_docs.get_folder(db, parent_folder_id)
    if parent is None or parent.space_id != folder.space_id:
        raise HTTPException(status_code=400, detail="Parent folder must belong to the same space")

    seen = {folder.id}
    current = parent
    while current is not None:
        if current.id in seen:
            raise HTTPException(status_code=400, detail="Folder parent would create a cycle")
        seen.add(current.id)
        current = crud_docs.get_folder(db, current.parent_folder_id) if current.parent_folder_id else None


def _share_active(doc: models.Doc) -> bool:
    if doc.share_scope != "public" or not doc.public_id:
        return False
    expires = _as_aware(doc.share_expires_at)
    return expires is None or expires > _utcnow()


# --------------------------------------------------------------------------- #
# Granular sharing helpers                                                     #
# --------------------------------------------------------------------------- #

_ROLE_LABELS = {"viewer": "Viewer", "tester": "Tester", "manager": "Manager", "admin": "Admin"}


def _grant_active(grant: models.DocShareGrant) -> bool:
    expires = _as_aware(grant.expires_at)
    return expires is None or expires > _utcnow()


def _effective_project_role(user: models.User, project_id: int, db: Session) -> Optional[str]:
    """The user's effective role within a project, used to match ``role`` grants.
    Superusers and project owners resolve to ``admin``; otherwise the assignment
    role, falling back to the user's global directory role."""
    if getattr(user, "is_superuser", False):
        return "admin"
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if project is not None and project.owner_id == user.id:
        return "admin"
    assignment = (
        db.query(models.ProjectAssignment)
        .filter(
            models.ProjectAssignment.user_id == user.id,
            models.ProjectAssignment.project_id == project_id,
        )
        .first()
    )
    role = rbac.normalize_role(assignment.role) if assignment is not None else None
    if role is None:
        role = rbac.normalize_role(getattr(user, "role", None))
    return role.value if role else None


def _is_project_member(user: models.User, project_id: int, db: Session) -> bool:
    """True when the user belongs to a project (for ``project`` group grants).
    Global admins/managers and superusers effectively belong to every project."""
    if getattr(user, "is_superuser", False):
        return True
    if rbac.normalize_role(getattr(user, "role", None)) in {models.Role.ADMIN, models.Role.MANAGER}:
        return True
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if project is None:
        return False
    if project.owner_id == user.id:
        return True
    return (
        db.query(models.ProjectAssignment.id)
        .filter(
            models.ProjectAssignment.user_id == user.id,
            models.ProjectAssignment.project_id == project_id,
        )
        .first()
        is not None
    )


def _user_matches_grant(
    user: models.User, doc: models.Doc, grant: models.DocShareGrant, db: Session
) -> bool:
    if not _grant_active(grant):
        return False
    if grant.grant_type == "user":
        return grant.subject_user_id == user.id
    if grant.grant_type == "role":
        if doc.project_id is None or not grant.subject_role:
            return False
        return _effective_project_role(user, doc.project_id, db) == grant.subject_role.lower()
    if grant.grant_type == "project":
        return grant.subject_project_id is not None and _is_project_member(user, grant.subject_project_id, db)
    return False


def _doc_read_via_grant(
    user: models.User, doc: models.Doc, db: Session
) -> Optional[models.DocShareGrant]:
    """Return the first active grant authorizing this user — only while the doc's
    share_scope is 'restricted'. None when no grant applies."""
    if (doc.share_scope or "private") != "restricted":
        return None
    for grant in (doc.share_grants or []):
        if _user_matches_grant(user, doc, grant, db):
            return grant
    return None


def _grant_audit_text(grant: models.DocShareGrant) -> str:
    if grant.grant_type == "user":
        user = grant.subject_user
        who = (user.full_name or user.username) if user else f"user #{grant.subject_user_id}"
        return f"user {who}"
    if grant.grant_type == "role":
        return f"{_ROLE_LABELS.get((grant.subject_role or '').lower(), grant.subject_role)} role"
    if grant.grant_type == "project":
        project = grant.subject_project
        return f"project '{project.name}'" if project else f"project #{grant.subject_project_id}"
    return grant.grant_type


def _grant_view(grant: models.DocShareGrant) -> schemas.DocShareGrantView:
    label: Optional[str] = None
    sublabel: Optional[str] = None
    if grant.grant_type == "user":
        user = grant.subject_user
        if user is not None:
            label = user.full_name or user.username
            sublabel = user.email or user.username
    elif grant.grant_type == "role":
        label = _ROLE_LABELS.get((grant.subject_role or "").lower(), grant.subject_role)
        sublabel = "Project role"
    elif grant.grant_type == "project":
        project = grant.subject_project
        if project is not None:
            label = project.name
            sublabel = "Project team"
    return schemas.DocShareGrantView(
        id=grant.id,
        grant_type=grant.grant_type,
        subject_user_id=grant.subject_user_id,
        subject_role=grant.subject_role,
        subject_project_id=grant.subject_project_id,
        subject_label=label,
        subject_sublabel=sublabel,
        expires_at=grant.expires_at,
        is_expired=not _grant_active(grant),
        created_by=grant.created_by,
        created_at=grant.created_at,
    )


def _share_info(doc: models.Doc, db: Session) -> schemas.DocShareInfo:
    grants = crud_docs.list_share_grants(db, doc.id)
    return schemas.DocShareInfo(
        share_scope=doc.share_scope or "private",
        public_id=doc.public_id if _share_active(doc) else None,
        share_expires_at=doc.share_expires_at,
        share_url=(f"/docs/public/{doc.public_id}" if _share_active(doc) else None),
        grants=[_grant_view(g) for g in grants],
    )


def _reconcile_grants_after_move(
    db: Session, doc: models.Doc, previous_project_id: Optional[int], actor: models.User
) -> None:
    """When a doc is re-homed to a different project (or to the global scope),
    prune grants whose meaning was tied to the old project so access can't leak.

    - Role grants are scoped to the *old* project's role-holders → always dropped.
    - Moving to global makes restricted sharing meaningless (everyone can read a
      global doc), so all grants are dropped and a restricted scope reverts to
      private."""
    if doc.project_id == previous_project_id:
        return
    if doc.project_id is None:
        removed = crud_docs.clear_share_grants(db, doc.id, only_role=False)
        if (doc.share_scope or "private") == "restricted":
            doc.share_scope = "private"
            crud.safe_commit(db)
            db.refresh(doc)
        if removed:
            crud_docs.record_share_audit(
                db, doc.id, actor.id, "grant_removed",
                "Cleared share grants — document moved to the global scope",
            )
        return
    removed = crud_docs.clear_share_grants(db, doc.id, only_role=True)
    if removed:
        crud_docs.record_share_audit(
            db, doc.id, actor.id, "grant_removed",
            "Removed role grants — document moved to a different project",
        )


_KNOWN_HTML_TAGS = (
    "a|abbr|b|blockquote|br|code|del|div|em|h[1-6]|hr|i|img|ins|kbd|li|ol|p|pre|"
    "s|span|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul"
)
_HTML_TAG_RE = re.compile(rf"</?(?:{_KNOWN_HTML_TAGS})(?:\s[^>]*)?/?>", re.IGNORECASE)
_TABLE_SEP_RE = re.compile(r"^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$", re.MULTILINE)
_MD_STRIP_RE = re.compile(r"[#*_`>~\-\[\]\(\)!]|https?://\S+")


def _excerpt(md: Optional[str], limit: int = 200) -> str:
    """Plain-text preview for hub cards: strip raw HTML (e.g. resized tables),
    Markdown table scaffolding, and leftover Markdown punctuation."""
    text = _HTML_TAG_RE.sub(" ", md or "")   # drop raw HTML blocks (tables, etc.)
    text = _TABLE_SEP_RE.sub(" ", text)      # drop GFM separator rows (|---|---|)
    text = text.replace("|", " ")            # flatten remaining table cell pipes
    text = _MD_STRIP_RE.sub(" ", text)       # strip Markdown punctuation
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _space_view(space: models.DocSpace, stats: Optional[dict] = None) -> schemas.DocSpace:
    stats = stats or {}
    return schemas.DocSpace(
        id=space.id,
        uuid=space.uuid,
        name=space.name,
        slug=space.slug,
        description=space.description,
        classification=space.classification,
        icon=space.icon,
        color=space.color,
        project_id=space.project_id,
        order_index=space.order_index or 0,
        doc_count=stats.get("doc_count", 0),
        draft_count=stats.get("draft_count", 0),
        published_count=stats.get("published_count", 0),
        archived_count=stats.get("archived_count", 0),
        folder_count=stats.get("folder_count", 0),
        last_doc_updated_at=stats.get("last_doc_updated_at"),
        created_by=space.created_by,
        created_at=space.created_at,
        updated_at=space.updated_at,
    )


def _list_item(doc: models.Doc) -> schemas.DocListItem:
    return schemas.DocListItem(
        id=doc.id,
        project_seq=getattr(doc, "project_seq", None),
        uuid=doc.uuid,
        title=doc.title,
        slug=doc.slug,
        space_id=doc.space_id,
        folder_id=doc.folder_id,
        project_id=doc.project_id,
        classification=doc.classification,
        status=doc.status,
        tags=doc.tags,
        dir=doc.dir,
        language=doc.language,
        excerpt=_excerpt(doc.content_markdown),
        current_version=doc.current_version or 0,
        share_scope=doc.share_scope or "private",
        view_count=None,
        last_viewed_at=None,
        is_pinned=False,
        created_by=doc.created_by,
        updated_by=doc.updated_by,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


# --------------------------------------------------------------------------- #
# Markdown front-matter (import/export)                                        #
# --------------------------------------------------------------------------- #

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    m = _FRONTMATTER_RE.match(text or "")
    if not m:
        return {}, text or ""
    try:
        meta = yaml.safe_load(m.group(1)) or {}
        if not isinstance(meta, dict):
            meta = {}
    except Exception:
        meta = {}
    return meta, m.group(2)


def _first_h1(md: str) -> Optional[str]:
    for line in (md or "").splitlines():
        m = re.match(r"^#\s+(.+?)\s*#*\s*$", line)
        if m:
            return m.group(1).strip()
    return None


def _build_markdown_export(doc: models.Doc) -> str:
    meta = {
        "title": doc.title,
        "status": getattr(doc.status, "value", doc.status),
        "version": doc.current_version or 0,
    }
    if doc.classification:
        meta["classification"] = doc.classification
    if doc.tags:
        meta["tags"] = doc.tags
    if doc.dir and doc.dir != "auto":
        meta["dir"] = doc.dir
    front = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True).strip()
    return f"---\n{front}\n---\n\n{doc.content_markdown or ''}\n"


def _safe_filename(name: str) -> str:
    base = crud_docs.slugify(name) or "doc"
    return f"{base}.md"


def _is_markdown_filename(filename: str) -> bool:
    return filename.lower().endswith(_MARKDOWN_EXTENSIONS)


def _validate_import_size(raw: bytes) -> None:
    if len(raw) > DOC_IMPORT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Import file is too large")


def _safe_zip_member_name(filename: str) -> str:
    raw = filename or ""
    if raw.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:[\\/]", raw):
        raise HTTPException(status_code=400, detail="Zip contains an unsafe file path")
    normalized = raw.replace("\\", "/").strip("/")
    parts = [part for part in normalized.split("/") if part]
    if not parts or any(part in {".", ".."} for part in parts):
        raise HTTPException(status_code=400, detail="Zip contains an unsafe file path")
    return "/".join(parts)


# --------------------------------------------------------------------------- #
# Change impact analysis helpers                                              #
# --------------------------------------------------------------------------- #

_IMPACT_AREAS = {"requirements", "tests", "defects", "general"}
_IMPACT_SEVERITIES = {"low", "medium", "high"}
_IMPACT_RECOMMENDATIONS = {"publish", "review", "hold"}


def _impact_item(item: doc_impact_service.ImpactItem) -> schemas.DocImpactItem:
    return schemas.DocImpactItem(
        type=item.type, id=item.id, key=item.key, title=item.title,
        reason=item.reason, score=item.score, status=item.status,
        severity=item.severity, is_open=item.is_open, via=item.via,
    )


def _parse_impact_ai(content: str) -> tuple[str, str, List[schemas.DocImpactRisk]]:
    """Parse + clamp the AI risk JSON. Raises on unparseable content so the
    caller can record the failure and fall back to the deterministic graph."""
    parsed = extract_json_object(content)
    summary = clean_ai_text(parsed.get("summary"), 1000)
    recommendation = str(parsed.get("recommendation") or "review").strip().lower()
    if recommendation not in _IMPACT_RECOMMENDATIONS:
        recommendation = "review"
    risks: List[schemas.DocImpactRisk] = []
    for raw in (parsed.get("risks") or [])[:20]:
        if not isinstance(raw, dict):
            continue
        title = clean_ai_text(raw.get("title"), 200)
        if not title:
            continue
        area = str(raw.get("area") or "general").strip().lower()
        severity = str(raw.get("severity") or "medium").strip().lower()
        risks.append(schemas.DocImpactRisk(
            area=area if area in _IMPACT_AREAS else "general",
            severity=severity if severity in _IMPACT_SEVERITIES else "medium",
            title=title,
            detail=clean_ai_text(raw.get("detail"), 1000),
            mitigation=clean_ai_text(raw.get("mitigation"), 1000),
        ))
    return summary, recommendation, risks


def _ai_skip_reason(exc: HTTPException) -> str:
    """A user-meaningful skip reason from a failed AI completion. A 429 means a
    monthly token limit (provider or project) was hit — retrying won't help, so
    surface it distinctly from a transient ``ai_error``."""
    return "rate_limited" if getattr(exc, "status_code", None) == 429 else "ai_error"


def _clean_str_list(value, max_items: int, max_len: int) -> List[str]:
    """Coerce an AI-returned value into a clean list of short strings."""
    if not isinstance(value, list):
        return []
    out: List[str] = []
    for raw in value:
        text = clean_ai_text(raw, max_len)
        if text:
            out.append(text)
        if len(out) >= max_items:
            break
    return out


def _parse_convert_enhance(
    content: str,
) -> tuple[str, List[schemas.DocConvertEnhanceItem], List[schemas.DocConvertSuggestedRequirement]]:
    """Parse the AI enhancement JSON. AI Markdown suggestions are rendered to HTML
    here so the client can preview/apply them directly. Raises on unparseable
    content so the caller records the failure and degrades gracefully."""
    parsed = extract_json_object(content)
    summary = clean_ai_text(parsed.get("summary"), 600)

    items: List[schemas.DocConvertEnhanceItem] = []
    for raw in (parsed.get("items") or [])[:50]:
        if not isinstance(raw, dict):
            continue
        try:
            index = int(raw.get("index"))
        except (TypeError, ValueError):
            continue
        try:
            quality_score = max(0, min(100, int(raw.get("quality"))))
        except (TypeError, ValueError):
            quality_score = 0
        desc_md = clean_ai_text(raw.get("suggested_description"), 8000)
        acc_md = clean_ai_text(raw.get("suggested_acceptance"), 4000)
        items.append(schemas.DocConvertEnhanceItem(
            index=index,
            quality_score=quality_score,
            issues=_clean_str_list(raw.get("issues"), max_items=8, max_len=240),
            edge_cases=_clean_str_list(raw.get("edge_cases"), max_items=10, max_len=240),
            suggested_title=clean_ai_text(raw.get("suggested_title"), 255),
            suggested_description_html=conv.markdown_to_html(desc_md) if desc_md else "",
            suggested_acceptance_html=conv.markdown_to_html(acc_md) if acc_md else "",
        ))

    suggested: List[schemas.DocConvertSuggestedRequirement] = []
    for raw in (parsed.get("suggested_requirements") or [])[:10]:
        if not isinstance(raw, dict):
            continue
        title = clean_ai_text(raw.get("title"), 255)
        if not title:
            continue
        desc_md = clean_ai_text(raw.get("description"), 8000)
        acc_md = clean_ai_text(raw.get("acceptance"), 4000)
        suggested.append(schemas.DocConvertSuggestedRequirement(
            title=title,
            description_html=conv.markdown_to_html(desc_md) if desc_md else "",
            acceptance_html=conv.markdown_to_html(acc_md) if acc_md else "",
            rationale=clean_ai_text(raw.get("rationale"), 400),
        ))

    return summary, items, suggested


_CONVERT_HTML_BLOCK_BREAK_RE = re.compile(r"<\s*br\s*/?>|</\s*(p|div|li|h[1-6]|tr|pre)\s*>", re.IGNORECASE)
_CONVERT_HTML_TAG_RE = re.compile(rf"</?(?:{_KNOWN_HTML_TAGS})(?:\s[^>]*)?/?>", re.IGNORECASE)
_LIST_MARKER_RE = re.compile(r"^\s*(?:[-*+•]|\d+[.)])\s+")
_GHERKIN_HINT_RE = re.compile(
    r"^\s*(feature|rule|background|scenario outline|scenario|given|when|then|and|but)\b",
    re.IGNORECASE | re.MULTILINE,
)
_LOCALIZED_GHERKIN_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^\s*(ویژگی|قابلیت)\s*[:：]\s*", re.IGNORECASE), "Feature: "),
    (re.compile(r"^\s*(خاصية|ميزة|الميزة)\s*[:：]\s*", re.IGNORECASE), "Feature: "),
    (re.compile(r"^\s*(طرح سناریو|مخطط السيناريو)\s*[:：]\s*", re.IGNORECASE), "Scenario Outline: "),
    (re.compile(r"^\s*(سناریو|سيناريو)\s*[:：]\s*", re.IGNORECASE), "Scenario: "),
    (re.compile(r"^\s*(پیش‌زمینه|پیش زمینه|الخلفية|خلفية)\s*[:：]\s*", re.IGNORECASE), "Background: "),
    (re.compile(r"^\s*(با فرض|فرض|بفرض)\s+", re.IGNORECASE), "Given "),
    (re.compile(r"^\s*(وقتی|زمانی که|هنگامی که|عندما|متى)\s+", re.IGNORECASE), "When "),
    (re.compile(r"^\s*(آنگاه|سپس|إذن|اذاً|عندئذ)\s+", re.IGNORECASE), "Then "),
    (re.compile(r"^\s*(اما|ولی|لكن)\s+", re.IGNORECASE), "But "),
    (re.compile(r"^\s*(و)\s+", re.IGNORECASE), "And "),
]


def _html_to_lines(value: Optional[str]) -> str:
    if not value:
        return ""
    text = _CONVERT_HTML_BLOCK_BREAK_RE.sub("\n", value)
    text = _CONVERT_HTML_TAG_RE.sub(" ", text)
    text = html.unescape(text).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _strip_code_fence(value: str) -> str:
    text = re.sub(r"^```(?:gherkin|feature)?\s*", "", value.strip(), flags=re.IGNORECASE)
    return re.sub(r"```$", "", text, flags=re.IGNORECASE).strip()


def _normalize_localized_gherkin(value: str) -> str:
    out: list[str] = []
    for line in value.split("\n"):
        trimmed = line.lstrip()
        indent = line[: len(line) - len(trimmed)]
        replaced = None
        for pattern, prefix in _LOCALIZED_GHERKIN_PATTERNS:
            if pattern.search(trimmed):
                replaced = indent + pattern.sub(prefix, trimmed)
                break
        out.append(replaced if replaced is not None else line)
    return "\n".join(out)


def _plain_criteria(value: str) -> list[str]:
    criteria: list[str] = []
    for raw in value.split("\n"):
        line = _LIST_MARKER_RE.sub("", raw).strip()
        line = re.sub(r"\s+", " ", line)
        if line and not re.fullmatch(r"acceptance criteria:?", line, flags=re.IGNORECASE):
            criteria.append(line)
        if len(criteria) >= 12:
            break
    return criteria


def _has_feature_style_gherkin(value: str) -> bool:
    return bool(
        re.search(r"^\s*Feature:", value, flags=re.IGNORECASE | re.MULTILINE)
        and re.search(r"^\s*(Scenario|Scenario Outline|Background):", value, flags=re.IGNORECASE | re.MULTILINE)
        and re.search(r"^\s*Given\b", value, flags=re.IGNORECASE | re.MULTILINE)
        and re.search(r"^\s*When\b", value, flags=re.IGNORECASE | re.MULTILINE)
        and re.search(r"^\s*Then\b", value, flags=re.IGNORECASE | re.MULTILINE)
    )


def _repair_gherkin(value: str, title: str, fallback_html: Optional[str]) -> Optional[str]:
    text = _normalize_localized_gherkin(value).strip()
    if not _GHERKIN_HINT_RE.search(text):
        return None
    out: list[str] = []
    feature_seen = False
    block_open = False
    block_start = -1
    has_given = has_when = has_then = False
    outline = False
    has_examples = False

    def finish_block() -> None:
        nonlocal block_open, block_start, has_given, has_when, has_then, outline, has_examples
        if not block_open or block_start < 0:
            return
        if outline and not has_examples:
            out[block_start] = re.sub(r"Scenario Outline:", "Scenario:", out[block_start], flags=re.IGNORECASE)
            for idx in range(block_start + 1, len(out)):
                out[idx] = re.sub(r"<([^<>]+)>", r"\1", out[idx])
        if not has_given:
            out.insert(block_start + 1, f"Given {title} is in scope")
        if not has_when:
            out.append("When the requirement behavior is exercised")
        if not has_then:
            criteria = _plain_criteria(_html_to_lines(fallback_html))
            out.append(f"Then {criteria[0] if criteria else f'{title} is satisfied'}")
        block_open = False

    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            out.append("")
            continue
        if re.match(r"^Feature:", line, flags=re.IGNORECASE):
            if feature_seen:
                continue
            finish_block()
            feature_seen = True
            out.append(line or f"Feature: {title}")
            continue
        if re.match(r"^Rule:", line, flags=re.IGNORECASE):
            finish_block()
            out.append(line)
            continue
        if re.match(r"^(Background|Scenario Outline|Scenario|Example):", line, flags=re.IGNORECASE):
            finish_block()
            block_open = True
            block_start = len(out)
            has_given = has_when = has_then = False
            outline = bool(re.match(r"^Scenario Outline:", line, flags=re.IGNORECASE))
            has_examples = False
            out.append(line)
            continue
        if re.match(r"^Examples:", line, flags=re.IGNORECASE):
            has_examples = True
            out.append(line)
            continue
        if re.match(r"^(Given|When|Then|And|But|\*)\b", line, flags=re.IGNORECASE):
            if not block_open:
                block_open = True
                block_start = len(out)
                has_given = has_when = has_then = False
                outline = has_examples = False
                out.append(f"Scenario: {title}")
            if not has_given and re.match(r"^(And|But)\b", line, flags=re.IGNORECASE):
                line = re.sub(r"^(And|But)\b", "Given", line, flags=re.IGNORECASE)
            has_given = has_given or bool(re.match(r"^Given\b", line, flags=re.IGNORECASE))
            has_when = has_when or bool(re.match(r"^When\b", line, flags=re.IGNORECASE))
            has_then = has_then or bool(re.match(r"^Then\b", line, flags=re.IGNORECASE))
            out.append(line)
            continue
        out.append(line)

    finish_block()
    if not feature_seen:
        out.insert(0, "")
        out.insert(0, f"Feature: {title}")
    formatted = feature_file_service.format_gherkin("\n".join(out))
    return formatted if _has_feature_style_gherkin(formatted) else None


def _prose_to_feature(title: str, value: str, fallback_html: Optional[str]) -> str:
    criteria = _plain_criteria(value or _html_to_lines(fallback_html)) or [f"{title} is satisfied"]
    scenarios: list[str] = []
    for idx, criterion in enumerate(criteria):
        scenario_title = f"{title} - criterion {idx + 1}" if len(criteria) > 1 else title
        scenarios.append(
            "\n".join([
                f"Scenario: {scenario_title}",
                f"Given {title} is in scope",
                "When the requirement behavior is exercised",
                f"Then {criterion}",
            ])
        )
    return feature_file_service.format_gherkin(f"Feature: {title}\n\n" + "\n\n".join(scenarios))


def _feature_acceptance_html(title: str, acceptance_html: Optional[str], fallback_html: Optional[str]) -> str:
    safe_title = (title or "Requirement").strip() or "Requirement"
    text = _strip_code_fence(_html_to_lines(acceptance_html) or _html_to_lines(fallback_html))
    gherkin = _repair_gherkin(text, safe_title, fallback_html) or _prose_to_feature(safe_title, text, fallback_html)
    return f'<pre><code class="language-gherkin">{html.escape(gherkin)}</code></pre>'


def _audit_doc_impact(db: Session, actor: models.User, doc: models.Doc) -> None:
    """Best-effort audit row for a change-impact analysis run.

    ``EntityType`` has no ``doc`` member, so the event is attributed to the
    project (mirroring the project AI chat audit), with the doc identified in
    the description. Global docs have no project to attribute to, so are skipped."""
    if doc.project_id is None:
        return
    try:
        from ..models import AuditAction, EntityType
        from ..schemas_audit import AuditTrailCreate
        from ..services.audit_service import get_audit_service

        get_audit_service(db).create_audit_trail(
            AuditTrailCreate(
                user_id=actor.id,
                action=AuditAction.EXECUTE.value,
                entity_type=EntityType.PROJECT.value,
                entity_id=doc.project_id,
                project_id=doc.project_id,
                description=f'Ran change impact analysis on doc {doc.id} "{doc.title}"',
            )
        )
    except Exception:  # pragma: no cover - audit must never break the request
        logger.exception("Failed to audit doc impact analysis for doc %s", doc.id)


def _release_entry(entry: release_notes.ReleaseEntry) -> schemas.ReleaseNotesEntry:
    return schemas.ReleaseNotesEntry(
        type=entry.type, id=entry.id, key=entry.key, title=entry.title,
        status=entry.status, severity=entry.severity, via_docs=entry.via_docs,
    )


def _release_source_schema(source: release_notes.ReleaseSource) -> schemas.ReleaseNotesSource:
    return schemas.ReleaseNotesSource(
        range_start=source.range_start,
        range_end=source.range_end,
        changed_docs=[
            schemas.ReleaseNotesChangedDoc(
                doc_id=d.doc_id, title=d.title, actions=d.actions, versions=d.versions,
                headings_added=d.headings_added, last_changed_at=d.last_changed_at,
            )
            for d in source.changed_docs
        ],
        requirements=[_release_entry(e) for e in source.requirements],
        resolved_defects=[_release_entry(e) for e in source.resolved_defects],
        open_defects=[_release_entry(e) for e in source.open_defects],
        coverage=schemas.ReleaseNotesCoverage(
            requirements_total=source.coverage.requirements_total,
            requirements_covered=source.coverage.requirements_covered,
            requirements_uncovered=source.coverage.requirements_uncovered,
            test_cases=source.coverage.test_cases,
            coverage_pct=source.coverage.coverage_pct,
        ),
    )


def _parse_release_summary(content: str) -> str:
    """Parse the AI summary JSON, clamped; raises on unparseable content."""
    parsed = extract_json_object(content)
    return clean_ai_text(parsed.get("summary"), 4000)


# --------------------------------------------------------------------------- #
# Routes                                                                       #
# --------------------------------------------------------------------------- #

def register_docs_routes(app) -> None:

    # ── Spaces ──────────────────────────────────────────────────────────────
    @app.get("/docs/spaces", response_model=List[schemas.DocSpace], tags=["Docs"])
    def list_doc_spaces(
        project_id: Optional[int] = Query(None, ge=1),
        include_global: bool = Query(True),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if project_id is not None:
            _require(current_user, project_id, "read", db)
        spaces = crud_docs.list_spaces(db, project_id=project_id, include_global=include_global)
        stats = crud_docs.space_stats(db)
        return [_space_view(s, stats.get(s.id)) for s in spaces]

    @app.post("/docs/spaces", response_model=schemas.DocSpace, status_code=201, tags=["Docs"])
    def create_doc_space(
        payload: schemas.DocSpaceCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if payload.project_id is not None:
            project = crud.get_project(db, payload.project_id)
            if project is None:
                raise HTTPException(status_code=404, detail="Project not found")
        _require(current_user, payload.project_id, "write", db)
        space = crud_docs.create_space(db, payload, actor_id=current_user.id)
        return _space_view(space)

    # Static path: must be registered before the /docs/spaces/{space_id} routes.
    @app.post("/docs/spaces/reorder", response_model=List[schemas.DocSpace], tags=["Docs"])
    def reorder_doc_spaces(
        payload: schemas.DocSpaceReorder,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        spaces = [_get_space_or_404(db, space_id) for space_id in payload.space_ids]
        # Only spaces whose position actually changes need write access, so a
        # project member can reorder project spaces around read-only globals.
        for index, space in enumerate(spaces):
            if (space.order_index or 0) != index:
                _require(current_user, space.project_id, "write", db)
        crud_docs.reorder_spaces(db, spaces)
        stats = crud_docs.space_stats(db)
        return [_space_view(s, stats.get(s.id)) for s in spaces]

    @app.get("/docs/spaces/{space_id}", response_model=schemas.DocSpace, tags=["Docs"])
    def get_doc_space(
        space_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "read", db)
        stats = crud_docs.space_stats(db)
        return _space_view(space, stats.get(space.id))

    @app.put("/docs/spaces/{space_id}", response_model=schemas.DocSpace, tags=["Docs"])
    def update_doc_space(
        payload: schemas.DocSpaceUpdate,
        space_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "write", db)
        space = crud_docs.update_space(db, space, payload)
        stats = crud_docs.space_stats(db)
        return _space_view(space, stats.get(space.id))

    @app.delete("/docs/spaces/{space_id}", status_code=204, tags=["Docs"])
    def delete_doc_space(
        space_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "delete", db)
        crud_docs.delete_space(db, space)
        return Response(status_code=204)

    # ── Folders ─────────────────────────────────────────────────────────────
    @app.get("/docs/folders", response_model=List[schemas.DocFolder], tags=["Docs"])
    def list_doc_folders(
        space_id: int = Query(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "read", db)
        return crud_docs.list_folders(db, space_id)

    @app.post("/docs/folders", response_model=schemas.DocFolder, status_code=201, tags=["Docs"])
    def create_doc_folder(
        payload: schemas.DocFolderCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, payload.space_id)
        _require(current_user, space.project_id, "write", db)
        # A parent folder, when given, must live in the same space.
        if payload.parent_folder_id is not None:
            parent = crud_docs.get_folder(db, payload.parent_folder_id)
            if parent is None or parent.space_id != space.id:
                raise HTTPException(status_code=400, detail="Parent folder must belong to the same space")
        return crud_docs.create_folder(db, payload)

    @app.put("/docs/folders/{folder_id}", response_model=schemas.DocFolder, tags=["Docs"])
    def update_doc_folder(
        payload: schemas.DocFolderUpdate,
        folder_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        folder = crud_docs.get_folder(db, folder_id)
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        space = _get_space_or_404(db, folder.space_id)
        _require(current_user, space.project_id, "write", db)
        if "parent_folder_id" in payload.model_fields_set:
            _validate_folder_parent(db, folder, payload.parent_folder_id)
        return crud_docs.update_folder(db, folder, payload)

    @app.delete("/docs/folders/{folder_id}", status_code=204, tags=["Docs"])
    def delete_doc_folder(
        folder_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        folder = crud_docs.get_folder(db, folder_id)
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        space = _get_space_or_404(db, folder.space_id)
        _require(current_user, space.project_id, "delete", db)
        crud_docs.delete_folder(db, folder)
        return Response(status_code=204)

    # ── Import (literal path, before /docs/{doc_id}) ────────────────────────
    @app.post("/docs/import", response_model=List[schemas.DocListItem], tags=["Docs"])
    async def import_docs(
        space_id: int = Form(...),
        folder_id: Optional[int] = Form(None),
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "write", db)
        _validate_folder_in_space(db, folder_id, space.id)
        raw = await file.read()
        _validate_import_size(raw)
        name = file.filename or "import.md"
        created: List[models.Doc] = []

        if name.lower().endswith(".zip"):
            try:
                created = _import_zip(db, space, raw, current_user.id)
                crud.safe_commit(db)
                for doc in created:
                    db.refresh(doc)
            except HTTPException:
                db.rollback()
                raise
            except Exception as exc:
                db.rollback()
                logger.exception("Unexpected doc import failure: %s", exc)
                raise HTTPException(status_code=500, detail="Could not import documents")
        elif _is_markdown_filename(name):
            created.append(_import_single_md(db, space, name, raw, folder_id, current_user.id))
        else:
            raise HTTPException(status_code=400, detail="Only Markdown files and zip bundles can be imported")

        return [_list_item(d) for d in created]

    # ── Public share viewer (no auth; literal path before /docs/{doc_id}) ────
    @app.get("/docs/public/{public_id}", response_model=schemas.DocPublicView, tags=["Docs"])
    def get_public_doc(
        public_id: str = Path(..., min_length=8, max_length=64),
        db: Session = Depends(get_db),
    ):
        doc = db.query(models.Doc).filter(models.Doc.public_id == public_id).first()
        if doc is None or not _share_active(doc):
            raise HTTPException(status_code=404, detail="This shared document is unavailable")
        # This endpoint is unauthenticated, so coalesce bursts of public views into
        # at most one audit row per window — preserves the signal without letting a
        # popular (or hammered) link flood the trail.
        last = crud_docs.latest_share_audit_at(db, doc.id, "public_accessed")
        last_aware = _as_aware(last)
        if last_aware is None or last_aware <= _utcnow() - _AUDIT_VIEW_WINDOW:
            crud_docs.record_share_audit(db, doc.id, None, "public_accessed", "Viewed via public link")
        return schemas.DocPublicView.model_validate(doc)

    # ── Facets (literal path, before /docs/{doc_id}) ────────────────────────
    @app.get("/docs/facets", response_model=schemas.DocFacets, tags=["Docs"])
    def get_doc_facets(
        space_id: Optional[int] = Query(None, ge=1),
        project_id: Optional[int] = Query(None, ge=1),
        include_global: bool = Query(False),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Distinct tag/classification values (with counts) for the filter panel,
        computed server-side so the client never downloads every doc."""
        if space_id is not None:
            space = _get_space_or_404(db, space_id)
            _require(current_user, space.project_id, "read", db)
        elif project_id is not None:
            _require(current_user, project_id, "read", db)
        return crud_docs.doc_facets(
            db, space_id=space_id, project_id=project_id,
            include_global=include_global,
            global_only=(space_id is None and project_id is None),
        )

    # ── Admin stats overview (literal path, before /docs/{doc_id}) ──────────
    @app.get("/docs/stats/overview", response_model=schemas.DocStatsOverview, tags=["Docs"])
    def get_doc_stats_overview(
        space_id: Optional[int] = Query(None, ge=1),
        project_id: Optional[int] = Query(None, ge=1),
        include_global: bool = Query(False),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Aggregate read statistics for the current scope. Admin-only, matching
        the per-doc statistics gate."""
        if space_id is not None:
            space = _get_space_or_404(db, space_id)
            _require(current_user, space.project_id, "read", db)
        elif project_id is not None:
            _require(current_user, project_id, "read", db)
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Only admins can view document statistics")
        return crud_docs.stats_overview(
            db, space_id=space_id, project_id=project_id,
            include_global=include_global,
            global_only=(space_id is None and project_id is None),
        )

    # ── Docs list/create (literal /docs) ────────────────────────────────────
    @app.get("/docs", response_model=List[schemas.DocListItem], tags=["Docs"],
             dependencies=[Depends(require_project_feature("doc_hub"))])
    def list_docs(
        response: Response,
        space_id: Optional[int] = Query(None, ge=1),
        project_id: Optional[int] = Query(None, ge=1),
        folder_id: Optional[int] = Query(None, ge=1),
        classification: Optional[str] = Query(None),
        status: Optional[models.DocStatus] = Query(None),
        tag: Optional[str] = Query(None),
        q: Optional[str] = Query(None),
        include_global: bool = Query(False),
        pinned_only: bool = Query(False),
        visited_only: bool = Query(False),
        sort: str = Query("latest_edited", pattern="^(latest_edited|latest_visited|created|title)$"),
        skip: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=200),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        effective_space_id = space_id
        if folder_id is not None:
            folder = crud_docs.get_folder(db, folder_id)
            if folder is None:
                raise HTTPException(status_code=404, detail="Folder not found")
            if space_id is not None and folder.space_id != space_id:
                raise HTTPException(status_code=400, detail="Folder does not belong to this space")
            effective_space_id = folder.space_id
            folder_space = _get_space_or_404(db, folder.space_id)
            _require(current_user, folder_space.project_id, "read", db)
        elif space_id is not None:
            space = _get_space_or_404(db, space_id)
            _require(current_user, space.project_id, "read", db)
        elif project_id is not None:
            _require(current_user, project_id, "read", db)
        else:
            project_id = None

        normalized_q = q.strip() if q and q.strip() else None
        normalized_tag = tag.strip() if tag and tag.strip() else None
        normalized_classification = classification.strip() if classification and classification.strip() else None
        global_only = effective_space_id is None and project_id is None
        filter_kwargs = dict(
            space_id=effective_space_id, project_id=project_id, folder_id=folder_id,
            classification=normalized_classification,
            status=(status.value if status else None),
            tag=normalized_tag,
            q=normalized_q,
            include_global=include_global,
            global_only=global_only,
            pinned_only=pinned_only,
            visited_only=visited_only,
            user_id=current_user.id,
        )
        # Total for pagination — exposed as a header so the body stays a plain list.
        total = crud_docs.count_docs(db, **filter_kwargs)
        response.headers["X-Total-Count"] = str(total)
        docs = crud_docs.list_docs(
            db, **filter_kwargs, sort=sort, skip=skip, limit=limit,
        )
        visit_rows = (
            db.query(models.DocVisit)
            .filter(models.DocVisit.user_id == current_user.id, models.DocVisit.doc_id.in_([d.id for d in docs] or [0]))
            .all()
        )
        visits = {visit.doc_id: visit.last_visited_at for visit in visit_rows}
        pin_rows = (
            db.query(models.DocPin.doc_id)
            .filter(models.DocPin.user_id == current_user.id, models.DocPin.doc_id.in_([d.id for d in docs] or [0]))
            .all()
        )
        pinned_ids = {row.doc_id for row in pin_rows}
        items = []
        for d in docs:
            item = _list_item(d)
            item.my_last_visited_at = visits.get(d.id)
            item.is_pinned = d.id in pinned_ids
            if _is_admin(current_user):
                item.view_count = d.view_count or 0
                item.last_viewed_at = d.last_viewed_at
            items.append(item)
        return items

    @app.post("/docs", response_model=schemas.Doc, status_code=201, tags=["Docs"],
              dependencies=[Depends(require_project_feature("doc_hub"))])
    def create_doc(
        payload: schemas.DocCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, payload.space_id)
        _require(current_user, space.project_id, "write", db)
        _validate_folder_in_space(db, payload.folder_id, space.id)
        # A new doc inherits its space's classification by default.
        if not payload.classification and space.classification:
            payload.classification = space.classification
        doc = crud_docs.create_doc(db, payload, actor_id=current_user.id)
        _notify_doc_mentions(db, doc, current_user, "")
        return _doc_out(doc, current_user, db)

    @app.get("/docs/spaces/{space_id}/export", tags=["Docs"])
    def export_space(
        space_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Export a whole space as a zip of Markdown files mirroring the folder
        tree, plus a manifest.json (docs-as-code round-trip)."""
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "read", db)
        buf = _build_space_zip(db, space)
        return Response(
            content=buf,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{crud_docs.slugify(space.name)}.zip"'},
        )

    # ── Living release notes ─────────────────────────────────────────────────
    # Registered before the dynamic ``/docs/{doc_id}`` routes so the literal
    # ``/docs/release-notes`` path is never parsed as a doc id.

    @app.post("/docs/release-notes/generate", response_model=schemas.ReleaseNotesPreview, tags=["Docs"])
    async def generate_release_notes(
        payload: schemas.ReleaseNotesGenerateRequest,
        request: Request,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Generate a release-notes *preview* (not persisted) from what changed in
        a project over a window: changed docs, linked requirements, resolved/known
        defects, and test coverage. The editable Markdown draft is always returned;
        the AI summary blurb is best-effort and degrades gracefully."""
        project = crud.get_project(db, payload.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        _require(current_user, payload.project_id, "write", db)
        if not is_feature_enabled(project, "doc_hub"):
            raise HTTPException(status_code=403, detail="The 'doc_hub' feature is disabled for this project")

        source = release_notes.gather_release_data(
            db, payload.project_id, since=payload.since, until=payload.until,
        )
        title = release_notes.default_title(source)
        content_markdown = release_notes.render_markdown(source, title)

        result = schemas.ReleaseNotesPreview(
            project_id=payload.project_id,
            title=title,
            content_markdown=content_markdown,
            source=_release_source_schema(source),
        )

        has_content = bool(
            source.changed_docs or source.requirements
            or source.resolved_defects or source.open_defects
        )
        if not payload.include_ai:
            result.ai_skipped_reason = "disabled_by_request"
        elif not has_content:
            result.ai_skipped_reason = "no_changes"
        elif not is_feature_enabled(project, "ask_ai"):
            result.ai_skipped_reason = "ask_ai_disabled"
        elif not get_ai_manager_status(db).get("available"):
            result.ai_skipped_reason = "ai_unavailable"
        else:
            try:
                completion = await _cancel_on_disconnect(
                    request,
                    generate_ai_completion(
                        db,
                        AICompletionRequest(
                            prompt=build_release_notes_prompt(title, release_notes.ai_payload(source)),
                            max_tokens=900, temperature=0.3, timeout_seconds=120,
                        ),
                        operation="doc_release_notes",
                        project_id=payload.project_id, user_id=current_user.id,
                    ),
                )
                summary = _parse_release_summary(completion.content)
                if summary:
                    result.summary = summary
                    result.content_markdown = release_notes.render_markdown(
                        source, title, summary=summary,
                    )
                    result.ai_available = True
                    result.provider = completion.provider
                    result.model = completion.model
                else:
                    result.ai_skipped_reason = "ai_error"
            except HTTPException as exc:
                logger.warning("Release notes AI summary failed for project %s: %s", payload.project_id, exc.detail)
                result.ai_skipped_reason = _ai_skip_reason(exc)
            except Exception as exc:
                logger.warning("Release notes AI summary errored for project %s: %s", payload.project_id, exc)
                result.ai_skipped_reason = "ai_error"

        return result

    @app.get("/docs/release-notes", response_model=List[schemas.ReleaseNoteListItem], tags=["Docs"])
    def list_release_notes(
        project_id: int = Query(..., ge=1),
        status: Optional[str] = Query(None),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require(current_user, project_id, "read", db)
        if status is not None and status not in ("draft", "published"):
            raise HTTPException(status_code=400, detail="status must be draft or published")
        notes = crud_docs.list_release_notes(db, project_id, status=status)
        return [schemas.ReleaseNoteListItem.model_validate(n) for n in notes]

    @app.post("/docs/release-notes", response_model=schemas.ReleaseNote, status_code=201, tags=["Docs"])
    def create_release_note(
        payload: schemas.ReleaseNoteCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Save a (reviewed/edited) release-notes draft."""
        project = crud.get_project(db, payload.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        _require(current_user, payload.project_id, "write", db)
        if not is_feature_enabled(project, "doc_hub"):
            raise HTTPException(status_code=403, detail="The 'doc_hub' feature is disabled for this project")
        note = crud_docs.create_release_note(db, payload, actor_id=current_user.id)
        return schemas.ReleaseNote.model_validate(note)

    def _get_release_note_or_404(note_id: int, db: Session) -> models.DocReleaseNote:
        note = crud_docs.get_release_note(db, note_id)
        if note is None:
            raise HTTPException(status_code=404, detail="Release note not found")
        return note

    @app.get("/docs/release-notes/{note_id}", response_model=schemas.ReleaseNote, tags=["Docs"])
    def get_release_note(
        note_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        note = _get_release_note_or_404(note_id, db)
        _require(current_user, note.project_id, "read", db)
        return schemas.ReleaseNote.model_validate(note)

    @app.put("/docs/release-notes/{note_id}", response_model=schemas.ReleaseNote, tags=["Docs"])
    def update_release_note(
        payload: schemas.ReleaseNoteUpdate,
        note_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        note = _get_release_note_or_404(note_id, db)
        _require(current_user, note.project_id, "write", db)
        note = crud_docs.update_release_note(db, note, payload, actor_id=current_user.id)
        return schemas.ReleaseNote.model_validate(note)

    @app.post("/docs/release-notes/{note_id}/publish", response_model=schemas.ReleaseNote, tags=["Docs"])
    def publish_release_note(
        note_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        note = _get_release_note_or_404(note_id, db)
        _require(current_user, note.project_id, "write", db)
        note = crud_docs.publish_release_note(db, note, actor_id=current_user.id)
        return schemas.ReleaseNote.model_validate(note)

    @app.post("/docs/release-notes/{note_id}/unpublish", response_model=schemas.ReleaseNote, tags=["Docs"])
    def unpublish_release_note(
        note_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        note = _get_release_note_or_404(note_id, db)
        _require(current_user, note.project_id, "write", db)
        note = crud_docs.unpublish_release_note(db, note, actor_id=current_user.id)
        return schemas.ReleaseNote.model_validate(note)

    @app.delete("/docs/release-notes/{note_id}", status_code=204, tags=["Docs"])
    def delete_release_note(
        note_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        note = _get_release_note_or_404(note_id, db)
        _require(current_user, note.project_id, "write", db)
        crud_docs.delete_release_note(db, note)
        return Response(status_code=204)

    # ── Single doc ──────────────────────────────────────────────────────────
    @app.get("/docs/{doc_id}", response_model=schemas.Doc, tags=["Docs"])
    def get_doc(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        if not _can_access(current_user, doc.project_id, "read", db):
            # No project RBAC read — fall back to a granular share grant.
            grant = _doc_read_via_grant(current_user, doc, db)
            if grant is None:
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            # Coalesce this user's repeated reads into one audit row per window.
            last = crud_docs.latest_share_audit_at(db, doc.id, "accessed", actor_id=current_user.id)
            last_aware = _as_aware(last)
            if last_aware is None or last_aware <= _utcnow() - _AUDIT_VIEW_WINDOW:
                crud_docs.record_share_audit(
                    db, doc.id, current_user.id, "accessed",
                    f"Viewed via {_grant_audit_text(grant)} grant",
                )
        _record_visit(db, doc, current_user)
        return _doc_out(doc, current_user, db)

    @app.put("/docs/{doc_id}/pin", response_model=schemas.DocListItem, tags=["Docs"])
    def set_doc_pin(
        payload: schemas.DocPinUpdate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        try:
            crud_docs.set_doc_pin(db, doc.id, current_user.id, payload.pinned)
        except Exception as exc:
            db.rollback()
            logger.exception("Could not update doc pin for doc %s/user %s", doc.id, current_user.id)
            raise HTTPException(status_code=500, detail="Could not update document pin") from exc

        item = _list_item(doc)
        item.is_pinned = payload.pinned
        visit = (
            db.query(models.DocVisit)
            .filter(models.DocVisit.doc_id == doc.id, models.DocVisit.user_id == current_user.id)
            .first()
        )
        item.my_last_visited_at = visit.last_visited_at if visit else None
        if _is_admin(current_user):
            item.view_count = doc.view_count or 0
            item.last_viewed_at = doc.last_viewed_at
        return item

    @app.put("/docs/{doc_id}", response_model=schemas.Doc, tags=["Docs"])
    def update_doc(
        payload: schemas.DocUpdate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        # Snapshot before the update so mention notifications only fire for users
        # newly added since the last save (the editor autosaves frequently).
        previous_markdown = doc.content_markdown
        previous_project_id = doc.project_id
        target_space_id = doc.space_id
        if payload.space_id is not None and payload.space_id != doc.space_id:
            new_space = _get_space_or_404(db, payload.space_id)
            _require(current_user, new_space.project_id, "write", db)
            target_space_id = new_space.id
        # Validate the (possibly new) folder against the (possibly new) space.
        if "folder_id" in payload.model_fields_set:
            _validate_folder_in_space(db, payload.folder_id, target_space_id)
        # One batch for the save: the watch broadcast queued inside update_doc and
        # the @mention notice below flush once, so a watcher who is newly mentioned
        # gets a single row — the mention — rather than two.
        batch = notification_engine.NotificationBatch()
        doc = crud_docs.update_doc(db, doc, payload, actor_id=current_user.id, batch=batch)
        _reconcile_grants_after_move(db, doc, previous_project_id, current_user)
        _notify_doc_mentions(db, doc, current_user, previous_markdown, batch=batch)
        batch.flush(db)
        return _doc_out(doc, current_user, db)

    @app.post("/docs/{doc_id}/request-review", response_model=schemas.DocReviewRequestResult, tags=["Docs"])
    def request_doc_review(
        review_request: schemas.DocReviewRequest,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Ask teammates to review a document.

        Moves the doc into the ``in_review`` status and emits the engine's REVIEW
        notification (Work Inbox "Reviews") to each named reviewer. The requester is
        never notified of their own request, and every reviewer must exist, be
        active, and have read access to the doc — so a review request can never leak
        a doc to someone who can't open it. Watchers are told the doc entered review
        through the same batch, so a reviewer who also watches the doc gets the
        single, higher-priority REVIEW row rather than a duplicate watch alert.
        """
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)

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
                status_code=400, detail=f"Reviewer(s) not found or inactive: {missing}"
            )
        no_access = [
            uid
            for uid in review_request.reviewer_ids
            if not _can_access(found_by_id[uid], doc.project_id, "read", db)
        ]
        if no_access:
            raise HTTPException(
                status_code=400,
                detail=f"Reviewer(s) do not have access to this document: {no_access}",
            )

        # Move into review and persist before notifying.
        doc.status = models.DocStatus.IN_REVIEW
        doc.updated_by = current_user.id
        db.commit()
        db.refresh(doc)

        actor_name = notification_engine.actor_display_name(current_user)
        label = doc.title or f"#{doc.id}"
        note = review_request.note
        note_clause = f' Note: "{note}".' if note else ""
        batch = notification_engine.NotificationBatch()
        batch.add(
            category=notification_engine.REVIEW,
            user_ids=review_request.reviewer_ids,
            actor_id=current_user.id,
            title="Review requested",
            message=f'{actor_name} requested your review of "{label}".{note_clause}',
            related_entity_type="doc",
            related_entity_id=doc.id,
        )
        # Tell watchers the doc entered review; a reviewer who also watches is folded
        # onto their higher-priority REVIEW row by the batch ladder (REVIEW outranks
        # watch_change), so they never get two notifications for the one transition.
        watch_service.notify_watchers_of_change(
            db,
            entity_type=watch_service.DOC,
            entity_id=doc.id,
            label=label,
            action="review_requested",
            actor_id=current_user.id,
            batch=batch,
        )
        rows = batch.flush(db)
        notified_ids = [r.user_id for r in rows if r.category == notification_engine.REVIEW.key]
        return schemas.DocReviewRequestResult(
            message=f"Requested review from {len(notified_ids)} reviewer(s)",
            doc_id=doc.id,
            status=doc.status,
            notified_count=len(notified_ids),
            reviewer_ids=notified_ids,
        )

    @app.delete("/docs/{doc_id}", status_code=204, tags=["Docs"])
    def delete_doc(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "delete", db)
        crud_docs.delete_doc(db, doc)
        return Response(status_code=204)

    @app.get("/docs/{doc_id}/markdown", tags=["Docs"])
    def get_doc_markdown(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Clean canonical Markdown + metadata for AI/export consumers."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        return {
            "id": doc.id,
            "title": doc.title,
            "slug": doc.slug,
            "classification": doc.classification,
            "status": getattr(doc.status, "value", doc.status),
            "tags": doc.tags,
            "markdown": doc.content_markdown or "",
        }

    @app.get("/docs/{doc_id}/export", tags=["Docs"])
    def export_doc(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        body = _build_markdown_export(doc)
        return Response(
            content=body,
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{_safe_filename(doc.title)}"'},
        )

    # ── Watch / change subscriptions ────────────────────────────────────────
    @app.get("/docs/{doc_id}/watch", response_model=schemas.WatchStatus, tags=["Docs"])
    def get_doc_watch(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        return schemas.WatchStatus(
            watching=watch_service.is_watching(db, current_user.id, watch_service.DOC, doc.id),
            watcher_count=watch_service.count_watchers(db, watch_service.DOC, doc.id),
        )

    @app.post("/docs/{doc_id}/watch", response_model=schemas.WatchStatus, tags=["Docs"])
    def watch_doc(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        watch_service.add_watch(db, current_user.id, watch_service.DOC, doc.id)
        return schemas.WatchStatus(
            watching=True,
            watcher_count=watch_service.count_watchers(db, watch_service.DOC, doc.id),
        )

    @app.delete("/docs/{doc_id}/watch", response_model=schemas.WatchStatus, tags=["Docs"])
    def unwatch_doc(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        watch_service.remove_watch(db, current_user.id, watch_service.DOC, doc.id)
        return schemas.WatchStatus(
            watching=False,
            watcher_count=watch_service.count_watchers(db, watch_service.DOC, doc.id),
        )

    # ── Version history ─────────────────────────────────────────────────────
    @app.get("/docs/{doc_id}/versions", response_model=List[schemas.DocVersionView], tags=["Docs"])
    def list_doc_versions(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        versions = (
            db.query(models.DocVersion)
            .options(joinedload(models.DocVersion.author))
            .filter(models.DocVersion.doc_id == doc_id)
            .order_by(models.DocVersion.version_number.desc())
            .all()
        )
        return [
            schemas.DocVersionView(
                id=v.id, doc_id=v.doc_id, version_number=v.version_number, action=v.action,
                title=v.title, content_markdown=v.content_markdown, status=v.status,
                classification=v.classification, tags=v.tags, change_note=v.change_note,
                created_at=v.created_at, author=_author(v.author),
            )
            for v in versions
        ]

    @app.post("/docs/{doc_id}/versions/{version_id}/restore", response_model=schemas.Doc, tags=["Docs"])
    def restore_doc_version(
        payload: schemas.DocVersionRestore,
        doc_id: int = Path(..., ge=1),
        version_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        version = (
            db.query(models.DocVersion)
            .filter(models.DocVersion.id == version_id, models.DocVersion.doc_id == doc_id)
            .first()
        )
        if version is None:
            raise HTTPException(status_code=404, detail="Version not found")
        doc = crud_docs.restore_doc_version(
            db, doc, version, actor_id=current_user.id, change_note=payload.change_note
        )
        return _doc_out(doc, current_user, db)

    @app.delete("/docs/{doc_id}/versions", response_model=schemas.Doc, tags=["Docs"])
    def clear_doc_versions(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Remove the doc's entire revision history, keeping the current content
        as a fresh baseline. Destructive, so gated on the delete permission."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "delete", db)
        crud_docs.clear_doc_versions(db, doc, actor_id=current_user.id)
        return _doc_out(doc, current_user, db)

    # ── Sharing ─────────────────────────────────────────────────────────────
    @app.get("/docs/{doc_id}/share", response_model=schemas.DocShareInfo, tags=["Docs"])
    def get_doc_share(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        return _share_info(doc, db)

    @app.put("/docs/{doc_id}/share", response_model=schemas.DocShareInfo, tags=["Docs"])
    def update_doc_share(
        payload: schemas.DocShareUpdate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        # Changing how a doc is shared is an edit-level action.
        _require(current_user, doc.project_id, "write", db)
        # Restricted sharing is meaningless on a global doc: every authenticated
        # user already has read access to global docs, so grants can't narrow it.
        if payload.share_scope == "restricted" and doc.project_id is None:
            raise HTTPException(
                status_code=400,
                detail="Restricted sharing applies to project documents only",
            )
        if payload.share_expires_at is not None and _as_aware(payload.share_expires_at) <= _utcnow():
            raise HTTPException(status_code=400, detail="Share expiry must be in the future")
        previous_scope = doc.share_scope or "private"
        doc.share_scope = payload.share_scope
        if payload.share_scope == "public":
            if not doc.public_id:
                doc.public_id = uuid.uuid4().hex
            doc.share_expires_at = payload.share_expires_at
        else:
            # Per-grant expiry governs restricted access; the doc-level expiry is
            # a public-link concept only.
            doc.share_expires_at = None
        crud.safe_commit(db)
        db.refresh(doc)
        if previous_scope != doc.share_scope:
            crud_docs.record_share_audit(
                db, doc.id, current_user.id, "scope_changed",
                f"Sharing changed from {previous_scope} to {doc.share_scope}",
            )
        return _share_info(doc, db)

    # ── Granular share grants (user / role / project group) ─────────────────
    @app.post("/docs/{doc_id}/share/grants", response_model=schemas.DocShareInfo, tags=["Docs"])
    def add_doc_share_grant(
        payload: schemas.DocShareGrantCreate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        # Grants only mean something for project docs (global docs are readable by
        # every authenticated user, so a grant can't restrict or extend access).
        if doc.project_id is None:
            raise HTTPException(
                status_code=400,
                detail="Granular sharing applies to project documents only",
            )
        if payload.expires_at is not None and _as_aware(payload.expires_at) <= _utcnow():
            raise HTTPException(status_code=400, detail="Grant expiry must be in the future")
        if payload.grant_type == "user":
            if db.query(models.User.id).filter(models.User.id == payload.subject_user_id).first() is None:
                raise HTTPException(status_code=404, detail="User not found")
        elif payload.grant_type == "project":
            if db.query(models.Project.id).filter(models.Project.id == payload.subject_project_id).first() is None:
                raise HTTPException(status_code=404, detail="Project not found")
        try:
            grant = crud_docs.add_share_grant(db, doc, payload, current_user.id)
        except IntegrityError:
            raise HTTPException(status_code=409, detail="That grant already exists")
        # Adding a grant to a private doc has no effect until it's restricted, so
        # auto-promote private → restricted for predictable behaviour.
        if (doc.share_scope or "private") == "private":
            doc.share_scope = "restricted"
            crud.safe_commit(db)
            db.refresh(doc)
            crud_docs.record_share_audit(
                db, doc.id, current_user.id, "scope_changed",
                "Sharing changed from private to restricted",
            )
        crud_docs.record_share_audit(
            db, doc.id, current_user.id, "grant_added",
            f"Granted access to {_grant_audit_text(grant)}",
        )
        return _share_info(doc, db)

    @app.delete("/docs/{doc_id}/share/grants/{grant_id}", response_model=schemas.DocShareInfo, tags=["Docs"])
    def remove_doc_share_grant(
        doc_id: int = Path(..., ge=1),
        grant_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        grant = crud_docs.get_share_grant(db, doc.id, grant_id)
        if grant is None:
            raise HTTPException(status_code=404, detail="Share grant not found")
        audit_text = _grant_audit_text(grant)
        crud_docs.delete_share_grant(db, grant)
        crud_docs.record_share_audit(
            db, doc.id, current_user.id, "grant_removed",
            f"Revoked access from {audit_text}",
        )
        db.refresh(doc)
        return _share_info(doc, db)

    @app.get("/docs/{doc_id}/share/audit", response_model=List[schemas.DocShareAuditView], tags=["Docs"])
    def get_doc_share_audit(
        doc_id: int = Path(..., ge=1),
        limit: int = Query(100, ge=1, le=500),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        rows = crud_docs.list_share_audit(db, doc.id, limit)
        return [
            schemas.DocShareAuditView(
                id=row.id,
                action=row.action,
                detail=row.detail,
                actor_id=row.actor_id,
                actor_name=(row.actor.full_name or row.actor.username) if row.actor else None,
                created_at=row.created_at,
            )
            for row in rows
        ]

    @app.get("/docs/{doc_id}/stats", response_model=schemas.DocStats, tags=["Docs"])
    def get_doc_stats(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Only admins can view document statistics")
        unique_visitors = db.query(func.count(models.DocVisit.id)).filter(models.DocVisit.doc_id == doc.id).scalar() or 0
        latest = (
            db.query(models.DocVisit, models.User)
            .join(models.User, models.User.id == models.DocVisit.user_id)
            .filter(models.DocVisit.doc_id == doc.id)
            .order_by(models.DocVisit.last_visited_at.desc())
            .limit(10)
            .all()
        )
        return schemas.DocStats(
            doc_id=doc.id,
            view_count=doc.view_count or 0,
            unique_visitors=unique_visitors,
            last_viewed_at=doc.last_viewed_at,
            latest_visits=[
                {
                    "user_id": user.id,
                    "name": user.full_name or user.username or user.email,
                    "visit_count": visit.visit_count,
                    "last_visited_at": visit.last_visited_at,
                }
                for visit, user in latest
            ],
        )

    @app.get("/docs/{doc_id}/feedback", response_model=schemas.DocFeedbackSummary, tags=["Docs"])
    def get_doc_feedback_summary(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        return _feedback_summary(db, doc.id, current_user.id)

    @app.get("/docs/{doc_id}/feedback/items", response_model=List[schemas.DocFeedbackView], tags=["Docs"])
    def list_doc_feedback(
        doc_id: int = Path(..., ge=1),
        include_resolved: bool = Query(False),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        query = (
            db.query(models.DocFeedback)
            .options(joinedload(models.DocFeedback.user))
            .filter(models.DocFeedback.doc_id == doc.id)
            .filter(models.DocFeedback.feedback_type.in_(["not_helpful", "clarification", "outdated"]))
        )
        if not include_resolved:
            query = query.filter(models.DocFeedback.resolved.is_(False))
        items = query.order_by(models.DocFeedback.updated_at.desc().nullslast(), models.DocFeedback.created_at.desc()).all()
        return [_feedback_view(item) for item in items]

    @app.put("/docs/{doc_id}/feedback", response_model=schemas.DocFeedbackSummary, tags=["Docs"])
    def submit_doc_feedback(
        payload: schemas.DocFeedbackCreate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        feedback = (
            db.query(models.DocFeedback)
            .filter(models.DocFeedback.doc_id == doc.id, models.DocFeedback.user_id == current_user.id)
            .first()
        )
        should_notify = payload.feedback_type != "helpful"
        if feedback is None:
            feedback = models.DocFeedback(
                doc_id=doc.id,
                user_id=current_user.id,
            )
            _apply_feedback_payload(feedback, payload)
            db.add(feedback)
        else:
            should_notify = should_notify and (
                feedback.feedback_type != payload.feedback_type
                or (feedback.comment or "") != (payload.comment or "")
                or (feedback.section_text or "") != (payload.section_text or "")
                or bool(feedback.resolved)
            )
            _apply_feedback_payload(feedback, payload)
        try:
            crud.safe_commit(db)
            db.refresh(feedback)
        except IntegrityError as exc:
            db.rollback()
            feedback = (
                db.query(models.DocFeedback)
                .filter(models.DocFeedback.doc_id == doc.id, models.DocFeedback.user_id == current_user.id)
                .first()
            )
            if feedback is None:
                logger.exception("Could not resolve duplicate doc feedback for doc %s/user %s", doc.id, current_user.id)
                raise HTTPException(status_code=500, detail="Could not save document feedback") from exc
            should_notify = should_notify and (
                feedback.feedback_type != payload.feedback_type
                or (feedback.comment or "") != (payload.comment or "")
                or (feedback.section_text or "") != (payload.section_text or "")
                or bool(feedback.resolved)
            )
            _apply_feedback_payload(feedback, payload)
            try:
                crud.safe_commit(db)
                db.refresh(feedback)
            except Exception as retry_exc:
                db.rollback()
                logger.exception("Could not save duplicate doc feedback for doc %s/user %s", doc.id, current_user.id)
                raise HTTPException(status_code=500, detail="Could not save document feedback") from retry_exc
        except Exception as exc:
            db.rollback()
            logger.exception("Could not save doc feedback for doc %s/user %s", doc.id, current_user.id)
            raise HTTPException(status_code=500, detail="Could not save document feedback") from exc
        if should_notify:
            _notify_doc_feedback(db, doc, current_user, feedback.feedback_type, feedback.comment)
        return _feedback_summary(db, doc.id, current_user.id)

    @app.delete("/docs/{doc_id}/feedback", response_model=schemas.DocFeedbackSummary, tags=["Docs"])
    def delete_my_doc_feedback(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        feedback = (
            db.query(models.DocFeedback)
            .filter(models.DocFeedback.doc_id == doc.id, models.DocFeedback.user_id == current_user.id)
            .first()
        )
        if feedback is not None:
            try:
                db.delete(feedback)
                crud.safe_commit(db)
            except Exception as exc:
                db.rollback()
                logger.exception("Could not delete doc feedback for doc %s/user %s", doc.id, current_user.id)
                raise HTTPException(status_code=500, detail="Could not delete document feedback") from exc
        return _feedback_summary(db, doc.id, current_user.id)

    @app.put("/docs/{doc_id}/feedback/{feedback_id}", response_model=schemas.DocFeedbackView, tags=["Docs"])
    def resolve_doc_feedback(
        payload: schemas.DocFeedbackResolve,
        doc_id: int = Path(..., ge=1),
        feedback_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        feedback = (
            db.query(models.DocFeedback)
            .options(joinedload(models.DocFeedback.user))
            .filter(models.DocFeedback.id == feedback_id, models.DocFeedback.doc_id == doc.id)
            .first()
        )
        if feedback is None:
            raise HTTPException(status_code=404, detail="Document feedback not found")
        if feedback.feedback_type == "helpful":
            raise HTTPException(status_code=400, detail="Helpful votes do not require resolution")
        feedback.resolved = payload.resolved
        try:
            crud.safe_commit(db)
            db.refresh(feedback)
        except Exception as exc:
            db.rollback()
            logger.exception("Could not update doc feedback %s", feedback.id)
            raise HTTPException(status_code=500, detail="Could not update document feedback") from exc
        return _feedback_view(feedback)

    @app.get("/docs/{doc_id}/related", response_model=List[schemas.DocRelatedLinkView], tags=["Docs"])
    def list_related_docs(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        links = (
            db.query(models.DocRelatedLink)
            .options(joinedload(models.DocRelatedLink.related_doc))
            .filter(models.DocRelatedLink.doc_id == doc.id)
            .order_by(models.DocRelatedLink.created_at.desc())
            .all()
        )
        result = []
        for link in links:
            related = link.related_doc
            if related is None or not _can_access(current_user, related.project_id, "read", db):
                continue
            result.append(schemas.DocRelatedLinkView(
                id=link.id,
                doc_id=link.doc_id,
                related_doc_id=link.related_doc_id,
                related_doc_title=related.title,
                related_doc_project_id=related.project_id,
                created_at=link.created_at,
            ))
        return result

    @app.get("/docs/{doc_id}/suggestions", response_model=List[schemas.DocSuggestion], tags=["Docs"])
    def list_doc_suggestions(
        doc_id: int = Path(..., ge=1),
        limit: int = Query(6, ge=1, le=20),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Smart suggestions: docs similar to this one (tag/title/body overlap),
        excluding the doc itself and ones already manually related."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        related_ids = [
            rid for (rid,) in db.query(models.DocRelatedLink.related_doc_id)
            .filter(models.DocRelatedLink.doc_id == doc.id).all()
        ]
        scored = crud_docs.suggest_docs(db, doc, exclude_ids=related_ids, limit=limit)
        return [
            schemas.DocSuggestion(
                id=r.id, uuid=r.uuid, title=r.title, slug=r.slug, space_id=r.space_id,
                project_id=r.project_id, classification=r.classification, status=r.status,
                tags=r.tags, excerpt=_excerpt(r.content), current_version=r.current_version or 0,
                score=round(float(score), 4), matched_tags=matched,
            )
            for score, r, matched in scored
        ]

    @app.get("/docs/{doc_id}/duplicates", response_model=List[schemas.DocDuplicateCandidate], tags=["Docs"])
    def list_doc_duplicates(
        doc_id: int = Path(..., ge=1),
        limit: int = Query(5, ge=1, le=10),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Likely duplicate docs: stricter same-topic matches with different
        titles, excluding already-related docs."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        scored = crud_docs.find_duplicate_docs(db, doc, limit=limit)
        return [
            schemas.DocDuplicateCandidate(
                id=r.id, uuid=r.uuid, title=r.title, slug=r.slug, space_id=r.space_id,
                project_id=r.project_id, classification=r.classification, status=r.status,
                tags=r.tags, excerpt=_excerpt(r.content), current_version=r.current_version or 0,
                score=round(float(score), 4), matched_tags=matched, reasons=reasons,
            )
            for score, r, matched, reasons in scored
            if _can_access(current_user, r.project_id, "read", db)
        ]

    @app.post("/docs/{doc_id}/merge", response_model=schemas.DocMergeResult, tags=["Docs"])
    def merge_duplicate_doc(
        payload: schemas.DocMergeRequest,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        target = _get_doc_or_404(db, doc_id)
        source = _get_doc_or_404(db, payload.source_doc_id)
        _require(current_user, target.project_id, "write", db)
        _require(current_user, source.project_id, "write", db)
        if target.id == source.id:
            raise HTTPException(status_code=400, detail="A document cannot be merged into itself")
        try:
            result = crud_docs.merge_duplicate_doc(
                db, target=target, source=source, actor_id=current_user.id, note=payload.note,
            )
        except IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Could not merge because a preserved reference already exists") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Could not merge duplicate doc %s into %s", source.id, target.id)
            raise HTTPException(status_code=500, detail="Could not merge duplicate document") from exc
        return schemas.DocMergeResult(
            target_doc=_doc_out(result["target"], current_user, db),
            archived_source_doc=_doc_out(result["source"], current_user, db),
            transferred=result["transferred"],
            preserved_reference_count=result["preserved_reference_count"],
        )

    @app.post("/docs/{doc_id}/related", response_model=schemas.DocRelatedLinkView, status_code=201, tags=["Docs"])
    def add_related_doc(
        payload: schemas.DocRelatedLinkCreate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        related = _get_doc_or_404(db, payload.related_doc_id)
        _require(current_user, doc.project_id, "write", db)
        _require(current_user, related.project_id, "read", db)
        if doc.id == related.id:
            raise HTTPException(status_code=400, detail="A document cannot be related to itself")
        link = models.DocRelatedLink(doc_id=doc.id, related_doc_id=related.id, created_by=current_user.id)
        db.add(link)
        try:
            crud.safe_commit(db)
            db.refresh(link)
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="Related document already exists")
        return schemas.DocRelatedLinkView(
            id=link.id,
            doc_id=link.doc_id,
            related_doc_id=related.id,
            related_doc_title=related.title,
            related_doc_project_id=related.project_id,
            created_at=link.created_at,
        )

    @app.delete("/docs/{doc_id}/related/{related_doc_id}", status_code=204, tags=["Docs"])
    def delete_related_doc(
        doc_id: int = Path(..., ge=1),
        related_doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        link = (
            db.query(models.DocRelatedLink)
            .filter(models.DocRelatedLink.doc_id == doc.id, models.DocRelatedLink.related_doc_id == related_doc_id)
            .first()
        )
        if link is None:
            raise HTTPException(status_code=404, detail="Related document not found")
        db.delete(link)
        crud.safe_commit(db)
        return Response(status_code=204)

    # ── Requirement links ───────────────────────────────────────────────────
    @app.get("/docs/{doc_id}/requirement-links", response_model=List[schemas.DocRequirementLinkView], tags=["Docs"])
    def list_doc_requirement_links(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        links = (
            db.query(models.DocRequirementLink)
            .options(joinedload(models.DocRequirementLink.requirement))
            .filter(models.DocRequirementLink.doc_id == doc_id)
            .order_by(models.DocRequirementLink.id.desc())
            .all()
        )
        return [
            schemas.DocRequirementLinkView(
                id=l.id, doc_id=l.doc_id, requirement_id=l.requirement_id,
                requirement_key=(l.requirement.requirement_id if l.requirement else None),
                requirement_title=(l.requirement.title if l.requirement else None),
                created_at=l.created_at,
            )
            for l in links
        ]

    @app.post("/docs/{doc_id}/requirement-links", response_model=schemas.DocRequirementLinkView,
              status_code=201, tags=["Docs"])
    def create_doc_requirement_link(
        payload: schemas.DocRequirementLinkCreate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Manually link an existing project requirement to this document.

        Idempotent: re-linking an already-linked requirement returns the existing
        link rather than erroring."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        if doc.project_id is None:
            raise HTTPException(status_code=400, detail="Global documents cannot be linked to requirements")
        requirement = (
            db.query(models.Requirement)
            .filter(models.Requirement.id == payload.requirement_id)
            .first()
        )
        if requirement is None:
            raise HTTPException(status_code=404, detail="Requirement not found")
        if requirement.project_id != doc.project_id:
            raise HTTPException(status_code=400, detail="Requirement belongs to a different project")
        link = (
            db.query(models.DocRequirementLink)
            .filter(
                models.DocRequirementLink.doc_id == doc.id,
                models.DocRequirementLink.requirement_id == requirement.id,
            )
            .first()
        )
        if link is None:
            link = models.DocRequirementLink(
                doc_id=doc.id, requirement_id=requirement.id, created_by=current_user.id,
            )
            db.add(link)
            crud.safe_commit(db)
            db.refresh(link)
        return schemas.DocRequirementLinkView(
            id=link.id, doc_id=link.doc_id, requirement_id=link.requirement_id,
            requirement_key=requirement.requirement_id, requirement_title=requirement.title,
            created_at=link.created_at,
        )

    @app.delete("/docs/{doc_id}/requirement-links/{requirement_id}", status_code=204, tags=["Docs"])
    def delete_doc_requirement_link(
        doc_id: int = Path(..., ge=1),
        requirement_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        link = (
            db.query(models.DocRequirementLink)
            .filter(
                models.DocRequirementLink.doc_id == doc.id,
                models.DocRequirementLink.requirement_id == requirement_id,
            )
            .first()
        )
        if link is None:
            raise HTTPException(status_code=404, detail="Requirement link not found")
        db.delete(link)
        crud.safe_commit(db)
        return Response(status_code=204)

    # ── Converter: doc → requirements ───────────────────────────────────────
    @app.post("/docs/{doc_id}/convert-to-requirements/preview", response_model=schemas.DocConvertPreview, tags=["Docs"])
    def preview_convert(
        payload: schemas.DocConvertRequest,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        _require_feature_enabled(db, doc.project_id, "doc_hub")
        _require_feature_enabled(db, doc.project_id, "requirements")
        plan = conv.build_plan(doc, payload.mode, payload.heading_level)
        return schemas.DocConvertPreview(
            mode=plan.mode,
            items=[
                schemas.DocConvertPreviewItem(
                    index=s.index, title=s.title,
                    description_html=s.description_html,
                    is_acceptance_criteria=s.is_acceptance_criteria,
                    acceptance_html=s.acceptance_html,
                )
                for s in plan.sections
            ],
        )

    @app.post("/docs/{doc_id}/convert-to-requirements", response_model=schemas.DocConvertResult, tags=["Docs"])
    def convert_to_requirements(
        payload: schemas.DocConvertRequest,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        _require_feature_enabled(db, doc.project_id, "doc_hub")

        target_project_id = doc.project_id or payload.target_project_id
        if target_project_id is None:
            raise HTTPException(
                status_code=400,
                detail="target_project_id is required when converting a global doc",
            )
        _require(current_user, target_project_id, "write", db)
        _require_feature_enabled(db, target_project_id, "requirements")
        if doc.project_id is None and crud.get_project(db, target_project_id) is None:
            raise HTTPException(status_code=404, detail="Target project not found")

        if payload.folder_id is not None:
            folder = crud.get_requirement_folder(db, payload.folder_id)
            if folder is None or folder.project_id != target_project_id:
                raise HTTPException(status_code=400, detail="Folder not found in target project")

        plan = conv.build_plan(doc, payload.mode, payload.heading_level)

        # Apply per-item overrides / inclusion from the preview, keyed by index.
        overrides = {it.index: it for it in (payload.items or [])}

        created: List[models.Requirement] = []
        links: List[models.DocRequirementLink] = []

        try:
            if payload.mode == "single":
                ac_section = next((s for s in plan.sections if s.is_acceptance_criteria), None)
                main = next((s for s in plan.sections if not s.is_acceptance_criteria), plan.sections[0])
                ov = overrides.get(main.index)
                if ov is not None and not ov.include:
                    raise HTTPException(status_code=400, detail="At least one requirement must be selected")
                title = _conversion_title((ov.title if ov else None) or main.title)
                description_html = ov.description_html if (ov and ov.description_html is not None) else main.description_html
                acceptance_html = (
                    ov.acceptance_html if (ov and ov.acceptance_html is not None)
                    else (ac_section.description_html if ac_section else None)
                )
                req = _create_requirement(
                    db, doc, target_project_id, title, description_html,
                    acceptance_html=acceptance_html,
                    payload=payload, actor_id=current_user.id,
                )
                created.append(req)
                links.append(_link_doc_requirement(db, doc, req, current_user.id))
            else:
                for s in plan.sections:
                    ov = overrides.get(s.index)
                    if ov is not None and not ov.include:
                        continue
                    title = _conversion_title((ov.title if ov else None) or s.title)
                    description_html = ov.description_html if (ov and ov.description_html is not None) else s.description_html
                    acceptance_html = (
                        ov.acceptance_html if (ov and ov.acceptance_html is not None)
                        else (s.acceptance_html or None)
                    )
                    req = _create_requirement(
                        db, doc, target_project_id, title, description_html,
                        acceptance_html=acceptance_html, payload=payload, actor_id=current_user.id,
                    )
                    created.append(req)
                    links.append(_link_doc_requirement(db, doc, req, current_user.id))

            # Brand-new requirements accepted from the AI gap analysis, created in
            # addition to the doc-derived sections and linked back to the doc.
            for extra in (payload.extra_items or []):
                title = _conversion_title(extra.title)
                req = _create_requirement(
                    db, doc, target_project_id, title, extra.description_html or "",
                    acceptance_html=extra.acceptance_html, payload=payload, actor_id=current_user.id,
                )
                created.append(req)
                links.append(_link_doc_requirement(db, doc, req, current_user.id))

            if not created:
                raise HTTPException(status_code=400, detail="At least one requirement must be selected")
            crud.safe_commit(db)
        except HTTPException:
            db.rollback()
            raise
        except IntegrityError as exc:
            db.rollback()
            logger.warning("Doc conversion failed due to an integrity error: %s", exc)
            raise HTTPException(status_code=409, detail="Could not convert document because generated requirements conflict with existing data")
        except Exception as exc:
            db.rollback()
            logger.exception("Unexpected doc conversion failure: %s", exc)
            raise HTTPException(status_code=500, detail="Could not convert document to requirements")

        link_views = [
            schemas.DocRequirementLinkView(
                id=l.id, doc_id=l.doc_id, requirement_id=l.requirement_id,
                requirement_key=created[i].requirement_id, requirement_title=created[i].title,
                created_at=l.created_at,
            )
            for i, l in enumerate(links)
        ]
        return schemas.DocConvertResult(created=created, links=link_views)

    @app.post("/docs/{doc_id}/convert-to-requirements/enhance", response_model=schemas.DocConvertEnhanceResult, tags=["Docs"])
    async def enhance_convert(
        payload: schemas.DocConvertEnhanceRequest,
        request: Request,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """AI review of the mechanically-extracted draft requirements.

        Scores each draft, names quality issues and missed edge cases, returns
        refined title/description/acceptance criteria, and proposes additional
        requirements for capabilities the document overlooks. The deterministic
        preview is unaffected; this is the optional, best-effort AI layer that
        degrades gracefully when AI is off/unavailable."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        _require_feature_enabled(db, doc.project_id, "doc_hub")
        _require_feature_enabled(db, doc.project_id, "requirements")

        plan = conv.build_plan(doc, payload.mode, payload.heading_level)
        result = schemas.DocConvertEnhanceResult()
        submitted_items = {it.index: it for it in (payload.items or [])}

        # Draft rows (plain text) the model reviews — one per non-AC section.
        ac_section = next((x for x in plan.sections if x.is_acceptance_criteria), None)
        items_payload = []
        for s in plan.sections:
            if s.is_acceptance_criteria:
                continue
            ov = submitted_items.get(s.index)
            if ov is not None and not ov.include:
                continue
            # Split sections carry their own AC; in single mode it's a sibling.
            acceptance_html = (
                ov.acceptance_html if (ov and ov.acceptance_html is not None)
                else (s.acceptance_html or (ac_section.description_html if ac_section else ""))
            )
            items_payload.append({
                "index": s.index,
                "title": (ov.title if ov else s.title),
                "description": strip_html(
                    ov.description_html if (ov and ov.description_html is not None) else s.description_html
                ),
                "acceptance": strip_html(acceptance_html),
            })

        # The plan always yields at least one (title-bearing) section, so this only
        # trips defensively; titles are required, so there is always something to review.
        if not items_payload:
            result.ai_skipped_reason = "nothing_to_enhance"
            return result

        project = crud.get_project(db, doc.project_id) if doc.project_id is not None else None
        if project is not None and not is_feature_enabled(project, "ask_ai"):
            result.ai_skipped_reason = "ask_ai_disabled"
            return result
        status = get_ai_manager_status(db)
        if not status.get("available"):
            result.ai_skipped_reason = "ai_unavailable"
            return result

        # Record the configured provider/model up front so that even a failed
        # call (ai_error/rate_limited) clearly shows AI *is* configured, rather
        # than a misleading null that looks like no provider was set. On success
        # these are overwritten with the provider actually used (fallback-aware).
        provider_info = status.get("provider") or {}
        result.provider = provider_info.get("provider")
        result.model = provider_info.get("model")

        result.ai_available = True
        try:
            # Cancel the (paid) AI call if the client disconnects (dialog closed).
            completion = await _cancel_on_disconnect(
                request,
                generate_ai_completion(
                    db,
                    AICompletionRequest(
                        prompt=build_doc_convert_enhance_prompt(doc.title, payload.mode, items_payload),
                        max_tokens=2600, temperature=0.2, timeout_seconds=120,
                    ),
                    operation="doc_convert_enhance",
                    project_id=doc.project_id, user_id=current_user.id,
                    entity_type="doc", entity_id=doc.id,
                ),
            )
            summary, enhance_items, suggested = _parse_convert_enhance(completion.content)
            result.summary = summary
            result.items = enhance_items
            result.suggested_requirements = suggested
            result.provider = completion.provider
            result.model = completion.model
        except HTTPException as exc:
            logger.warning("Doc convert AI enhancement failed for doc %s: %s", doc.id, exc.detail)
            result.ai_available = False
            result.ai_skipped_reason = _ai_skip_reason(exc)
        except Exception as exc:  # parsing or unexpected provider error
            logger.warning("Doc convert AI enhancement errored for doc %s: %s", doc.id, exc)
            result.ai_available = False
            result.ai_skipped_reason = "ai_error"

        return result

    # ── Change impact analysis ──────────────────────────────────────────────
    @app.post("/docs/{doc_id}/impact-analysis", response_model=schemas.DocImpactAnalysis, tags=["Docs"],
              dependencies=[Depends(require_project_feature("doc_hub"))])
    async def analyze_doc_impact(
        payload: schemas.DocImpactRequest,
        request: Request,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Show the requirements, test cases, and defects a doc change impacts,
        plus an AI risk assessment — so authors can review before publishing.

        The deterministic impact graph is always returned; the AI risk block is
        best-effort and degrades gracefully when AI is off/unavailable."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)

        # The ``require_project_feature`` dependency can't resolve a project from
        # this route (no project_id in the path/body), so enforce the Doc Hub
        # toggle explicitly for project docs. Global docs have no project toggle.
        project = crud.get_project(db, doc.project_id) if doc.project_id is not None else None
        if project is not None and not is_feature_enabled(project, "doc_hub"):
            raise HTTPException(status_code=403, detail="The 'doc_hub' feature is disabled for this project")

        graph = doc_impact_service.analyze_doc_impact(
            db, doc, candidate_markdown=payload.candidate_markdown,
        )
        result = schemas.DocImpactAnalysis(
            doc_id=doc.id,
            project_id=doc.project_id,
            change_summary=schemas.DocImpactChangeSummary(
                changed=graph.change_summary.changed,
                headings_added=graph.change_summary.headings_added,
                headings_removed=graph.change_summary.headings_removed,
                char_delta=graph.change_summary.char_delta,
                note=graph.change_summary.note,
            ),
            requirements=[_impact_item(i) for i in graph.requirements],
            test_cases=[_impact_item(i) for i in graph.test_cases],
            defects=[_impact_item(i) for i in graph.defects],
            risk_signals=schemas.DocImpactRiskSignals(
                impacted_requirements=graph.risk_signals.impacted_requirements,
                impacted_test_cases=graph.risk_signals.impacted_test_cases,
                impacted_defects=graph.risk_signals.impacted_defects,
                open_defects=graph.risk_signals.open_defects,
                high_severity_defects=graph.risk_signals.high_severity_defects,
                uncovered_requirements=graph.risk_signals.uncovered_requirements,
            ),
        )

        # The deterministic graph above always runs. The (paid) AI risk
        # assessment only fires when there is something worth spending tokens on:
        # an actual change to assess, a project with artifacts, the project's
        # ask_ai feature on, a configured provider, and at least one impacted
        # item. When the editor re-analyzes an unchanged draft, ``candidate_markdown``
        # equals the stored content (``changed`` is False) — so no AI request is sent.
        total_items = len(graph.requirements) + len(graph.test_cases) + len(graph.defects)
        if not payload.include_ai:
            result.ai_skipped_reason = "disabled_by_request"
        elif doc.project_id is None:
            result.ai_skipped_reason = "global_doc"
        elif payload.candidate_markdown is not None and not graph.change_summary.changed:
            result.ai_skipped_reason = "no_changes"
        elif total_items == 0:
            result.ai_skipped_reason = "no_impacted_items"
        else:
            if project is not None and not is_feature_enabled(project, "ask_ai"):
                result.ai_skipped_reason = "ask_ai_disabled"
            elif not get_ai_manager_status(db).get("available"):
                result.ai_skipped_reason = "ai_unavailable"
            else:
                result.ai_available = True
                impacted_items = [
                    {"type": i.type, "key": i.key, "title": i.title, "reason": i.reason,
                     "severity": i.severity, "status": i.status,
                     "via": ", ".join(i.via) if i.via else ""}
                    for i in (graph.requirements + graph.test_cases + graph.defects)
                ]
                change_summary = {
                    "changed": graph.change_summary.changed,
                    "note": graph.change_summary.note,
                    "headings_added": graph.change_summary.headings_added,
                    "headings_removed": graph.change_summary.headings_removed,
                    "char_delta": graph.change_summary.char_delta,
                }
                try:
                    # Cancel the (paid) AI call if the client disconnects — e.g.
                    # the user closes the dialog — so it doesn't keep running.
                    completion = await _cancel_on_disconnect(
                        request,
                        generate_ai_completion(
                            db,
                            AICompletionRequest(
                                prompt=build_doc_impact_prompt(doc.title, change_summary, impacted_items),
                                max_tokens=1200, temperature=0.2, timeout_seconds=120,
                            ),
                            operation="doc_change_impact",
                            project_id=doc.project_id, user_id=current_user.id,
                            entity_type="doc", entity_id=doc.id,
                        ),
                    )
                    summary, recommendation, risks = _parse_impact_ai(completion.content)
                    result.ai_summary = summary
                    result.recommendation = recommendation
                    result.risks = risks
                    result.provider = completion.provider
                    result.model = completion.model
                except HTTPException as exc:
                    logger.warning("Doc impact AI assessment failed for doc %s: %s", doc.id, exc.detail)
                    result.ai_available = False
                    result.ai_skipped_reason = _ai_skip_reason(exc)
                except Exception as exc:  # parsing or unexpected provider error
                    logger.warning("Doc impact AI assessment errored for doc %s: %s", doc.id, exc)
                    result.ai_available = False
                    result.ai_skipped_reason = "ai_error"

        _audit_doc_impact(db, current_user, doc)
        return result

    # --- internal helpers bound to the request scope -----------------------

    def _conversion_title(title: str) -> str:
        cleaned = (title or "").strip()
        if not cleaned:
            raise HTTPException(status_code=400, detail="Requirement title cannot be empty")
        return cleaned[:255]

    def _create_requirement(db, doc, project_id, title, description_html,
                            acceptance_html, payload, actor_id) -> models.Requirement:
        req_create = schemas.RequirementCreate(
            title=title,
            description=description_html,
            acceptance_criteria=_feature_acceptance_html(title, acceptance_html, description_html),
            requirement_id=conv.next_requirement_id(db, project_id),
            status=payload.default_status,
            priority=payload.default_priority,
            folder_id=payload.folder_id,
            tags=doc.tags,
            project_id=project_id,
            created_by=actor_id,
        )
        requirement = models.Requirement(
            title=req_create.title,
            description=req_create.description,
            acceptance_criteria=req_create.acceptance_criteria,
            requirement_id=req_create.requirement_id,
            status=models.RequirementStatus(req_create.status),
            priority=models.Priority(req_create.priority),
            folder_id=req_create.folder_id,
            tags=req_create.tags,
            project_id=req_create.project_id,
            created_by=req_create.created_by,
        )
        db.add(requirement)
        db.flush()
        return requirement

    def _link_doc_requirement(db, doc, requirement, actor_id) -> models.DocRequirementLink:
        link = models.DocRequirementLink(
            doc_id=doc.id, requirement_id=requirement.id, created_by=actor_id
        )
        db.add(link)
        db.flush()
        return link

    # --- import/export internals -------------------------------------------

    def _import_single_md(db, space, filename, raw, folder_id, actor_id, commit: bool = True) -> models.Doc:
        text = raw.decode("utf-8", errors="replace")
        meta, body = _parse_frontmatter(text)
        title = (meta.get("title") or _first_h1(body)
                 or os.path.splitext(os.path.basename(filename))[0] or "Untitled")
        status = str(meta.get("status") or "draft").lower()
        try:
            status_enum = models.DocStatus(status)
        except ValueError:
            status_enum = models.DocStatus.DRAFT
        tags = meta.get("tags")
        if isinstance(tags, list):
            tags = ",".join(str(t) for t in tags)
        payload = schemas.DocCreate(
            title=str(title)[:255],
            content_markdown=body,
            space_id=space.id,
            folder_id=folder_id,
            classification=(str(meta["classification"]) if meta.get("classification") else None),
            status=status_enum,
            tags=(str(tags) if tags else None),
            dir=(str(meta.get("dir")) if meta.get("dir") in {"ltr", "rtl", "auto"} else "auto"),
        )
        return crud_docs.create_doc(db, payload, actor_id=actor_id, commit=commit)

    def _import_zip(db, space, raw, actor_id) -> List[models.Doc]:
        created: List[models.Doc] = []
        folder_cache: dict[str, int] = {}

        def ensure_folder(rel_dir: str) -> Optional[int]:
            rel_dir = rel_dir.strip("/")
            if not rel_dir:
                return None
            if rel_dir in folder_cache:
                return folder_cache[rel_dir]
            parts = rel_dir.split("/")
            parent_id: Optional[int] = None
            path_so_far = ""
            for part in parts:
                path_so_far = f"{path_so_far}/{part}" if path_so_far else part
                if path_so_far in folder_cache:
                    parent_id = folder_cache[path_so_far]
                    continue
                folder = crud_docs.create_folder(
                    db,
                    schemas.DocFolderCreate(name=part, space_id=space.id, parent_folder_id=parent_id),
                    commit=False,
                )
                folder_cache[path_so_far] = folder.id
                parent_id = folder.id
            return parent_id

        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Invalid zip file")

        with zf:
            markdown_entries = []
            total_size = 0
            for info in zf.infolist():
                if info.is_dir():
                    continue
                safe_name = _safe_zip_member_name(info.filename)
                if not _is_markdown_filename(safe_name):
                    continue
                total_size += info.file_size
                if total_size > DOC_IMPORT_MAX_BYTES:
                    raise HTTPException(status_code=413, detail="Imported Markdown content is too large")
                markdown_entries.append((info, safe_name))
                if len(markdown_entries) > DOC_IMPORT_MAX_FILES:
                    raise HTTPException(status_code=413, detail="Zip contains too many Markdown files")

            if not markdown_entries:
                raise HTTPException(status_code=400, detail="Zip does not contain any Markdown files")

            for info, safe_name in markdown_entries:
                rel_dir = os.path.dirname(safe_name)
                folder_id = ensure_folder(rel_dir)
                with zf.open(info) as fh:
                    doc = _import_single_md(
                        db,
                        space,
                        os.path.basename(safe_name),
                        fh.read(),
                        folder_id,
                        actor_id,
                        commit=False,
                    )
                created.append(doc)
        return created

    def _build_space_zip(db, space) -> bytes:
        folders = {f.id: f for f in crud_docs.list_folders(db, space.id)}

        def folder_path(folder_id: Optional[int]) -> str:
            parts: List[str] = []
            seen = set()
            while folder_id is not None and folder_id in folders and folder_id not in seen:
                seen.add(folder_id)
                f = folders[folder_id]
                parts.append(crud_docs.slugify(f.name))
                folder_id = f.parent_folder_id
            return "/".join(reversed(parts))

        docs = crud_docs.list_docs(db, space_id=space.id, limit=500)
        manifest = {"space": space.name, "slug": space.slug, "docs": []}
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            for d in docs:
                rel = folder_path(d.folder_id)
                fname = _safe_filename(d.title)
                arc = f"{rel}/{fname}" if rel else fname
                zf.writestr(arc, _build_markdown_export(d))
                manifest["docs"].append({"title": d.title, "path": arc, "status": getattr(d.status, "value", d.status)})
            import json
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        return out.getvalue()
